import { storedAccreditationNumbers } from '../_lib/accreditation-numbers.js';
import { decodeProfilePhoto, saveProfilePhoto, removeProfilePhoto } from '../_lib/profile-photo.js';
import { profilePhotoInputSchema } from '@afhomes/contracts';
import { validateOstSponsor, type SponsorCheck } from '../_lib/ost-sponsor.js';
import accreditationHandler from './ost-accreditation.js';
import { matchesSearch, readSearchRows } from '../_lib/list-search.js';
/**
 * AFHomes Phase 8 - OST registration and approval (SM -> OST).
 *
 * The public surface carries a referral CODE, never a sponsor id. The sponsor
 * is resolved server-side from the code hash and frozen into the application;
 * there is no sponsor field to spoof. Approval re-validates the frozen sponsor
 * (still an active Sales Manager), creates the staff identity through the
 * existing invitation flow, and inserts the SM -> OST genealogy edge under the
 * Phase 7 safeguards (exact adjacency, one active upline, no cycles).
 *
 * Status vocabulary is the Phase 1 set: `submitted` IS the pending state.
 * No commission, payout, ranking or cost-sharing rule lives here.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import {
  OST_REVIEWABLE_STATUSES,
  createAfHomesStaffSchema,
  createOstReferralCodeSchema,
  normalizeOstReferralCode,
  ostMeSchema,
  ostReferralCodeSchema,
  rejectOstApplicationSchema,
  requestOstApplicationChangesSchema,
  ostDashboardSchema,
  ostHeadInfoSchema,
  ostPersonalSalesSchema,
  ostPersonalCommissionsSchema,
  ostCommissionRecordSchema,
  ostSalesRecordSchema,
  ostCommissionListRecordSchema,
  ostSalesListSchema,
  ostCommissionsListSchema,
} from '@afhomes/contracts';

import {
  authorizeAfHomes,
  resolveAfHomesPrincipal,
  type AfHomesPrincipal,
} from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  type Db,
  list,
  mapRpcError,
  method,
  route,
  subPath,
} from '../_lib/handler-kit.js';
import { hashIdentifier } from '../_lib/identifier.js';
import { consumeIdentifierAttempt } from '../_lib/rate-limit.js';
import { serviceClient, anonClient } from '../_lib/rest.js';
import { extractBearerToken } from '../_lib/token.js';
import { verifySessionToken } from '../_lib/auth-verify.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { resolveAdminUrl } from '../_lib/admin-url.js';

const REVIEWABLE = [...OST_REVIEWABLE_STATUSES] as string[];
const UUID_RE = /^[0-9a-f-]{36}$/i;

const applicantName = (row: Record<string, unknown>) =>
  [row.first_name, row.middle_name, row.last_name]
    .filter((p) => typeof p === 'string' && p.length > 0)
    .join(' ');

const toApplication = (row: Record<string, unknown>, sponsorName: string, codeHint: string) => ({
  id: row.id,
  applicantName: applicantName(row),
  email: row.email,
  phone: row.phone,
  birthDate: isoOrNull(row.birth_date),
  address: (row.address as unknown) ?? null,
  sponsorStaffId: row.sponsor_staff_id,
  sponsorName,
  referralCodeHint: codeHint,
  status: row.status,
  reviewNotes: isoOrNull(row.review_notes),
  reviewedBy: isoOrNull(row.reviewed_by),
  submittedAt: isoOrNull(row.submitted_at) ?? '',
  reviewedAt: isoOrNull(row.reviewed_at),
});

async function searchRelated(db: Db, table: string, ids: string[], columns: string) {
  const data: Record<string, unknown>[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    data.push(
      ...(await readSearchRows(
        db
          .from(table)
          .select(columns)
          .in('id', ids.slice(offset, offset + 500))
          .order('id'),
      )),
    );
  }
  return { data };
}

const toMember = (row: Record<string, unknown>, sponsorName: string) => ({
  id: row.id,
  applicationId: row.application_id,
  sponsorStaffId: row.sponsor_staff_id,
  sponsorName,
  ostNumber: row.ost_number,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  status: row.status,
  approvedBy: row.approved_by,
  approvedAt: isoOrNull(row.approved_at) ?? '',
  createdAt: isoOrNull(row.created_at) ?? '',
});

function newReferralCode(): string {
  const hex = randomBytes(6).toString('hex').toUpperCase();
  return `OST-${hex.slice(0, 6)}-${hex.slice(6, 12)}`;
}

/**
 * Approval-time re-validation of the FROZEN sponsor.
 *
 * The sponsor was fixed at submission and is never changed here; when they no
 * longer qualify, approval is refused with an approval-specific error so an
 * operator knows the application needs sponsor attention, not a resubmit.
 */
async function validateApprovalSponsor(db: Db, sponsorStaffId: string): Promise<SponsorCheck> {
  const checked = await validateOstSponsor(db, sponsorStaffId);
  if (checked.ok) return checked;
  return {
    ok: false as const,
    status: checked.status,
    message:
      `This application cannot be approved: ${checked.message}. ` +
      'The sponsor is unchanged - resolve the sponsor first, then re-review.',
  };
}

export type ReferralCodeIssuer = { userId: string; roleSlug: string };

/**
 * Issuance-time validation for OST referral codes.
 *
 * An OST referral code IS an OST sponsorship code (it freezes the sponsor
 * into the application and the genealogy edge), so its sponsor must still be
 * an active Sales Manager. What differs from public validation is the
 * perspective: a non-SM staff member opening "My Referral Code" and issuing
 * for themselves is an ISSUER problem, not a code problem, and gets an
 * issuance-specific error instead of the public validation message.
 */
async function validateReferralCodeIssuer(
  db: Db,
  caller: ReferralCodeIssuer,
  sponsorId: string,
): Promise<SponsorCheck> {
  if (
    sponsorId === caller.userId &&
    !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(caller.roleSlug)
  ) {
    return {
      ok: false,
      status: 403,
      message:
        'Only an active VD, SSM or Sales Manager can sponsor an OST referral code. ' +
        'Ask an eligible seller for their code, or have an administrator issue one on their behalf.',
    };
  }
  const checked = await validateOstSponsor(db, sponsorId);
  if (checked.ok) return checked;
  return {
    ok: false as const,
    status: checked.status,
    message: `That sponsor cannot back an OST referral code: ${checked.message}.`,
  };
}

type CodeCheck =
  | { ok: true; codeRow: Record<string, unknown>; sponsor: Extract<SponsorCheck, { ok: true }> }
  | { ok: false; status: 403 | 404 | 409; message: string };

async function resolveCode(db: Db, rawCode: string): Promise<CodeCheck> {
  const normalized = normalizeOstReferralCode(rawCode);
  if (!ostReferralCodeSchema.safeParse(normalized).success)
    return { ok: false, status: 404, message: 'Referral code is not valid' };
  const { data: codeRow } = await db
    .from('referral_codes')
    .select('*')
    .eq('code_hash', hashIdentifier(normalized))
    .maybeSingle();
  if (!codeRow) return { ok: false, status: 404, message: 'Referral code is not valid' };
  if (codeRow.is_active !== true)
    return { ok: false, status: 409, message: 'This referral code is no longer active' };
  if (codeRow.expires_at && new Date(String(codeRow.expires_at)).valueOf() <= Date.now())
    return { ok: false, status: 409, message: 'This referral code has expired' };
  if (Number(codeRow.use_count ?? 0) >= Number(codeRow.max_uses ?? 1))
    return { ok: false, status: 409, message: 'This referral code has reached its usage limit' };
  const sponsor = await validateOstSponsor(db, String(codeRow.sponsor_staff_id));
  if (!sponsor.ok) return sponsor;
  return { ok: true, codeRow: codeRow as Record<string, unknown>, sponsor };
}

function sellerScoped(auth: AfHomesPrincipal): boolean {
  return ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(auth.roleSlug);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);

  try {
    /* ---------------- authenticated OST self record (OST portal) ---------------- */
    // The OST portal's own dashboard. Resolves the Auth user directly - an
    // approved OST may not hold a usable staff session - and returns only
    // that member's safe fields. Anything else is a 404 with no distinction
    // between "no such member" and "not yours".
    if (subPath(req) === 'me' && method(req) === 'GET') {
      const anon = anonClient();
      if (!anon) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
      const token = extractBearerToken(req);
      if (!token) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
      const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
      const userId = authData?.user?.id;
      if (authError || !userId)
        return fail(res, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);
      const { data: staff, error: staffError } = await db
        .from('staff_users')
        .select('status,must_change_password')
        .eq('id', userId)
        .maybeSingle();
      if (staffError)
        return fail(res, 'INTERNAL', 'Account security verification is unavailable.', 503);
      if (!staff) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      if (staff.status !== 'active' || staff.must_change_password === true)
        return fail(res, 'FORBIDDEN', 'Set a new password before opening your OST portal.', 403);
      const { data: member, error } = await db
        .from('ost_members')
        .select('id, ost_number, full_name, email, status, sponsor_staff_id, approved_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!member) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      const { data: sponsor, error: sponsorError } = await db
        .from('staff_users')
        .select('full_name')
        .eq('id', member.sponsor_staff_id)
        .maybeSingle();
      if (sponsorError) throw sponsorError;
      const parsed = ostMeSchema.safeParse({
        ostNumber: member.ost_number,
        fullName: member.full_name,
        status: member.status,
        sponsorName: String(sponsor?.full_name ?? ''),
        approvedAt: isoOrNull(member.approved_at) ?? '',
      });
      if (!parsed.success) return fail(res, 'INTERNAL', 'OST record is unavailable', 500);
      return res.status(200).json(parsed.data);
    }

    /* ---------------- public: resolve a referral code ---------------- */
    const resolve = route(req, 'GET', /^referrals\/(.+)$/);
    if (resolve) {
      const verdict = consumeIdentifierAttempt(req, 'public-ost');
      if (!verdict.allowed)
        return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);
      const raw = decodeURIComponent(resolve[1] ?? '');
      const checked = await resolveCode(db, raw);
      if (!checked.ok)
        return fail(
          res,
          checked.status === 404 ? 'NOT_FOUND' : 'CONFLICT',
          checked.message,
          checked.status,
        );
      return res.status(200).json({
        sponsorName: checked.sponsor.fullName,
        codeHint: String(checked.codeRow.code_hint ?? ''),
        expiresAt: isoOrNull(checked.codeRow.expires_at) ?? '',
      });
    }

    // The legacy address shares the official contract and atomic RPC. Flat
    // pre-accreditation payloads cannot create new bypass applications.
    if (subPath(req) === 'applications' && method(req) === 'POST')
      return accreditationHandler({ ...req, query: { ...req.query, familyPath: 'public' } }, res);

    /* ---------------- staff: list applications (scoped) ---------------- */
    if (subPath(req) === 'applications' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'network.ost_registrations');
      if ('error' in auth) return deny(res, auth);
      const search = String(req.query.search ?? '').trim();
      if (search.length > 120) return fail(res, 'VALIDATION_ERROR', 'Search is too long', 400);
      const statusFilter =
        typeof req.query.status === 'string' && req.query.status.length > 0
          ? String(req.query.status)
          : '';
      let query = db
        .from('ost_applications')
        .select('*')
        .order('submitted_at', { ascending: false });
      // Sellers see only the applications they sponsor; unrelated SMs see
      // nothing of each other's pipeline. Non-sellers with the grant see all.
      if (sellerScoped(auth)) query = query.eq('sponsor_staff_id', auth.userId);
      if (statusFilter) query = query.eq('status', statusFilter);
      const rows = await readSearchRows(query.order('id', { ascending: false }));
      const sponsorIds = [...new Set(rows.map((r) => String(r.sponsor_staff_id)))];
      const codeIds = [...new Set(rows.map((r) => String(r.referral_code_id)))];
      const [{ data: sponsors }, { data: codes }] = await Promise.all([
        sponsorIds.length
          ? searchRelated(db, 'staff_users', sponsorIds, 'id, full_name')
          : Promise.resolve({ data: [] }),
        codeIds.length
          ? searchRelated(db, 'referral_codes', codeIds, 'id, code_hint')
          : Promise.resolve({ data: [] }),
      ]);
      const sponsorById = new Map(
        ((sponsors ?? []) as Record<string, unknown>[]).map((s) => [
          String(s.id),
          String(s.full_name ?? ''),
        ]),
      );
      const hintById = new Map(
        ((codes ?? []) as Record<string, unknown>[]).map((c) => [
          String(c.id),
          String(c.code_hint ?? ''),
        ]),
      );
      return list(
        res,
        rows
          .map((r) =>
            toApplication(
              r,
              sponsorById.get(String(r.sponsor_staff_id)) ?? '',
              hintById.get(String(r.referral_code_id)) ?? '',
            ),
          )
          .filter((row) =>
            matchesSearch(search, [
              row.applicantName,
              row.email,
              row.phone,
              row.referralCodeHint,
              row.sponsorName,
              row.status,
              row.id,
            ]),
          ),
      );
    }

    /* ---------------- staff: application detail ---------------- */
    const detail = route(req, 'GET', /^applications\/([0-9a-f-]+)$/);
    if (detail) {
      const auth = await authorizeAfHomes(req, 'network.ost_registrations');
      if ('error' in auth) return deny(res, auth);
      const id = detail[1]!;
      const { data, error } = await db
        .from('ost_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return fail(res, 'NOT_FOUND', 'OST application not found', 404);
      if (sellerScoped(auth) && String(data.sponsor_staff_id) !== auth.userId)
        return fail(res, 'NOT_FOUND', 'OST application not found', 404);
      const [{ data: sponsor }, { data: code }] = await Promise.all([
        db.from('staff_users').select('full_name').eq('id', data.sponsor_staff_id).maybeSingle(),
        db.from('referral_codes').select('code_hint').eq('id', data.referral_code_id).maybeSingle(),
      ]);
      return res
        .status(200)
        .json(toApplication(data, String(sponsor?.full_name ?? ''), String(code?.code_hint ?? '')));
    }

    /* ---------------- staff: approve ---------------- */
    const approve = route(req, 'POST', /^applications\/([0-9a-f-]+)\/approve$/);
    if (approve) {
      const auth = await authorizeAfHomes(req, 'network.ost_registrations', 'update');
      if ('error' in auth) return deny(res, auth);
      const id = approve[1]!;
      if (!UUID_RE.test(id)) return fail(res, 'NOT_FOUND', 'OST application not found', 404);

      const { data: app, error: readError } = await db
        .from('ost_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!app) return fail(res, 'NOT_FOUND', 'OST application not found', 404);
      if (
        app.registration_details?.officialAccreditation &&
        /\/(reject|request-changes)$/.test(subPath(req))
      )
        return fail(res, 'CONFLICT', 'Use the official accreditation review workflow.', 409);

      if (app.registration_details?.officialAccreditation) {
        return fail(
          res,
          'CONFLICT',
          'Use official accreditation approval with management-approved validity dates.',
          409,
        );
      }

      // Idempotent repeat: an approved application returns its member.
      if (app.status === 'approved') {
        const { data: member } = await db
          .from('ost_members')
          .select('*')
          .eq('application_id', id)
          .maybeSingle();
        if (member) {
          const { data: sponsor, error: sponsorError } = await db
            .from('staff_users')
            .select('full_name')
            .eq('id', member.sponsor_staff_id)
            .maybeSingle();
          if (sponsorError) throw sponsorError;
          return res.status(200).json(toMember(member, String(sponsor?.full_name ?? '')));
        }
        return fail(res, 'CONFLICT', 'Application is already approved', 409);
      }
      if (!REVIEWABLE.includes(String(app.status)))
        return fail(
          res,
          'CONFLICT',
          `An application with status ${String(app.status)} cannot be approved`,
          409,
        );

      // The sponsor is frozen: re-validate the STORED sponsor, never a body value.
      // An approval-time failure names the approval context and never swaps
      // the sponsor: the application keeps its sponsor until an operator acts.
      const sponsor = await validateApprovalSponsor(db, String(app.sponsor_staff_id));
      if (!sponsor.ok) return fail(res, 'CONFLICT', sponsor.message, 409);

      const { data: clashMember } = await db
        .from('ost_members')
        .select('id')
        .eq('application_id', id)
        .maybeSingle();
      if (clashMember)
        return fail(res, 'CONFLICT', 'An OST member already exists for this application', 409);
      const { data: emailMember } = await db
        .from('ost_members')
        .select('id')
        .eq('email', String(app.email))
        .maybeSingle();
      if (emailMember)
        return fail(res, 'CONFLICT', 'An OST member with this email already exists', 409);

      const { data: ostRole } = await db
        .from('roles')
        .select('id, slug, is_active')
        .eq('slug', 'ost')
        .maybeSingle();
      if (!ostRole?.is_active) return fail(res, 'CONFLICT', 'The OST role is not available', 409);

      const fullName = applicantName(app);
      const credentials = createAfHomesStaffSchema
        .pick({ temporaryPassword: true })
        .partial()
        .extend({ profilePhotoBase64: profilePhotoInputSchema.shape.dataBase64.optional() })
        .safeParse(jsonBody(req));
      if (!credentials.success)
        return fail(
          res,
          'VALIDATION_ERROR',
          'Use a temporary password of 8 to 128 characters.',
          400,
        );
      const temporaryPassword = credentials.data.temporaryPassword;
      if (
        credentials.data.profilePhotoBase64 &&
        !decodeProfilePhoto(credentials.data.profilePhotoBase64)
      )
        return fail(res, 'VALIDATION_ERROR', 'Choose a valid compressed profile photo.', 400);
      let invited;
      if (temporaryPassword) {
        invited = await db.auth.admin.createUser({
          email: String(app.email),
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });
      } else {
        // Preserve invitation compatibility for historical approval clients.
        const redirectTo = resolveAdminUrl();
        if (!redirectTo) return fail(res, 'INTERNAL', 'AFHOMES_ADMIN_URL is not configured', 500);
        invited = await db.auth.admin.inviteUserByEmail(String(app.email), {
          redirectTo,
          data: { full_name: fullName },
        });
      }
      if (invited.error || !invited.data?.user?.id)
        return fail(res, 'CONFLICT', 'Unable to create this OST account', 409);
      const ostUserId = invited.data.user.id;

      // An invitation response does not prove GoTrue created a NEW identity:
      // for an existing account it can hand back that account's id. Writing
      // (or later unwinding) rows under a pre-existing identity would corrupt
      // it, so a known staff identity for either the invited id or this email
      // stops the approval BEFORE any write, with nothing to clean up.
      const [{ data: idOwner, error: idOwnerError }, { data: emailOwner, error: emailOwnerError }] =
        await Promise.all([
          db.from('staff_users').select('id').eq('id', ostUserId).maybeSingle(),
          db.from('staff_users').select('id').eq('email', String(app.email)).maybeSingle(),
        ]);
      if (idOwnerError || emailOwnerError)
        return fail(
          res,
          'INTERNAL',
          'Account ownership could not be verified. Review the invitation before retrying.',
          500,
        );
      if (idOwner || emailOwner)
        return fail(
          res,
          'CONFLICT',
          'This email is already linked to an account. Review the existing identity before approving.',
          409,
        );

      let installed;
      if (credentials.data.profilePhotoBase64) {
        try {
          await saveProfilePhoto(ostUserId, credentials.data.profilePhotoBase64);
        } catch {
          // Password creation guarantees this request owns the new Auth identity.
          let cleanupFailed = !temporaryPassword;
          if (temporaryPassword) {
            const removed = await db.auth.admin.deleteUser(ostUserId);
            cleanupFailed = !!removed.error;
            try {
              await removeProfilePhoto(ostUserId);
            } catch {
              cleanupFailed = true;
            }
          }
          return fail(
            res,
            'INTERNAL',
            cleanupFailed
              ? 'Account cleanup needs administrator review before retrying.'
              : 'Could not save the profile photo. Please retry.',
            503,
          );
        }
      }
      try {
        installed = await db.rpc('install_legacy_ost_identity', {
          p_application_id: id,
          p_actor_id: auth.userId,
          p_auth_id: ostUserId,
        });
      } catch {
        // A lost response cannot establish whether the SQL transaction committed.
        try {
          await audit(
            db,
            auth.userId,
            'OST_APPROVAL_RECONCILIATION_REQUIRED',
            'ost_application',
            id,
            null,
            { authUserId: ostUserId, authIdentityRetained: true, databaseOutcome: 'unknown' },
          );
        } catch {
          console.error('[ost-approval] reconciliation audit unavailable', { applicationId: id });
        }
        return fail(
          res,
          'INTERNAL',
          'Approval could not be confirmed. Administrator reconciliation is required before retrying.',
          500,
        );
      }
      if (installed.error) {
        // The RPC is one SQL transaction; no compensating history deletion is needed.
        try {
          await audit(
            db,
            auth.userId,
            'OST_APPROVAL_PROVISIONING_FAILED',
            'ost_application',
            id,
            null,
            { authUserId: ostUserId, authIdentityRetained: true, databaseOutcome: 'rolled_back' },
          );
        } catch {
          console.error('[ost-approval] provisioning failure audit unavailable', {
            applicationId: id,
          });
        }
        if (installed.error.code === '23505')
          return fail(
            res,
            'CONFLICT',
            'An account already exists. Review the retained invitation and account before retrying.',
            409,
          );
        return fail(
          res,
          installed.error.code === '42501' ? 'FORBIDDEN' : 'INTERNAL',
          'OST installation failed. Review the retained invitation before retrying.',
          installed.error.code === '42501' ? 403 : 500,
        );
      }
      if (temporaryPassword) {
        const activated = await db
          .from('staff_users')
          .update({
            status: 'active',
            must_change_password: true,
            activated_at: new Date().toISOString(),
          })
          .eq('id', ostUserId)
          .eq('status', 'invited')
          .select('id')
          .maybeSingle();
        if (activated.error || !activated.data)
          return fail(res, 'INTERNAL', 'Account setup requires administrator reconciliation.', 500);
      }
      return res
        .status(201)
        .json(toMember(installed.data as Record<string, unknown>, sponsor.fullName));
    }

    /* ---------------- staff: reject ---------------- */
    const reject = route(req, 'POST', /^applications\/([0-9a-f-]+)\/reject$/);
    if (reject) {
      const auth = await authorizeAfHomes(req, 'network.ost_registrations', 'update');
      if ('error' in auth) return deny(res, auth);
      const id = reject[1]!;
      const parsed = rejectOstApplicationSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'A rejection requires a reason', 400);
      const { data: app, error: readError } = await db
        .from('ost_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!app) return fail(res, 'NOT_FOUND', 'OST application not found', 404);
      if (
        app.registration_details?.officialAccreditation &&
        /\/(reject|request-changes)$/.test(subPath(req))
      )
        return fail(res, 'CONFLICT', 'Use the official accreditation review workflow.', 409);
      if (!REVIEWABLE.includes(String(app.status)))
        return fail(
          res,
          'CONFLICT',
          `An application with status ${String(app.status)} cannot be rejected`,
          409,
        );
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await db
        .from('ost_applications')
        .update({
          status: 'rejected',
          reviewed_by: auth.userId,
          reviewed_at: now,
          review_notes: parsed.data.reason,
        })
        .eq('id', id)
        .select('*')
        .single();
      if (updateError) throw updateError;
      await audit(
        db,
        auth.userId,
        'OST_APPLICATION_REJECTED',
        'ost_application',
        id,
        { status: String(app.status) },
        {
          status: 'rejected',
          reason: parsed.data.reason,
        },
      );
      const row = updated as Record<string, unknown>;
      const [{ data: sponsor }, { data: code }] = await Promise.all([
        db.from('staff_users').select('full_name').eq('id', row.sponsor_staff_id).maybeSingle(),
        db.from('referral_codes').select('code_hint').eq('id', row.referral_code_id).maybeSingle(),
      ]);
      return res
        .status(200)
        .json(toApplication(row, String(sponsor?.full_name ?? ''), String(code?.code_hint ?? '')));
    }

    /* ---------------- staff: request changes ---------------- */
    const requestChanges = route(req, 'POST', /^applications\/([0-9a-f-]+)\/request-changes$/);
    if (requestChanges) {
      const auth = await authorizeAfHomes(req, 'network.ost_registrations', 'update');
      if ('error' in auth) return deny(res, auth);
      const id = requestChanges[1]!;
      const parsed = requestOstApplicationChangesSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Change requests require review notes', 400);
      const { data: app, error: readError } = await db
        .from('ost_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!app) return fail(res, 'NOT_FOUND', 'OST application not found', 404);
      if (
        app.registration_details?.officialAccreditation &&
        /\/(reject|request-changes)$/.test(subPath(req))
      )
        return fail(res, 'CONFLICT', 'Use the official accreditation review workflow.', 409);
      if (!['submitted', 'under_review'].includes(String(app.status)))
        return fail(
          res,
          'CONFLICT',
          `An application with status ${String(app.status)} cannot receive a change request`,
          409,
        );
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await db
        .from('ost_applications')
        .update({
          status: 'changes_requested',
          reviewed_by: auth.userId,
          reviewed_at: now,
          review_notes: parsed.data.notes,
        })
        .eq('id', id)
        .select('*')
        .single();
      if (updateError) throw updateError;
      await audit(
        db,
        auth.userId,
        'OST_APPLICATION_CHANGES_REQUESTED',
        'ost_application',
        id,
        { status: String(app.status) },
        { status: 'changes_requested', notes: parsed.data.notes },
      );
      const row = updated as Record<string, unknown>;
      const [{ data: sponsor }, { data: code }] = await Promise.all([
        db.from('staff_users').select('full_name').eq('id', row.sponsor_staff_id).maybeSingle(),
        db.from('referral_codes').select('code_hint').eq('id', row.referral_code_id).maybeSingle(),
      ]);
      return res
        .status(200)
        .json(toApplication(row, String(sponsor?.full_name ?? ''), String(code?.code_hint ?? '')));
    }

    /* ---------------- staff: members (scoped, OST owns self) ---------------- */
    const membersPath = subPath(req);
    const memberSingle = membersPath.match(/^members\/([0-9a-f-]+)$/);
    if ((membersPath === 'members' || memberSingle) && method(req) === 'GET') {
      const includeAccreditation = req.query.includeAccreditation === '1';
      const addNumbers = async <T extends { id: unknown }>(
        rows: T[],
      ): Promise<(T & { aaNumber?: string | null })[]> => {
        if (!includeAccreditation) return rows;
        const numbers = await storedAccreditationNumbers(
          db,
          rows.map((row) => String(row.id)),
        );
        return rows.map((row) => ({ ...row, aaNumber: numbers.get(String(row.id)) ?? null }));
      };
      const principal = await resolveAfHomesPrincipal(req);
      if ('error' in principal) return deny(res, principal);
      if (principal.mustChangePassword || principal.mfaRequired)
        return fail(res, 'FORBIDDEN', 'Complete account security setup before continuing.', 403);
      const single = memberSingle;
      const grants = principal.permissions.find((p) => p.moduleKey === 'network.ost_members');
      const canViewAll = grants?.canView === true;

      if (single) {
        const id = single[1]!;
        const { data, error } = await db.from('ost_members').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return fail(res, 'NOT_FOUND', 'OST member not found', 404);
        const isSelf = String(data.id) === principal.userId;
        const isSponsor = String(data.sponsor_staff_id) === principal.userId;
        if (!canViewAll && !(principal.roleSlug === 'ost' && isSelf))
          return fail(res, 'NOT_FOUND', 'OST member not found', 404);
        if (
          canViewAll &&
          sellerScoped(principal) &&
          principal.roleSlug === 'sales_manager' &&
          !isSponsor &&
          !isSelf
        )
          return fail(res, 'NOT_FOUND', 'OST member not found', 404);
        const { data: sponsor, error: sponsorError } = await db
          .from('staff_users')
          .select('full_name')
          .eq('id', data.sponsor_staff_id)
          .maybeSingle();
        if (sponsorError) throw sponsorError;
        return res
          .status(200)
          .json((await addNumbers([toMember(data, String(sponsor?.full_name ?? ''))]))[0]);
      }

      // OST without the module grant still reads exactly one row: itself.
      if (!canViewAll) {
        if (principal.roleSlug !== 'ost')
          return deny(res, {
            error: {
              error: { code: 'FORBIDDEN', message: 'Insufficient permission' },
              status: 403,
            },
          });
        const { data, error } = await db
          .from('ost_members')
          .select('*')
          .eq('id', principal.userId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return list(res, []);
        const { data: sponsor, error: sponsorError } = await db
          .from('staff_users')
          .select('full_name')
          .eq('id', data.sponsor_staff_id)
          .maybeSingle();
        if (sponsorError) throw sponsorError;
        const search = String(req.query.search ?? '').trim();
        if (search.length > 120) return fail(res, 'VALIDATION_ERROR', 'Search is too long', 400);
        const row = (await addNumbers([toMember(data, String(sponsor?.full_name ?? ''))]))[0]!;
        return list(
          res,
          matchesSearch(search, [
            row.fullName,
            row.email,
            row.phone,
            row.ostNumber,
            row.aaNumber,
            row.sponsorName,
            row.status,
          ])
            ? [row]
            : [],
        );
      }
      const search = String(req.query.search ?? '').trim();
      if (search.length > 120) return fail(res, 'VALIDATION_ERROR', 'Search is too long', 400);
      let query = db.from('ost_members').select('*').order('created_at', { ascending: false });
      if (principal.roleSlug === 'sales_manager')
        query = query.eq('sponsor_staff_id', principal.userId);
      const rows = await readSearchRows(query.order('id', { ascending: false }));
      const sponsorIds = [...new Set(rows.map((r) => String(r.sponsor_staff_id)))];
      const { data: sponsors } = sponsorIds.length
        ? await searchRelated(db, 'staff_users', sponsorIds, 'id, full_name')
        : { data: [] as unknown[] };
      const byId = new Map(
        ((sponsors ?? []) as Record<string, unknown>[]).map((s) => [
          String(s.id),
          String(s.full_name ?? ''),
        ]),
      );
      return list(
        res,
        (
          await addNumbers(rows.map((r) => toMember(r, byId.get(String(r.sponsor_staff_id)) ?? '')))
        ).filter((row) =>
          matchesSearch(search, [
            row.fullName,
            row.email,
            row.phone,
            row.ostNumber,
            row.aaNumber,
            row.sponsorName,
            row.status,
          ]),
        ),
      );
    }

    /* ---------------- staff: my referral codes ---------------- */
    if (subPath(req) === 'referral-codes/me' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'network.referrals');
      if ('error' in auth) return deny(res, auth);
      const selected =
        typeof req.query.sponsorStaffId === 'string' ? req.query.sponsorStaffId : auth.userId;
      if (!createOstReferralCodeSchema.shape.sponsorStaffId.safeParse(selected).success)
        return fail(res, 'VALIDATION_ERROR', 'Select a valid Sales Manager.', 400);
      const sponsorCheck = await validateReferralCodeIssuer(
        db,
        { userId: auth.userId, roleSlug: auth.roleSlug },
        selected,
      );
      if (!sponsorCheck.ok) return fail(res, 'FORBIDDEN', sponsorCheck.message, 403);
      const data = await readSearchRows(
        db
          .from('referral_codes')
          .select('id, code_hint, expires_at, max_uses, use_count, is_active, created_at')
          .eq('sponsor_staff_id', selected)
          .order('created_at', { ascending: false })
          .order('id'),
      );
      return list(
        res,
        ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: r.id,
          codeHint: r.code_hint,
          expiresAt: isoOrNull(r.expires_at) ?? '',
          maxUses: Number(r.max_uses ?? 0),
          useCount: Number(r.use_count ?? 0),
          isActive: r.is_active === true,
          createdAt: isoOrNull(r.created_at) ?? '',
        })),
      );
    }

    /* ---------------- staff: issue a referral code (SM self-service) ---------------- */
    if (subPath(req) === 'referral-codes' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'network.referrals');
      if ('error' in auth) return deny(res, auth);
      const parsed = createOstReferralCodeSchema.safeParse(jsonBody(req) ?? {});
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid referral code request', 400);

      // Sponsor defaults to self. A Super Admin (or any non-seller holding the
      // grant) may issue on behalf of an SM via an explicit sponsor field;
      // sellers may never name anyone but themselves.
      const body = jsonBody(req) as Record<string, unknown> | null;
      if (
        parsed.data.sponsorStaffId &&
        parsed.data.sponsorStaffId !== auth.userId &&
        !['admin', 'super_admin'].includes(auth.roleSlug)
      )
        return fail(
          res,
          'FORBIDDEN',
          'Only Admin or Super Admin may issue on behalf of another Sales Manager.',
          403,
        );
      let sponsorId = auth.userId;
      const requestedSponsor =
        typeof body?.sponsorStaffId === 'string' ? body.sponsorStaffId : undefined;
      if (requestedSponsor && requestedSponsor !== auth.userId) {
        if (sellerScoped(auth))
          return fail(res, 'FORBIDDEN', 'Sellers may only issue their own code', 403);
        sponsorId = requestedSponsor;
      }
      const sponsor = await validateReferralCodeIssuer(
        db,
        { userId: auth.userId, roleSlug: auth.roleSlug },
        sponsorId,
      );
      if (!sponsor.ok)
        return fail(
          res,
          sponsor.status === 403 ? 'FORBIDDEN' : 'CONFLICT',
          sponsor.message,
          sponsor.status,
        );

      const raw = newReferralCode();
      const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 3600000).toISOString();
      const { error } = await db.rpc('manage_ost_referral_code', {
        p_actor: auth.userId,
        p_sponsor: sponsor.id,
        p_rotate: parsed.data.rotate,
        p_hash: hashIdentifier(raw),
        p_hint: 'OST-?-' + raw.slice(-4),
        p_expires: expiresAt,
        p_max_uses: parsed.data.maxUses,
      });
      if (error) {
        if (error.message.startsWith('CONFLICT:'))
          return fail(
            res,
            'CONFLICT',
            'An active referral code already exists. Rotate it to generate a replacement.',
            409,
          );
        if (error.message.startsWith('FORBIDDEN:'))
          return fail(
            res,
            'FORBIDDEN',
            'Only authorized administrators or the active sponsoring Sales Manager may issue this code.',
            403,
          );
        if (error.message.startsWith('VALIDATION_ERROR:'))
          return fail(
            res,
            'VALIDATION_ERROR',
            'Check the referral code expiry and usage limit.',
            400,
          );
        throw error;
      }
      return res.status(201).json({
        code: raw,
        codeHint: 'OST-?-' + raw.slice(-4),
        expiresAt,
        maxUses: parsed.data.maxUses,
      });
    }

    /* ---------------- authenticated OST personal dashboard ---------------- */
    if (subPath(req) === 'me/dashboard' && method(req) === 'GET') {
      const anon = anonClient();
      if (!anon) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
      const token = extractBearerToken(req);
      if (!token) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
      const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
      const userId = authData?.user?.id;
      if (authError || !userId)
        return fail(res, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);
      const { data: staff, error: staffError } = await db
        .from('staff_users')
        .select('status,must_change_password')
        .eq('id', userId)
        .maybeSingle();
      if (staffError)
        return fail(res, 'INTERNAL', 'Account security verification is unavailable.', 503);
      if (!staff) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      if (staff.status !== 'active' || staff.must_change_password === true)
        return fail(res, 'FORBIDDEN', 'Set a new password before opening your OST portal.', 403);
      const { data: member, error } = await db
        .from('ost_members')
        .select('id, ost_number, full_name, email, status, sponsor_staff_id, approved_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!member) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      if (member.status !== 'active')
        return fail(res, 'FORBIDDEN', 'OST account is not active', 403);

      // Get head info (sponsor)
      const { data: sponsor, error: sponsorError } = await db
        .from('staff_users')
        .select('id, full_name, status')
        .eq('id', member.sponsor_staff_id)
        .maybeSingle();
      if (sponsorError) throw sponsorError;
      const { data: sponsorRole } = sponsor
        ? await db.from('staff_role_assignments').select('role_id').eq('staff_id', member.sponsor_staff_id).maybeSingle()
        : { data: null };
      const { data: sponsorRoleName } = sponsorRole
        ? await db.from('roles').select('slug').eq('id', sponsorRole.role_id).maybeSingle()
        : { data: null };

      const headInfo = {
        headId: sponsor?.id ?? '',
        headName: sponsor?.full_name ?? 'Unknown',
        headRole: sponsorRoleName?.slug ?? 'Unknown',
        headStatus: sponsor?.status ?? 'unknown',
        relationship: 'Direct Sponsor',
      };

      // Get personal sales (qualifying sales where this OST is the seller)
      const { data: sales, error: salesError } = await db
        .from('card_sales')
        .select('id, sale_number, status, created_at, cash_price_snapshot')
        .eq('origin', 'normal')
        .eq('seller_ost_id', userId)
        .order('created_at', { ascending: false });
      if (salesError) throw salesError;
      const qualifyingSales = (sales ?? []).filter((s: { status: string }) => s.status === 'active');
      const periodSales = qualifyingSales.length; // For now, all qualifying sales

      const salesInfo = {
        totalSales: qualifyingSales.length,
        periodSales,
        qualifyingSaleStatus: 'active',
      };

      // Get personal commissions
      const { data: commissions, error: commError } = await db
        .from('commissions')
        .select(`
          id,
          commission_number,
          sale_id,
          amount,
          status,
          qualified_at,
          earned_at,
          paid_at,
          created_at,
          card_sales!inner(sale_number)
        `)
        .eq('beneficiary_ost_id', userId)
        .order('created_at', { ascending: false });
      if (commError) throw commError;

      const commissionRecords = (commissions ?? []).map((row: any) => ({
        id: row.id,
        commissionNumber: row.commission_number ?? null,
        saleNumber: row.card_sales?.sale_number ?? '',
        amount: row.amount,
        status: row.status,
        qualifiedAt: row.qualified_at ?? null,
        earnedAt: row.earned_at ?? null,
        paidAt: row.paid_at ?? null,
        createdAt: row.created_at,
      }));

      // Calculate commission KPIs
      const toEarn = commissionRecords.filter((c: { status: string }) => ['pending', 'payment_verified', 'final_qualification_pending'].includes(c.status));
      const earned = commissionRecords.filter((c: { status: string }) => c.status === 'earned');
      const paid = commissionRecords.filter((c: { status: string }) => c.status === 'paid');
      const cancelled = commissionRecords.filter((c: { status: string }) => c.status === 'cancelled');

      const sumAmount = (records: { amount: string | null }[]) => records.reduce((sum, r) => {
        const match = String(r.amount ?? '0').match(/^(\d+)(?:\.(\d{1,2}))?$/);
        if (match) return sum + BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
        return sum;
      }, 0n);

      const formatAmount = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

      const commissionsInfo = {
        toEarn: {
          count: toEarn.length,
          amount: formatAmount(sumAmount(toEarn)),
        },
        earned: {
          count: earned.length,
          amount: formatAmount(sumAmount(earned)),
        },
        paid: {
          count: paid.length,
          amount: formatAmount(sumAmount(paid)),
        },
        cancelled: {
          count: cancelled.length,
          amount: formatAmount(sumAmount(cancelled)),
        },
      };

      const dashboardData = {
        head: headInfo,
        sales: salesInfo,
        commissions: commissionsInfo,
        commissionHistory: commissionRecords,
      };

      const parsed = ostDashboardSchema.safeParse(dashboardData);
      if (!parsed.success) return fail(res, 'INTERNAL', 'Dashboard data validation failed', 500);
      return res.status(200).json(parsed.data);
    }

    /* ---------------- authenticated OST personal sales list ---------------- */
    if (subPath(req) === 'me/sales' && method(req) === 'GET') {
      const anon = anonClient();
      if (!anon) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
      const token = extractBearerToken(req);
      if (!token) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
      const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
      const userId = authData?.user?.id;
      if (authError || !userId)
        return fail(res, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);
      const { data: staff, error: staffError } = await db
        .from('staff_users')
        .select('status,must_change_password')
        .eq('id', userId)
        .maybeSingle();
      if (staffError)
        return fail(res, 'INTERNAL', 'Account security verification is unavailable.', 503);
      if (!staff) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      if (staff.status !== 'active' || staff.must_change_password === true)
        return fail(res, 'FORBIDDEN', 'Set a new password before opening your OST portal.', 403);
      const { data: member, error: memberError } = await db
        .from('ost_members')
        .select('id, status')
        .eq('id', userId)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      if (member.status !== 'active')
        return fail(res, 'FORBIDDEN', 'OST account is not active', 403);

      const querySchema = z.object({
        status: z.string().trim().max(40).optional(),
        search: z.string().trim().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, search, limit, offset } = parsed.data;

      let query = db
        .from('card_sales')
        .select('id, sale_number, status, created_at, cash_price_snapshot, customer_id', { count: 'exact' })
        .eq('origin', 'normal')
        .eq('seller_ost_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (search) {
        query = query.or(`sale_number.ilike.%${search}%,customer_id.ilike.%${search}%`);
      }

      const { data: sales, error: salesError, count } = await query;
      if (salesError) throw salesError;

      // Fetch customer names for the sales
      const customerIds = [...new Set((sales ?? []).map((s: Record<string, unknown>) => s.customer_id).filter(Boolean))];
      const customerNames = new Map<string, { name: string; number: string }>();
      if (customerIds.length > 0) {
        const { data: customers } = await db
          .from('customers')
          .select('id, customer_number, first_name, last_name')
          .in('id', customerIds);
        for (const c of customers ?? []) {
          customerNames.set(c.id, {
            name: [c.first_name, c.last_name].filter(Boolean).join(' '),
            number: c.customer_number,
          });
        }
      }

      const salesRecords = (sales ?? []).map((s: Record<string, unknown>) => {
        const cust = customerNames.get(String(s.customer_id ?? ''));
        return {
          id: s.id,
          saleNumber: s.sale_number,
          customerName: cust?.name ?? null,
          customerNumber: cust?.number ?? null,
          status: s.status,
          cashPriceSnapshot: s.cash_price_snapshot,
          createdAt: s.created_at,
        };
      });

      const validated = ostSalesListSchema.safeParse({
        data: salesRecords,
        meta: { total: count ?? 0, limit, offset },
      });
      if (!validated.success) return fail(res, 'INTERNAL', 'Sales list validation failed', 500);
      return res.status(200).json(validated.data);
    }

    /* ---------------- authenticated OST personal commissions list ---------------- */
    if (subPath(req) === 'me/commissions' && method(req) === 'GET') {
      const anon = anonClient();
      if (!anon) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
      const token = extractBearerToken(req);
      if (!token) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
      const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
      const userId = authData?.user?.id;
      if (authError || !userId)
        return fail(res, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);
      const { data: staff, error: staffError } = await db
        .from('staff_users')
        .select('status,must_change_password')
        .eq('id', userId)
        .maybeSingle();
      if (staffError)
        return fail(res, 'INTERNAL', 'Account security verification is unavailable.', 503);
      if (!staff) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      if (staff.status !== 'active' || staff.must_change_password === true)
        return fail(res, 'FORBIDDEN', 'Set a new password before opening your OST portal.', 403);
      const { data: member, error: memberError } = await db
        .from('ost_members')
        .select('id, status')
        .eq('id', userId)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      if (member.status !== 'active')
        return fail(res, 'FORBIDDEN', 'OST account is not active', 403);

      const querySchema = z.object({
        status: z.string().trim().max(40).optional(),
        search: z.string().trim().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      });
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
      const { status, search, limit, offset } = parsed.data;

      let query = db
        .from('commissions')
        .select(
          'id, commission_number, sale_id, amount, status, qualified_at, earned_at, paid_at, created_at, card_sales!inner(sale_number)',
          { count: 'exact' },
        )
        .eq('beneficiary_ost_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (search) {
        query = query.or(`commission_number.ilike.%${search}%,sale_number.ilike.%${search}%`);
      }

      const { data: commissions, error: commError, count } = await query;
      if (commError) throw commError;

      const commissionRecords = (commissions ?? []).map((row: Record<string, unknown>) => {
        const sale = (row.card_sales ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          commissionNumber: row.commission_number ?? null,
          saleNumber: String(sale.sale_number ?? ''),
          amount: row.amount,
          status: row.status,
          qualifiedAt: row.qualified_at ?? null,
          earnedAt: row.earned_at ?? null,
          paidAt: row.paid_at ?? null,
          createdAt: row.created_at,
        };
      });

      const validated = ostCommissionsListSchema.safeParse({
        data: commissionRecords,
        meta: { total: count ?? 0, limit, offset },
      });
      if (!validated.success) return fail(res, 'INTERNAL', 'Commissions list validation failed', 500);
      return res.status(200).json(validated.data);
    }

    return fail(res, 'NOT_FOUND', 'OST endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] ost:', error instanceof Error ? error.message : error);
    return mapRpcError(res, error as { message?: string });
  }
}
