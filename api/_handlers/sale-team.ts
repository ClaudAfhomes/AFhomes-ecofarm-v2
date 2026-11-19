import { z } from 'zod';
import {
  aaNumberSchema,
  manageSaleTeamSchema,
  saleTeamHistoricalAccreditationSchema,
  saleTeamLookupSchema,
} from '@afhomes/contracts';
import { authorizeAfHomes, resolveAfHomesPrincipal } from '../_lib/afhomes-access.js';
import { deny, fail, jsonBody, method, singleRpcRow, subPath } from '../_lib/handler-kit.js';
import { consumeIdentifierAttempt } from '../_lib/rate-limit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { handlePublicSaleTeamSearch } from '../_lib/sale-team-public-search.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const db = serviceClient();
  if (!db) return fail(res, 'INTERNAL', 'Verification is unavailable. Please retry.', 503);
  const path = subPath(req);
  if (path.startsWith('search/')) return handlePublicSaleTeamSearch(req, res, db, path);
  try {
    let result;
    let historical = false;
    if (path === 'search' && method(req) === 'GET') {
      if (process.env.AFHOMES_SEARCH_ENABLED === 'true') {
        const access = await authorizeAfHomes(req, 'network.members');
        if ('error' in access) return deny(res, access);
      }
      // shortcut: per-instance IP limit only; use platform edge limits before broad public rollout.
      const verdict = consumeIdentifierAttempt(req, 'public-sale-team');
      if (!verdict.allowed) {
        res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
        return fail(res, 'RATE_LIMITED', 'Too many searches. Try again shortly.', 429);
      }
      const number = aaNumberSchema.safeParse(req.query.aaNumber);
      if (!number.success) return fail(res, 'VALIDATION_ERROR', 'Enter a valid AA number.', 400);
      result = await db.rpc('search_sale_team_accreditation', { p_aa_number: number.data });
      if (!result.error && singleRpcRow(result.data) === null) {
        // The number is not current. It may have been retired by a transfer,
        // and only the history table can tell the successor. That answer is
        // for an authenticated staff caller who holds the members permission
        // and for nobody else: an anonymous or unauthorized caller keeps the
        // ordinary not-found answer, so this endpoint can never be used to
        // probe which numbers have ever existed.
        const principal = await resolveAfHomesPrincipal(req);
        if (!('error' in principal)) {
          const access = await authorizeAfHomes(req, 'network.members');
          if (!('error' in access)) {
            const resolved = await db.rpc('resolve_sale_team_accreditation_number', {
              p_aa_number: number.data,
            });
            if (resolved.error) throw resolved.error;
            if (singleRpcRow(resolved.data) !== null) {
              result = resolved;
              historical = true;
            }
          }
        }
      }
    } else if (path === 'me' && method(req) === 'GET') {
      const principal = await resolveAfHomesPrincipal(req);
      if ('error' in principal) return deny(res, principal);
      // Identity-only read remains available during password/MFA enrollment.
      result = await db.rpc('get_sale_team_accreditation', { p_staff_id: principal.userId });
    } else {
      const id = z.string().uuid().safeParse(path);
      if (!id.success || !['GET', 'POST'].includes(method(req)))
        return fail(res, 'NOT_FOUND', 'Route not found.', 404);
      const principal = await resolveAfHomesPrincipal(req);
      if ('error' in principal) return deny(res, principal);
      if (!['admin', 'super_admin'].includes(principal.roleSlug))
        return fail(res, 'FORBIDDEN', 'Administrator approval is required.', 403);
      const body = method(req) === 'POST' ? manageSaleTeamSchema.safeParse(jsonBody(req)) : null;
      if (body && !body.success)
        return fail(res, 'VALIDATION_ERROR', 'Check accreditation details.', 400);
      const kind = body?.success ? body.data.kind : req.query.kind;
      if (!['IST', 'OST'].includes(String(kind)))
        return fail(res, 'VALIDATION_ERROR', 'Choose IST or OST.', 400);
      const access = await authorizeAfHomes(
        req,
        kind === 'OST' ? 'network.ost_registrations' : 'organization.staff',
        method(req) === 'POST' ? 'update' : 'view',
      );
      if ('error' in access) return deny(res, access);
      if (body?.success) {
        result = await db.rpc('manage_sale_team_accreditation', {
          p_actor_id: principal.userId,
          p_staff_id: id.data,
          p_kind: body.data.kind,
          p_action: body.data.action,
          p_starts_on: body.data.startsOn ?? null,
          p_expires_on: body.data.expiresOn ?? null,
        });
      } else result = await db.rpc('get_sale_team_accreditation', { p_staff_id: id.data });
    }
    if (result.error) {
      if (result.error.code === '42501')
        return fail(res, 'FORBIDDEN', 'Accreditation approval is not permitted.', 403);
      if (/INVALID|REQUIRED|CONFLICT/.test(result.error.message))
        return fail(res, 'CONFLICT', 'Review the account and approved accreditation dates.', 409);
      throw result.error;
    }
    // Resolve a short-lived signed URL for the seller's profile photo, if any.
    // The RPC exposes `staffId` only so the service role can mint it; it is
    // never returned to the caller. Failure (missing object, storage error) is
    // non-fatal and degrades to a null photoUrl -> the UI shows the initial.
    let photoUrl: string | null = null;
    const rawRow = singleRpcRow(result.data);
    const staffId = rawRow && typeof rawRow.staffId === 'string' ? rawRow.staffId : null;
    if (staffId && typeof db.storage?.from === 'function') {
      try {
        const { data: signed } = await db.storage
          .from('afhomes-profile-photos')
          .createSignedUrl(`${staffId}/profile.jpg`, 300);
        photoUrl = signed?.signedUrl ?? null;
      } catch {
        photoUrl = null;
      }
    }
    const { staffId: _omit, ...cleanRow } = (rawRow ?? {}) as Record<string, unknown>;
    const candidate = result.data === null ? null : { ...cleanRow, photoUrl };
    const parsed = (
      historical ? saleTeamHistoricalAccreditationSchema : saleTeamLookupSchema
    ).safeParse(candidate);
    if (!parsed.success) throw new Error('Invalid accreditation response');
    if (
      path === 'search' &&
      parsed.data &&
      parsed.data.status !== 'accredited' &&
      parsed.data.status !== 'superseded'
    )
      throw new Error('Ineligible public accreditation response');
    res.status(200).json(parsed.data);
  } catch {
    fail(res, 'INTERNAL', 'Verification is unavailable. Please retry.', 503);
  }
}
