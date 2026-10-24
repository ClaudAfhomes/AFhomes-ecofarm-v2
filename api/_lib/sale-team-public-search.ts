import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  publicSaleTeamSearchResultSchema,
  saleTeamLookupSchema,
  saleTeamSearchRevealSchema,
  saleTeamSearchStartSchema,
  publicVerificationSettingsSchema,
} from '@afhomes/contracts';
import { fail, jsonBody, method, singleRpcRow, type Db } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { consumeIdentifierAttempt } from './rate-limit.js';
import {
  contactDigest,
  maskSearchName,
  readSearchToken,
  searchConfiguration,
  searchDigest,
  searchIp,
  signSearchToken,
  verifySearchCaptcha,
} from './sale-team-search.js';

const attemptSchema = z.object({
  allowed: z.boolean(),
  retryAfter: z.number().int().nonnegative(),
});
const revealSchema = z.object({
  limited: z.boolean(),
  retryAfter: z.number().int().nonnegative(),
  result: z.unknown(),
});

async function rpc(db: Db, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await db.rpc(name, args);
  if (result.error) throw new Error('Search storage unavailable');
  return result.data;
}

export async function handlePublicSaleTeamSearch(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  path: string,
): Promise<void> {
  let config = searchConfiguration();
  const saved = await db.rpc('get_public_verification_settings');
  const parsedSettings = saved.error
    ? null
    : publicVerificationSettingsSchema.safeParse(saved.data);
  if (parsedSettings?.success) config = searchConfiguration(parsedSettings.data);
  res.setHeader('Cache-Control', 'no-store');
  if (path === 'search/config' && method(req) === 'GET') {
    res.status(200).json(config.public);
    return;
  }
  if (!['search/start', 'search/reveal'].includes(path) || method(req) !== 'POST')
    return fail(res, 'NOT_FOUND', 'Route not found.', 404);
  if (!config.available)
    return fail(res, 'INTERNAL', 'Verification is unavailable. Please retry later.', 503);
  if (JSON.stringify(req.body ?? '').length > 8192)
    return fail(res, 'VALIDATION_ERROR', 'Search request is too large.', 400);
  try {
    const ip = searchIp(req);
    const ipHash = searchDigest(config.secret, 'search-ip-v1', ip);
    const early = consumeIdentifierAttempt(
      { headers: { 'x-forwarded-for': ip } },
      'public-sale-team-v2',
    );
    if (!early.allowed) {
      res.setHeader('Retry-After', String(early.retryAfterSeconds));
      return fail(res, 'RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
    }
    if (path === 'search/start') {
      const parsed = saleTeamSearchStartSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Check the AA number and security verification.', 400);
      const body = parsed.data;
      if (!(await verifySearchCaptcha(config.captchaSecret, body.captchaToken, config.hostnames)))
        return fail(res, 'VALIDATION_ERROR', 'Security verification failed. Please retry.', 400);
      const attempt = attemptSchema.parse(
        await rpc(db, 'begin_sale_team_search', { p_ip_hash: ipHash, p_aa_number: body.aaNumber }),
      );
      if (!attempt.allowed) {
        res.setHeader('Retry-After', String(attempt.retryAfter));
        return fail(res, 'RATE_LIMITED', 'Too many requests. Try again later.', 429);
      }
      const searchToken = signSearchToken(
        config.secret,
        {
          purpose: 'search',
          id: randomUUID(),
          sessionId: body.sessionId,
          ipHash,
          noticeVersion: config.public.noticeVersion,
          aaNumber: body.aaNumber,
        },
        300,
      );
      res.status(200).json({ searchToken });
      return;
    }
    const parsed = saleTeamSearchRevealSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Acknowledge the privacy notice and check contact details.',
        400,
      );
    const body = parsed.data;
    const binding = {
      sessionId: body.sessionId,
      ipHash,
      noticeVersion: config.public.noticeVersion,
    };
    let flow;
    let contactId: string | undefined;
    try {
      if (body.noticeVersion !== binding.noticeVersion) throw new Error('Notice changed');
      flow = readSearchToken(config.secret, body.searchToken, 'search', binding);
      if (body.contactReceipt)
        contactId = readSearchToken(config.secret, body.contactReceipt, 'contact', binding).id;
    } catch {
      return fail(
        res,
        'VALIDATION_ERROR',
        'Search session expired. Search again and enter contact details if requested.',
        400,
      );
    }
    if (
      contactId &&
      (await rpc(db, 'sale_team_search_contact_exists', { p_contact_id: contactId })) !== true
    )
      return fail(
        res,
        'VALIDATION_ERROR',
        'Contact session expired. Search again and enter your details.',
        400,
      );
    // A signed flow is reusable for delivery retries, so its requests also need shared throttling.
    const attempt = attemptSchema.parse(
      await rpc(db, 'begin_sale_team_search', { p_ip_hash: ipHash, p_aa_number: flow.aaNumber }),
    );
    if (!attempt.allowed) {
      res.setHeader('Retry-After', String(attempt.retryAfter));
      return fail(res, 'RATE_LIMITED', 'Too many requests. Try again later.', 429);
    }
    if (!contactId && body.contact) {
      contactId = z.uuid().parse(
        await rpc(db, 'save_sale_team_search_contact', {
          p_dedupe_key: contactDigest(config.secret, body.contact),
          p_name: body.contact.name,
          p_email: body.contact.email,
          p_mobile: body.contact.mobile,
        }),
      );
    }
    const answer = revealSchema.parse(
      await rpc(db, 'reveal_sale_team_search', {
        p_ip_hash: ipHash,
        p_request_id: flow.id,
        p_aa_number: flow.aaNumber,
        p_notice_version: binding.noticeVersion,
        p_contact_id: contactId,
      }),
    );
    if (answer.limited) {
      res.setHeader('Retry-After', String(answer.retryAfter));
      return fail(
        res,
        'RATE_LIMITED',
        'You have used your 3 successful searches. Please try again after the allowance resets.',
        429,
      );
    }
    const raw = singleRpcRow(answer.result);
    const { staffId, ...clean } = (raw ?? {}) as Record<string, unknown>;
    const seller = saleTeamLookupSchema.parse(raw === null ? null : { ...clean, photoUrl: null });
    if (seller && seller.status !== 'accredited') throw new Error('Ineligible result');
    let photoUrl: string | null = null;
    if (seller && typeof staffId === 'string' && typeof db.storage?.from === 'function') {
      try {
        const signed = await db.storage
          .from('afhomes-profile-photos')
          .createSignedUrl(`${staffId}/profile.jpg`, 300);
        photoUrl = signed.data?.signedUrl ?? null;
      } catch {
        /* Photo delivery may fail without invalidating accreditation. */
      }
    }
    const result = seller
      ? publicSaleTeamSearchResultSchema.parse({
          aaNumber: seller.aaNumber,
          kind: seller.kind,
          status: 'accredited',
          maskedName: maskSearchName(seller.fullName),
          expiresOn: seller.kind === 'IST' ? null : seller.expiresOn,
          photoUrl,
        })
      : null;
    const contactReceipt =
      body.contactReceipt ??
      signSearchToken(config.secret, { ...binding, purpose: 'contact', id: contactId! }, 86400);
    res.status(200).json({ result, contactReceipt });
  } catch {
    fail(res, 'INTERNAL', 'Verification is unavailable. Please retry using the same request.', 503);
  }
}
