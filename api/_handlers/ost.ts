/**
 * AF Homes Phase 8 - OST registration and approval (SM -> OST).
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

import {
  OST_REVIEWABLE_STATUSES,
  createOstReferralCodeSchema,
  normalizeOstReferralCode,
  ostMeSchema,
  ostReferralCodeSchema,
  rejectOstApplicationSchema,
  requestOstApplicationChangesSchema,
  submitOstApplicationSchema,
} from '@jad/contracts';

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

function newOstNumberFallback(): string {
  const hex = randomBytes(3).toString('hex').toUpperCase();
  return `OST-${hex}`;
}

async function nextOstNumber(db: Db): Promise<string> {
  try {
    const { data, error } = await db.rpc('next_ost_number');
    if (!error && data) {
      const value = Array.isArray(data) ? data[0] : data;
      const text =
        typeof value === 'string'
          ? value
          : String((value as Record<string, unknown>)?.ost_number ?? '');
      if (text) return text;
    }
  } catch {
    // Sequence missing (pre-migration database): fall back to a local value.
  }
  return newOstNumberFallback();
}

type SponsorCheck =
  | { ok: true; id: string; fullName: string; email: string }
  | { ok: false; status: 403 | 404 | 409; message: string };

/**
 * OST sponsorship validation: the sponsor of an OST referral code must be an
 * ACTIVE SALES MANAGER holding an active role.
 *
 * This rule belongs ONLY to the OST sponsorship context (public code
 * resolution, public application submission, and the approval re-check),
 * because an approved OST is inserted into the genealogy as `ost` directly
 * under a `sales_manager`. It must never be reused for customer/card-sale
 * referrals or for generic referral-code issuance - those contexts have
 * their own validators below.
 */
async function validateOstSponsor(db: Db, sponsorStaffId: string): Promise<SponsorCheck> {
  const { data: staff } = await db
    .from('staff_users')
    .select('id, full_name, email, status')
    .eq('id', sponsorStaffId)
    .maybeSingle();
  if (!staff) return { ok: false, status: 404, message: 'Sponsor not found' };
  if (staff.status !== 'active')
    return { ok: false, status: 409, message: 'The sponsoring Sales Manager is not active' };
  const { data: assignment } = await db
    .from('staff_role_assignments')
    .select('role_id')
    .eq('staff_id', sponsorStaffId)
    .maybeSingle();
  if (!assignment?.role_id)
    return { ok: false, status: 409, message: 'Sponsor holds no sales role' };
  const { data: role } = await db
    .from('roles')
    .select('slug, is_active')
    .eq('id', assignment.role_id)
    .maybeSingle();
  if (!role?.is_active || role.slug !== 'sales_manager')
    return { ok: false, status: 409, message: 'Referrals must come from an active Sales Manager' };
  return {
    ok: true,
    id: String(staff.id),
    fullName: String(staff.full_name),
    email: String(staff.email),
  };
}

/**
 * Approval-time re-validation of the FROZEN sponsor.
 *
 * The sponsor was fixed at submission and is never changed here; when they no
 * longer qualify, approval is refused with an approval-specific error so an
 * operator knows the application needs sponsor attention, not a resubmit.
 */
async function validateApprovalSponsor(
  db: Db,
  sponsorStaffId: string,
): Promise<SponsorCheck> {
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
  if (sponsorId === caller.userId && caller.roleSlug !== 'sales_manager') {
    return {
      ok: false,
      status: 403,
      message:
        'Only an active Sales Manager can sponsor an OST referral code. ' +
        'Ask a Sales Manager for their code, or have an administrator issue one on their behalf.',
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

/** True when the address already has a reviewable application (case-insensitive). */
async function hasReviewableApplication(db: Db, email: string): Promise<boolean> {
  const { data } = await db
    .from('ost_applications')
    .select('id, email, status')
    .in('status', REVIEWABLE);
  const rows = ((data ?? []) as Record<string, unknown>[]).filter((r) =>
    REVIEWABLE.includes(String(r.status)),
  );
  const needle = email.trim().toLowerCase();
  return rows.some((r) => String(r.email ?? '').toLowerCase() === needle);
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
      const { data: member, error } = await db
        .from('ost_members')
        .select('id, ost_number, full_name, email, status, sponsor_staff_id, approved_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!member) return fail(res, 'NOT_FOUND', 'No OST record found for this sign-in', 404);
      const { data: sponsor } = await db
        .from('staff_users')
        .select('full_name')
        .eq('id', member.sponsor_staff_id)
        .maybeSingle();
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

    /* ---------------- public: submit an application ---------------- */
    if (subPath(req) === 'applications' && method(req) === 'POST') {
      const verdict = consumeIdentifierAttempt(req, 'public-ost-submit');
      if (!verdict.allowed)
        return fail(res, 'RATE_LIMITED', 'Too many attempts. Try again shortly.', 429);
      const parsed = submitOstApplicationSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid OST application', 400);
      const input = parsed.data;

      const checked = await resolveCode(db, input.referralCode);
      if (!checked.ok)
        return fail(
          res,
          checked.status === 404 ? 'NOT_FOUND' : 'CONFLICT',
          checked.message,
          checked.status,
        );

      // Self-referral: the applicant cannot be their own sponsor.
      if (input.email.trim().toLowerCase() === checked.sponsor.email.trim().toLowerCase())
        return fail(
          res,
          'VALIDATION_ERROR',
          'The sponsor cannot sponsor their own application',
          400,
        );

      // A registered staff/OST email cannot apply again.
      const { data: existingStaff } = await db
        .from('staff_users')
        .select('id')
        .eq('email', input.email)
        .maybeSingle();
      if (existingStaff)
        return fail(res, 'CONFLICT', 'An account with this email already exists', 409);
      const { data: existingMember } = await db
        .from('ost_members')
        .select('id')
        .eq('email', input.email)
        .maybeSingle();
      if (existingMember)
        return fail(res, 'CONFLICT', 'An OST member with this email already exists', 409);

      if (await hasReviewableApplication(db, input.email))
        return fail(res, 'CONFLICT', 'An application with this email is already under review', 409);

      // The sponsor is frozen from the code. Any `sponsorStaffId` smuggled in
      // the body is not part of the schema and is ignored here by construction.
      const { data, error } = await db
        .from('ost_applications')
        .insert({
          referral_code_id: checked.codeRow.id,
          sponsor_staff_id: checked.sponsor.id,
          email: input.email,
          phone: input.phone,
          first_name: input.firstName,
          middle_name: input.middleName ?? null,
          last_name: input.lastName,
          birth_date: input.birthDate,
          address: input.address,
          registration_details: {},
          status: 'submitted',
        })
        .select('*')
        .single();
      if (error) {
        if ((error as { code?: string }).code === '23505')
          return fail(
            res,
            'CONFLICT',
            'An application with this email is already under review',
            409,
          );
        throw error;
      }
      const row = data as Record<string, unknown>;

      // Consume one use of the code. Best-effort under concurrency: the
      // CHECK (use_count <= max_uses) is the backstop and a retryable insert
      // above already serialized on the pending-email guard.
      await db
        .from('referral_codes')
        .update({ use_count: Number(checked.codeRow.use_count ?? 0) + 1 })
        .eq('id', checked.codeRow.id);

      await audit(
        db,
        checked.sponsor.id,
        'OST_APPLICATION_SUBMITTED',
        'ost_application',
        String(row.id),
        null,
        {
          applicationId: String(row.id),
          sponsorStaffId: checked.sponsor.id,
          status: 'submitted',
        },
      );
      return res.status(201).json({
        applicationId: String(row.id),
        referenceNumber: String(row.id),
        status: 'submitted',
        submittedAt: isoOrNull(row.submitted_at) ?? new Date().toISOString(),
      });
    }

    /* ---------------- staff: list applications (scoped) ---------------- */
    if (subPath(req) === 'applications' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'network.ost_registrations');
      if ('error' in auth) return deny(res, auth);
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
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      const sponsorIds = [...new Set(rows.map((r) => String(r.sponsor_staff_id)))];
      const codeIds = [...new Set(rows.map((r) => String(r.referral_code_id)))];
      const [{ data: sponsors }, { data: codes }] = await Promise.all([
        sponsorIds.length
          ? db.from('staff_users').select('id, full_name').in('id', sponsorIds)
          : Promise.resolve({ data: [] }),
        codeIds.length
          ? db.from('referral_codes').select('id, code_hint').in('id', codeIds)
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
        rows.map((r) =>
          toApplication(
            r,
            sponsorById.get(String(r.sponsor_staff_id)) ?? '',
            hintById.get(String(r.referral_code_id)) ?? '',
          ),
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

      // Idempotent repeat: an approved application returns its member.
      if (app.status === 'approved') {
        const { data: member } = await db
          .from('ost_members')
          .select('*')
          .eq('application_id', id)
          .maybeSingle();
        if (member) {
          const { data: sponsor } = await db
            .from('staff_users')
            .select('full_name')
            .eq('id', member.sponsor_staff_id)
            .maybeSingle();
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
      const redirectTo = resolveAdminUrl();
      if (!redirectTo) return fail(res, 'INTERNAL', 'AFHOMES_ADMIN_URL is not configured', 500);
      const invited = (await db.auth.admin.inviteUserByEmail(String(app.email), {
        redirectTo,
        data: { full_name: fullName },
      })) as { data?: { user?: { id: string } | null }; error?: { message?: string } | null };
      if (invited.error || !invited.data?.user?.id)
        return fail(res, 'CONFLICT', 'Unable to invite this email address', 409);
      const ostUserId = invited.data.user.id;

      try {
        const now = new Date().toISOString();
        const ostNumber = await nextOstNumber(db);

        const { error: staffError } = await db.from('staff_users').insert({
          id: ostUserId,
          email: String(app.email),
          full_name: fullName,
          department_id: null,
          status: 'invited',
          invited_at: now,
        });
        if (staffError) throw staffError;

        const { error: assignmentError } = await db.from('staff_role_assignments').insert({
          staff_id: ostUserId,
          role_id: ostRole.id,
          assigned_by: auth.userId,
        });
        if (assignmentError) throw assignmentError;

        const { error: invitationError } = await db.from('staff_invitations').insert({
          email: String(app.email),
          full_name: fullName,
          role_id: ostRole.id,
          department_id: null,
          invited_by: auth.userId,
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
          auth_user_id: ostUserId,
        });
        if (invitationError) throw invitationError;

        const { data: memberRow, error: memberError } = await db
          .from('ost_members')
          .insert({
            id: ostUserId,
            application_id: id,
            sponsor_staff_id: sponsor.id,
            ost_number: ostNumber,
            full_name: fullName,
            email: String(app.email),
            phone: String(app.phone),
            status: 'active',
            approved_by: auth.userId,
            approved_at: now,
          })
          .select('*')
          .single();
        if (memberError) throw memberError;

        // SM -> OST genealogy edge. The Phase 7 trigger re-validates exact
        // adjacency (ost under sales_manager), one active upline, and cycles;
        // a violation surfaces here and rolls the approval back via cleanup.
        const { data: edge, error: edgeError } = await db
          .from('referral_relationships')
          .insert({
            subject_staff_id: ostUserId,
            upline_staff_id: sponsor.id,
            hierarchy_role: 'ost',
            is_authoritative: true,
            is_active: true,
            assigned_by: auth.userId,
          })
          .select('*')
          .single();
        if (edgeError) throw edgeError;

        const { data: updated, error: updateError } = await db
          .from('ost_applications')
          .update({ status: 'approved', reviewed_by: auth.userId, reviewed_at: now })
          .eq('id', id)
          .select('*')
          .single();
        if (updateError) throw updateError;
        void updated;

        await audit(
          db,
          auth.userId,
          'OST_APPLICATION_APPROVED',
          'ost_application',
          id,
          { status: String(app.status) },
          {
            status: 'approved',
            sponsorStaffId: sponsor.id,
            ostMemberId: ostUserId,
            genealogyRelationshipId: String((edge as { id: string }).id),
          },
        );
        await audit(db, auth.userId, 'OST_MEMBER_ACTIVATED', 'ost_member', ostUserId, null, {
          applicationId: id,
          sponsorStaffId: sponsor.id,
          ostNumber,
        });
        return res
          .status(201)
          .json(toMember(memberRow as Record<string, unknown>, sponsor.fullName));
      } catch (error) {
        // The invitation created an Auth user with no usable identity: remove
        // it so a retry starts clean. A pre-existing user is never destroyed
        // because this run created this one.
        try {
          await db.auth.admin.deleteUser(ostUserId);
        } catch {
          // Cleanup is best-effort; the original error is what matters.
        }
        if ((error as { code?: string })?.code === '23505')
          return fail(res, 'CONFLICT', 'An OST member for this application already exists', 409);
        return mapRpcError(res, error as { message?: string });
      }
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
      const principal = await resolveAfHomesPrincipal(req);
      if ('error' in principal) return deny(res, principal);
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
        const { data: sponsor } = await db
          .from('staff_users')
          .select('full_name')
          .eq('id', data.sponsor_staff_id)
          .maybeSingle();
        return res.status(200).json(toMember(data, String(sponsor?.full_name ?? '')));
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
        const { data: sponsor } = await db
          .from('staff_users')
          .select('full_name')
          .eq('id', data.sponsor_staff_id)
          .maybeSingle();
        return list(res, [toMember(data, String(sponsor?.full_name ?? ''))]);
      }
      let query = db.from('ost_members').select('*').order('created_at', { ascending: false });
      if (principal.roleSlug === 'sales_manager')
        query = query.eq('sponsor_staff_id', principal.userId);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      const sponsorIds = [...new Set(rows.map((r) => String(r.sponsor_staff_id)))];
      const { data: sponsors } = sponsorIds.length
        ? await db.from('staff_users').select('id, full_name').in('id', sponsorIds)
        : { data: [] as unknown[] };
      const byId = new Map(
        ((sponsors ?? []) as Record<string, unknown>[]).map((s) => [
          String(s.id),
          String(s.full_name ?? ''),
        ]),
      );
      return list(
        res,
        rows.map((r) => toMember(r, byId.get(String(r.sponsor_staff_id)) ?? '')),
      );
    }

    /* ---------------- staff: my referral codes ---------------- */
    if (subPath(req) === 'referral-codes/me' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'network.referrals');
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('referral_codes')
        .select('id, code_hint, expires_at, max_uses, use_count, is_active, created_at')
        .eq('sponsor_staff_id', auth.userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const webBase = process.env.AFHOMES_WEB_URL ?? '';
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

      const { data: existing } = await db
        .from('referral_codes')
        .select('id, expires_at, is_active')
        .eq('sponsor_staff_id', sponsor.id);
      const live = ((existing ?? []) as Record<string, unknown>[]).filter(
        (r) =>
          r.is_active === true &&
          (!r.expires_at || new Date(String(r.expires_at)).valueOf() > Date.now()),
      );
      if (live.length >= 10)
        return fail(
          res,
          'CONFLICT',
          'This sponsor already has the maximum number of live codes',
          409,
        );

      const raw = newReferralCode();
      const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 3600000).toISOString();
      const { data, error } = await db
        .from('referral_codes')
        .insert({
          code_hash: hashIdentifier(raw),
          code_hint: `OST-…-${raw.slice(-4)}`,
          sponsor_staff_id: sponsor.id,
          expires_at: expiresAt,
          max_uses: parsed.data.maxUses,
          use_count: 0,
          is_active: true,
          created_by: auth.userId,
        })
        .select('id, code_hint, expires_at, max_uses')
        .single();
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          // 48-bit collision: astronomically unlikely, safely retryable once.
          return fail(res, 'CONFLICT', 'Code collision. Please retry.', 409);
        }
        throw error;
      }
      await audit(
        db,
        auth.userId,
        'REFERRAL_CODE_ISSUED',
        'referral_code',
        String((data as { id: string }).id),
        null,
        {
          sponsorStaffId: sponsor.id,
          maxUses: parsed.data.maxUses,
          expiresAt,
        },
      );
      return res.status(201).json({
        code: raw,
        codeHint: String((data as { code_hint: string }).code_hint),
        expiresAt,
        maxUses: parsed.data.maxUses,
      });
    }

    return fail(res, 'NOT_FOUND', 'OST endpoint not found', 404);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api] ost:', error instanceof Error ? error.message : error);
    return mapRpcError(res, error as { message?: string });
  }
}
