import { z } from 'zod';
import {
  approveOstAccreditationSchema,
  manualOstAccreditationSchema,
  normalizeOstReferralCode,
  submitOstAccreditationSchema,
  submitOstRenewalSchema,
  ostRenewalDecisionSchema,
} from '@afhomes/contracts';
import { authorizeAfHomes, resolveAfHomesPrincipal } from '../_lib/afhomes-access.js';
import { deny, fail, jsonBody, method, subPath } from '../_lib/handler-kit.js';
import { hashIdentifier } from '../_lib/identifier.js';
import { consumeIdentifierAttempt } from '../_lib/rate-limit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { resolveAdminUrl } from '../_lib/admin-url.js';
import { handleOstImport } from '../_lib/ost-import-handler.js';
import { validateOstSponsor } from '../_lib/ost-sponsor.js';

const uuid = z.string().uuid();

/**
 * One `staff_users` row as the sponsors query reads it. The embedded
 * `staff_role_assignments` is re-checked with Zod at every use site, so this type
 * states the query's shape and never replaces that runtime validation.
 */
type SponsorCandidate = {
  id: string;
  full_name: string;
  status: string;
  staff_role_assignments: { roles: { slug: string; is_active: boolean } }[];
};
type StaffUsersResult = { data: SponsorCandidate[] | null; error: { message: string } | null };

function rpcFailure(res: VercelResponse, error: { message: string; code?: string }) {
  const text = error.message;
  if (text === 'INVALID_REFERRAL_CODE')
    return fail(
      res,
      'VALIDATION_ERROR',
      'This referral code is expired, revoked, exhausted, or unavailable. Ask your Sales Manager for a valid code.',
      400,
    );
  if (error.code === '42501')
    return fail(res, 'FORBIDDEN', 'You cannot perform this accreditation action.', 403);
  if (/NOT_FOUND/.test(text)) return fail(res, 'NOT_FOUND', 'Accreditation record not found.', 404);
  if (/DUPLICATE|PAYLOAD_CONFLICT|unique|SPONSOR_CHANGED|PRIOR_TERM/.test(text))
    return fail(
      res,
      'CONFLICT',
      'The record changed or already exists. Review it before retrying.',
      409,
    );
  if (/INVALID|REQUIRED|check constraint|not-null/.test(text))
    return fail(
      res,
      'VALIDATION_ERROR',
      'Check the form, sponsor, signatures, endorsement and approved validity dates.',
      400,
    );
  return fail(res, 'INTERNAL', 'Accreditation could not be processed. Please retry.', 500);
}

/** The same official form contract and atomic SQL path serve public/manual/import. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient();
  if (!db) return fail(res, 'INTERNAL', 'Server configuration is incomplete.', 500);
  const path = subPath(req);
  if (path === 'public' && method(req) === 'POST') {
    if (!consumeIdentifierAttempt(req, 'public-ost-submit').allowed)
      return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);
    const parsed = submitOstAccreditationSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Complete the official accreditation form.', 400);
    const { data: code, error } = await db
      .from('referral_codes')
      .select('id,sponsor_staff_id')
      .eq('code_hash', hashIdentifier(normalizeOstReferralCode(parsed.data.referralCode)))
      .maybeSingle();
    if (error) return rpcFailure(res, error);
    if (!code) return fail(res, 'VALIDATION_ERROR', 'This referral code is not available.', 400);
    try {
      const sponsor = await validateOstSponsor(db, code.sponsor_staff_id);
      if (!sponsor.ok) return fail(res, 'CONFLICT', sponsor.message, sponsor.status);
    } catch {
      return fail(res, 'INTERNAL', 'Unable to verify the Sales Manager. Please retry.', 500);
    }
    const result = await db.rpc('submit_ost_accreditation', {
      p_request_id: parsed.data.requestId,
      p_actor_id: null,
      p_sponsor_id: code.sponsor_staff_id,
      p_code_id: code.id,
      p_identity: parsed.data.identity,
      p_form: parsed.data.form,
      p_source: 'public',
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(201).json({ id: result.data });
  }
  const principal = await resolveAfHomesPrincipal(req);
  if ('error' in principal) return deny(res, principal);
  if (principal.mustChangePassword || principal.mfaRequired)
    return fail(res, 'FORBIDDEN', 'Complete account security setup before continuing.', 403);
  const own = principal.roleSlug === 'ost';
  const bodyAction = z.object({ action: z.string() }).safeParse(jsonBody(req));
  const viewAction =
    path.endsWith('/endorse') ||
    path.endsWith('/signatures') ||
    path.endsWith('/renew') ||
    path.endsWith('/revise') ||
    (path.endsWith('/decision') && bodyAction.success && bodyAction.data.action === 'endorse');
  const access = own
    ? principal
    : await authorizeAfHomes(
        req,
        'network.ost_registrations',
        method(req) === 'GET' || viewAction
          ? 'view'
          : path === 'manual' || path.startsWith('imports')
            ? 'create'
            : 'update',
      );
  if ('error' in access) return deny(res, access);
  if (path === 'sponsors' && method(req) === 'GET') {
    if (own) {
      const member = await db
        .from('ost_members')
        .select('id')
        .eq('id', principal.userId)
        .eq('status', 'active')
        .maybeSingle();
      if (member.error || !member.data)
        return fail(res, 'FORBIDDEN', 'An active OST account is required.', 403);
    }
    // The payload shape is declared here rather than taken from the Supabase
    // client: this result is an untyped PostgREST payload whose inferred type
    // collapses to `any` whenever the client generic does not resolve (Vercel's
    // function-bundling typecheck does exactly that, which raised TS7006 on
    // `row`). Asserting the response gives `row` a real type in every
    // environment. The per-row Zod check below still validates at runtime.
    const result = (await db
      .from('staff_users')
      .select('id,full_name,status,staff_role_assignments(roles(slug,is_active))')
      .eq('status', 'active')) as StaffUsersResult;
    if (result.error) return rpcFailure(res, result.error);
    const sponsors = (result.data ?? [])
      .filter((row) => {
        const parsed = z
          .object({
            staff_role_assignments: z.array(
              z.object({ roles: z.object({ slug: z.string(), is_active: z.boolean() }) }),
            ),
          })
          .safeParse(row);
        return (
          parsed.success &&
          parsed.data.staff_role_assignments.some(
            (a) => a.roles.slug === 'sales_manager' && a.roles.is_active,
          )
        );
      })
      .map((row) => ({ id: row.id, name: row.full_name }));
    return res.status(200).json({ data: sponsors, meta: { total: sponsors.length } });
  }
  if (
    path.startsWith('imports') ||
    path === 'template' ||
    path === 'official-template' ||
    path === 'export'
  ) {
    if (own)
      return fail(res, 'FORBIDDEN', 'Import and export are available to authorized staff.', 403);
    return handleOstImport(req, res, db, principal);
  }
  if (path === 'manual' && method(req) === 'POST') {
    if (own)
      return fail(res, 'FORBIDDEN', 'Manual registration is available to authorized staff.', 403);
    const parsed = manualOstAccreditationSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Complete the official accreditation form and choose an active Sales Manager.',
        400,
      );
    const result = await db.rpc('submit_ost_accreditation', {
      p_request_id: parsed.data.requestId,
      p_actor_id: principal.userId,
      p_sponsor_id: parsed.data.sponsorStaffId,
      p_code_id: null,
      p_identity: parsed.data.identity,
      p_form: parsed.data.form,
      p_source: 'manual',
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(201).json({ id: result.data });
  }
  const match = path.match(
    /^(applications|members|renewals)\/([^/]+)(?:\/(endorse|signatures|approve|renew|decision|revise))?$/,
  );
  if (!match || !uuid.safeParse(match[2]).success)
    return fail(res, 'NOT_FOUND', 'Accreditation endpoint not found.', 404);
  const [, kind, id, action] = match;
  if (
    own &&
    !(
      (kind === 'members' && id === principal.userId) ||
      (kind === 'renewals' && action === 'revise')
    )
  )
    return fail(res, 'FORBIDDEN', 'Only your own accreditation is available.', 403);
  if (!action && method(req) === 'GET' && kind !== 'renewals') {
    const result = await db.rpc('ost_accreditation_records', {
      p_actor_id: principal.userId,
      p_ost_id: kind === 'members' ? id : null,
      p_application_id: kind === 'applications' ? id : null,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(200).json(result.data);
  }
  if (method(req) !== 'POST')
    return fail(res, 'NOT_FOUND', 'Accreditation endpoint not found.', 404);
  if (kind === 'applications' && action === 'signatures') {
    const parsed = z
      .object({ applicantSignedOn: z.iso.date(), referrerSignedOn: z.iso.date() })
      .strict()
      .safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Provide both actual signature dates.', 400);
    const result = await db.rpc('confirm_ost_application_signatures', {
      p_id: id,
      p_actor_id: principal.userId,
      p_applicant_date: parsed.data.applicantSignedOn,
      p_referrer_date: parsed.data.referrerSignedOn,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(200).json({ id: result.data });
  }
  if (kind === 'applications' && action === 'endorse') {
    const signature = z
      .object({ signedOn: z.iso.date().nullable().optional() })
      .strict()
      .safeParse(jsonBody(req));
    if (!signature.success)
      return fail(res, 'VALIDATION_ERROR', 'Provide the actual referrer signature date.', 400);
    const result = await db.rpc('endorse_ost_accreditation', {
      p_id: id,
      p_actor_id: principal.userId,
      p_signed_on: signature.data.signedOn ?? null,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(200).json({ id: result.data });
  }
  if (kind === 'applications' && action === 'approve') {
    const parsed = approveOstAccreditationSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Provide management-approved start and expiry dates.',
        400,
      );
    // Verify the private official workflow before any GoTrue invitation.
    const records = await db.rpc('ost_accreditation_records', {
      p_actor_id: principal.userId,
      p_ost_id: null,
      p_application_id: id,
    });
    if (records.error) return rpcFailure(res, records.error);
    const checked = z
      .object({
        registration: z
          .object({
            endorsed_at: z.string().nullable(),
            applicant_signature_status: z.string(),
            referrer_signature_status: z.string(),
          })
          .nullable(),
      })
      .safeParse(records.data);
    if (
      !checked.success ||
      !checked.data.registration?.endorsed_at ||
      checked.data.registration.applicant_signature_status !== 'received' ||
      checked.data.registration.referrer_signature_status !== 'received'
    )
      return fail(
        res,
        'VALIDATION_ERROR',
        'Both signatures and Sales Manager endorsement are required.',
        400,
      );
    const { data: member, error } = await db
      .from('ost_members')
      .select('id')
      .eq('application_id', id)
      .maybeSingle();
    if (error) return rpcFailure(res, error);
    if (!member) {
      if (
        !['admin', 'super_admin', 'senior_sales_manager', 'vice_director'].includes(
          principal.roleSlug,
        )
      )
        return fail(res, 'FORBIDDEN', 'Management approval is required.', 403);
      const { data: application, error: readError } = await db
        .from('ost_applications')
        .select('email,first_name,middle_name,last_name,status')
        .eq('id', id)
        .maybeSingle();
      if (readError) return rpcFailure(res, readError);
      if (!application || !['submitted', 'under_review'].includes(application.status))
        return fail(res, 'CONFLICT', 'The application is not ready for approval.', 409);
      const redirectTo = resolveAdminUrl();
      if (!redirectTo) return fail(res, 'INTERNAL', 'Account invitation is not configured.', 500);
      const invited = await db.auth.admin.inviteUserByEmail(application.email, {
        redirectTo,
        data: {
          full_name: [application.first_name, application.middle_name, application.last_name]
            .filter(Boolean)
            .join(' '),
        },
      });
      if (invited.error || !invited.data.user)
        return fail(
          res,
          'CONFLICT',
          'Unable to invite this account. Review existing accounts before retrying.',
          409,
        );
      const authId = invited.data.user.id;
      const installed = await db.rpc('install_ost_accreditation_identity', {
        p_application_id: id,
        p_actor_id: principal.userId,
        p_auth_id: authId,
        p_starts_on: parsed.data.startsOn,
        p_expires_on: parsed.data.expiresOn,
      });
      if (installed.error) {
        // GoTrue invitation and SQL cannot share a transaction. Preserve the Auth
        // identity for reconciliation; an invitation response does not prove it
        // was newly created, so deleting it could destroy a pre-existing account.
        return rpcFailure(res, installed.error);
      }
      return res.status(201).json({ id: installed.data });
    }
    const result = await db.rpc('approve_ost_accreditation', {
      p_application_id: id,
      p_actor_id: principal.userId,
      p_ost_id: member.id,
      p_starts_on: parsed.data.startsOn,
      p_expires_on: parsed.data.expiresOn,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(200).json({ id: result.data });
  }
  if (kind === 'members' && action === 'renew') {
    const parsed = submitOstRenewalSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Check renewal dates and any proposed referrer change.',
        400,
      );
    const result = await db.rpc('submit_ost_renewal', {
      p_request_id: parsed.data.requestId,
      p_actor_id: principal.userId,
      p_ost_id: id,
      p_input: parsed.data,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(201).json({ id: result.data });
  }
  if (kind === 'renewals' && action === 'revise') {
    const parsed = submitOstRenewalSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Check the revised renewal details.', 400);
    const result = await db.rpc('revise_ost_renewal', {
      p_id: id,
      p_actor_id: principal.userId,
      p_input: parsed.data,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(200).json({ id: result.data });
  }
  if (kind === 'renewals' && action === 'decision') {
    const parsed = ostRenewalDecisionSchema.safeParse(jsonBody(req));
    if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Check the renewal decision.', 400);
    const result = await db.rpc('decide_ost_renewal', {
      p_id: id,
      p_actor_id: principal.userId,
      p_action: parsed.data.action,
      p_notes: parsed.data.notes,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(200).json({ id: result.data });
  }
  if (kind === 'applications' && action === 'decision') {
    const parsed = z
      .object({
        action: z.enum(['reject', 'request-changes']),
        notes: z.string().trim().min(5).max(500),
      })
      .safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Provide review notes of at least five characters.',
        400,
      );
    const result = await db.rpc('review_ost_accreditation', {
      p_id: id,
      p_actor_id: principal.userId,
      p_action: parsed.data.action,
      p_notes: parsed.data.notes,
    });
    if (result.error) return rpcFailure(res, result.error);
    return res.status(200).json({ id: result.data });
  }
  return fail(res, 'NOT_FOUND', 'Accreditation endpoint not found.', 404);
}
