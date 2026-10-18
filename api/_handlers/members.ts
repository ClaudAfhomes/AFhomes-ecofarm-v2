import { validateOstSponsor } from '../_lib/ost-sponsor.js';
import { verifyOstAddress } from '../_lib/ost-address.js';
/**
 * AFHomes sales-network Members.
 *
 * Hierarchy sellers (Vice Director, Senior Sales Manager, Sales Manager)
 * onboarded with a full personal record. A Member IS a staff account: creation
 * provisions the Auth login (administrator-set temporary password, forced
 * change on first sign-in) and stores the extra form fields on the linked
 * `network_member_profiles` row.
 *
 * OST has its own pipeline (application, sponsor, term, AA number). This
 * handler offers the two management paths into it: `POST /members/ost` creates
 * one directly - either completing it (both signatures and the approved
 * validity are stated, so management approves on the spot) or saving it
 * pending for the sponsored workflow - and `POST /members/:id/transfer`
 * changes a member's accreditation kind, retiring the held number into the
 * accreditation history and issuing the successor in the same transaction.
 *
 * Sensitivity follows the customer record: TIN and the government ID number
 * are accepted on write, masked on every list-shaped read, and never appear in
 * an audit payload. The single-member read additionally returns the two
 * fields in clear so the members console can show the administrator what was
 * recorded; that read stays behind the members permission. The client sends
 * the position slug; the server resolves the role row, so a tampered role id
 * cannot escalate.
 */
import {
  MEMBER_POSITION_LABELS,
  MEMBER_UPLINE_ROLE,
  afHomesModuleKeySchema,
  createMemberSchema,
  createOstMemberResultSchema,
  createOstMemberSchema,
  hierarchyAllowsUpline,
  issueAccreditationSchema,
  maskGovernmentId,
  memberDetailSchema,
  memberListQuerySchema,
  memberSchema,
  transferMemberSchema,
  transferOstTeamSchema,
  updateMemberProfileSchema,
  type AfHomesPermission,
  type CreateMember,
  type Member,
  type MemberPosition,
} from '@afhomes/contracts';

import { authorizeAfHomes, permissionsAreSubset } from '../_lib/afhomes-access.js';
import { AddressProviderError } from '../_lib/address-provider.js';
import { addressProvider } from '../_lib/address-source.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  method,
  route,
  singleRpcRow,
  subPath,
  type Db,
} from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { createAndInstallDirectOst, ostDirectFailure } from '../_lib/ost-direct-create.js';
import { serviceClient } from '../_lib/rest.js';

const MEMBER_ROLES: readonly MemberPosition[] = [
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
];

/** Display order of an OST applicant's name from the official identity. */
function ostFullName(identity: {
  firstName: string;
  middleName?: string | undefined;
  lastName: string;
}): string {
  return [identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(' ');
}

async function accreditationNumber(db: Db, staffId: string): Promise<string | null> {
  const { data, error } = await db.rpc('get_sale_team_accreditation', { p_staff_id: staffId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const number = row && typeof row === 'object' ? (row as Record<string, unknown>).aaNumber : null;
  return typeof number === 'string' ? number : null;
}

type RoleRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  permissions: AfHomesPermission[];
};

/**
 * Map an accreditation RPC failure onto a client error. Returns true when
 * handled (response already written). Raw driver text never reaches the
 * client; the caller logs it via mapRpcError-style console output.
 */
function accreditationFailure(
  res: VercelResponse,
  error: { message?: string } | null,
  manual: string | null,
): boolean {
  const message = String(error?.message ?? '');
  const [code] = message.split(':');
  if (code === 'ACCREDITATION_NUMBER_TAKEN') {
    fail(res, 'CONFLICT', 'This AA number is already issued', 409);
    return true;
  }
  if (code === 'INVALID_ACCREDITATION_NUMBER') {
    fail(res, 'VALIDATION_ERROR', 'Use AA plus up to 12 letters/digits', 400);
    return true;
  }
  // The 7-argument function lives in the manual-AA migration: without it the
  // manual call cannot resolve, while AUTO keeps working on any database.
  if (manual && /does not exist|PGRST204|could not find|schema cache/i.test(message)) {
    fail(res, 'INTERNAL', 'Manual AA numbers are not enabled yet', 500);
    return true;
  }
  return false;
}

/** Friendly duplicate check for a typed AA number, before any write. */
async function aaNumberTaken(db: Db, aaNumber: string): Promise<boolean> {
  const { data, error } = await db.rpc('search_sale_team_accreditation', {
    p_aa_number: aaNumber,
  });
  return !error && singleRpcRow(data) !== null;
}

type ResolvedMemberLocation =
  | {
      ok: true;
      province: string;
      cityMunicipality: string;
      provinceCode: string;
      cityMunicipalityCode: string;
      zipCode: string;
    }
  | { ok: false; status: number; message: string };

/**
 * Re-resolve a submitted province/city pair against the PSGC reference and
 * align the saved address to authority names and codes. A hand-crafted body
 * that pairs a province with another province's city is refused, like the
 * application flow - the browser is not the boundary. An outage is not an
 * approval: an unverifiable pair is refused rather than saved unverified.
 *
 * The ZIP is the operator's, not the reference's. PSGC publishes a wrong postal
 * code often enough to matter (Victoria, Laguna is 4011 and it answers 4018)
 * and publishes none for a third of localities, so its value is only ever a
 * suggestion the browser prefills: a sent ZIP wins, and the published one is
 * the fallback for a payload that carried none.
 */
async function resolveMemberLocation(
  input: Pick<
    CreateMember,
    'province' | 'cityMunicipality' | 'provinceCode' | 'cityMunicipalityCode' | 'zipCode'
  >,
): Promise<ResolvedMemberLocation> {
  const refused = (status: number, message: string): ResolvedMemberLocation => ({
    ok: false,
    status,
    message,
  });
  const provider = addressProvider();
  let provinces: Awaited<ReturnType<typeof provider.provinces>>;
  let localities: Awaited<ReturnType<typeof provider.localities>>;
  try {
    [provinces, localities] = await Promise.all([
      provider.provinces(),
      provider.localities(input.provinceCode),
    ]);
  } catch (error) {
    if (error instanceof AddressProviderError)
      return refused(503, 'The address list is temporarily unavailable. Try again shortly.');
    throw error;
  }
  const province = provinces.find((p) => p.code === input.provinceCode) ?? null;
  const locality = localities.find((l) => l.code === input.cityMunicipalityCode) ?? null;
  if (!province || !locality || locality.provinceCode !== province.code)
    return refused(400, 'Choose the province and city from the list.');
  return {
    ok: true,
    province: province.name,
    cityMunicipality: locality.name,
    provinceCode: province.code,
    cityMunicipalityCode: locality.code,
    zipCode: input.zipCode || locality.postalCode || '',
  };
}

/**
 * Flatten a Zod safeParse failure into field-keyed messages for the client.
 * Capped so one bad payload cannot produce an unbounded envelope. The server
 * message stays generic; the details carry the per-field reasons.
 */
function fieldDetails(parsed: {
  error?: { issues?: Array<{ path: Array<string | number | symbol>; message: string }> };
}): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of parsed.error?.issues ?? []) {
    if (Object.keys(details).length >= 8) break;
    details[issue.path.map(String).join('.') || 'form'] = issue.message;
  }
  return details;
}

async function roleCatalog(db: Db, complete = false): Promise<RoleRow[]> {
  const options = complete ? { count: 'exact' as const } : undefined;
  const results = await Promise.all([
    db.from('roles').select('id,slug,name,is_active', options),
    db
      .from('role_permissions')
      .select('role_id,module_id,can_view,can_create,can_update,can_delete', options),
    db.from('modules').select('id,key', options),
  ]);
  if (complete && results.some((r) => r.error || r.count !== (r.data?.length ?? 0)))
    throw new Error('Workbook role reference is unavailable or truncated');
  const [{ data: roles }, { data: grants }, { data: modules }] = results;
  const keyById = new Map<string, string>(
    ((modules ?? []) as { id: string; key: string }[]).map((m) => [m.id, m.key]),
  );
  const grantsByRole = new Map<string, AfHomesPermission[]>();
  for (const g of (grants ?? []) as Record<string, unknown>[]) {
    const parsedKey = afHomesModuleKeySchema.safeParse(keyById.get(String(g.module_id)));
    // Unknown module rows cannot authorize anything: fail closed, skip them.
    if (!parsedKey.success) continue;
    const rows = grantsByRole.get(String(g.role_id)) ?? [];
    rows.push({
      moduleKey: parsedKey.data,
      canView: g.can_view === true,
      canCreate: g.can_create === true,
      canUpdate: g.can_update === true,
      canDelete: g.can_delete === true,
    });
    grantsByRole.set(String(g.role_id), rows);
  }
  return ((roles ?? []) as { id: string; slug: string; name: string; is_active: boolean }[]).map(
    (r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      is_active: r.is_active === true,
      permissions: grantsByRole.get(String(r.id)) ?? [],
    }),
  );
}

function toMember(
  staff: Record<string, unknown>,
  profile: Record<string, unknown> | null,
  position: MemberPosition,
  departmentName: string | null,
  referrerName: string | null,
  ostReferrerName: string | null,
  aaNumber: string | null,
) {
  return memberSchema.parse({
    id: String(staff.id),
    employeeNumber: (staff.employee_number as string | null | undefined) ?? null,
    fullName: String(staff.full_name),
    email: String(staff.email),
    position,
    positionLabel: MEMBER_POSITION_LABELS[position],
    departmentName,
    status: String(staff.status),
    referrerName,
    ostReferrerName,
    referrerStaffId: (profile?.referrer_staff_id as string | undefined) ?? null,
    ostReferrerStaffId: (profile?.ost_referrer_staff_id as string | undefined) ?? null,
    aaNumber,
    dateOfBirth: isoOrNull(profile?.date_of_birth)
      ? String(profile?.date_of_birth).slice(0, 10)
      : null,
    sex: (profile?.sex as string | undefined) ?? null,
    civilStatus: (profile?.civil_status as string | undefined) ?? null,
    streetNo: (profile?.street_no as string | undefined) ?? null,
    cityMunicipality: (profile?.city_municipality as string | undefined) ?? null,
    province: (profile?.province as string | undefined) ?? null,
    provinceCode: (profile?.province_code as string | undefined) ?? null,
    cityMunicipalityCode: (profile?.city_municipality_code as string | undefined) ?? null,
    zipCode: (profile?.zip_code as string | undefined) ?? null,
    telNo: (profile?.tel_no as string | undefined) ?? null,
    mobileNo: (profile?.mobile_no as string | undefined) ?? null,
    fbMessenger: (profile?.fb_messenger as string | undefined) ?? null,
    employerName: (profile?.employer_name as string | undefined) ?? null,
    employerAddress: (profile?.employer_address as string | undefined) ?? null,
    jobPosition: (profile?.job_position as string | undefined) ?? null,
    governmentIdType: (profile?.government_id_type as string | undefined) ?? null,
    tinMasked: maskGovernmentId(isoOrNull(profile?.tin)),
    governmentIdMasked: maskGovernmentId(isoOrNull(profile?.government_id_number)),
    createdAt: String(staff.created_at),
  });
}

/**
 * Active holders of a position, for onboarding pickers. `asUpline` resolves
 * the position through the head chain (a Vice Director has no head, so the
 * picker is empty); otherwise the position names the holders directly (the
 * OST referrer picker).
 */
async function roleHolders(
  db: Db,
  position: MemberPosition,
  asUpline: boolean,
): Promise<
  { id: string; fullName: string; employeeNumber: string | null; positionLabel: string }[]
> {
  const slug = asUpline ? MEMBER_UPLINE_ROLE[position] : position;
  if (!slug) return [];
  const roles = await roleCatalog(db);
  const target = roles.find((r) => r.slug === slug);
  if (!target) return [];
  const [{ data: assignments }, { data: staff }] = await Promise.all([
    db.from('staff_role_assignments').select('staff_id,role_id').eq('role_id', target.id),
    db.from('staff_users').select('id,full_name,status,employee_number'),
  ]);
  const ids = new Set(
    ((assignments ?? []) as Record<string, unknown>[]).map((a) => String(a.staff_id)),
  );
  return ((staff ?? []) as Record<string, unknown>[])
    .filter((s) => ids.has(String(s.id)) && String(s.status) === 'active')
    .map((s) => ({
      id: String(s.id),
      fullName: String(s.full_name),
      employeeNumber: (s.employee_number as string | null | undefined) ?? null,
      positionLabel: target.name,
    }));
}

async function memberRows(db: Db, search: string, position?: MemberPosition, workbook = false) {
  const options = workbook ? { count: 'exact' as const } : undefined;
  const [
    { data: staff, error: staffError, count: staffCount },
    { data: assignments, error: assignmentsError, count: assignmentsCount },
    { data: profiles, error: profilesError, count: profilesCount },
    { data: departments, error: departmentsError, count: departmentsCount },
    { data: ostEdges, error: ostEdgesError, count: edgesCount },
  ] = await Promise.all([
    db
      .from('staff_users')
      .select('id,email,full_name,status,department_id,employee_number,created_at', options)
      .order('created_at', { ascending: false }),
    db.from('staff_role_assignments').select('staff_id,role_id', options),
    db
      .from('network_member_profiles')
      .select(
        'staff_id,date_of_birth,sex,civil_status,street_no,city_municipality,province,province_code,city_municipality_code,zip_code,tel_no,mobile_no,fb_messenger,tin,employer_name,employer_address,job_position,government_id_type,government_id_number,referrer_staff_id,ost_referrer_staff_id',
        options,
      ),
    db.from('departments').select('id,name', options),
    db
      .from('referral_relationships')
      .select('subject_staff_id,upline_staff_id', options)
      .eq('hierarchy_role', 'ost')
      .eq('is_active', true)
      .eq('is_authoritative', true),
  ]);
  if (ostEdgesError) throw ostEdgesError;
  if (workbook && (staffError || assignmentsError || profilesError || departmentsError))
    throw new Error('Workbook member reference read failed');
  // shortcut: roster references use one response; paginate before their server cap blocks workbooks.
  if (
    workbook &&
    [
      [staff, staffCount],
      [assignments, assignmentsCount],
      [profiles, profilesCount],
      [departments, departmentsCount],
      [ostEdges, edgesCount],
    ].some(([rows, count]) => count !== (Array.isArray(rows) ? rows.length : 0))
  )
    throw new Error('Workbook reference is truncated; pagination is required before import/export');
  const ostHeadByStaff = new Map(
    (ostEdges ?? []).map((edge: Record<string, unknown>) => [
      String(edge.subject_staff_id),
      String(edge.upline_staff_id),
    ]),
  );
  const roles = await roleCatalog(db, workbook);
  const roleById = new Map(roles.map((r: RoleRow) => [r.id, r]));
  const assignmentByStaff = new Map(
    ((assignments ?? []) as Record<string, unknown>[]).map((a) => [
      String(a.staff_id),
      String(a.role_id),
    ]),
  );
  const profileByStaff = new Map(
    ((profiles ?? []) as Record<string, unknown>[]).map((p) => [String(p.staff_id), p]),
  );
  const deptById = new Map(
    ((departments ?? []) as { id: string; name: string }[]).map((d) => [
      String(d.id),
      String(d.name),
    ]),
  );
  const nameByStaff = new Map(
    ((staff ?? []) as Record<string, unknown>[]).map((s) => [String(s.id), String(s.full_name)]),
  );
  const term = search.trim().toLowerCase();
  const candidates = ((staff ?? []) as Record<string, unknown>[]).flatMap((s) => {
    // The assignment table holds one row per staff; the role IS the position.
    const staffRole = roleById.get(assignmentByStaff.get(String(s.id)) ?? '');
    const memberPosition =
      staffRole && (MEMBER_ROLES as readonly string[]).includes(staffRole.slug)
        ? (staffRole.slug as MemberPosition)
        : null;
    if (!memberPosition) return [];
    if (position && memberPosition !== position) return [];
    return [{ staff: s, memberPosition }];
  });
  const numbers = new Map<string, string | null>();
  await Promise.all(
    candidates.map(async ({ staff: s }) => {
      numbers.set(String(s.id), await accreditationNumber(db, String(s.id)));
    }),
  );
  const rows = candidates.flatMap(({ staff: s, memberPosition }) => {
    const storedProfile = profileByStaff.get(String(s.id)) ?? null;
    // OST genealogy is authoritative even when direct onboarding has no IST profile.
    const profile =
      memberPosition === 'ost'
        ? { ...storedProfile, referrer_staff_id: ostHeadByStaff.get(String(s.id)) ?? null }
        : storedProfile;
    const referrerName = profile?.referrer_staff_id
      ? (nameByStaff.get(String(profile.referrer_staff_id)) ?? null)
      : null;
    const ostReferrerName = profile?.ost_referrer_staff_id
      ? (nameByStaff.get(String(profile.ost_referrer_staff_id)) ?? null)
      : null;
    const row = toMember(
      s,
      profile as Record<string, unknown> | null,
      memberPosition,
      s.department_id ? (deptById.get(String(s.department_id)) ?? null) : null,
      referrerName,
      ostReferrerName,
      numbers.get(String(s.id)) ?? null,
    );
    if (
      term &&
      !`${row.fullName} ${row.email} ${row.employeeNumber ?? ''}`.toLowerCase().includes(term)
    )
      return [];
    return [row];
  });
  return rows;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  const path = subPath(req);

  if (path.startsWith('workbook/'))
    return handleMemberWorkbook(
      req,
      res,
      db,
      () => memberRows(db, '', undefined, true),
      async (actor) =>
        new Set(
          (await roleCatalog(db, true))
            .filter(
              (role) => role.is_active && permissionsAreSubset(role.permissions, actor.permissions),
            )
            .map((role) => role.slug),
        ),
    );

  /* ---------------- eligible uplines for a position ---------------- */
  if (path === 'uplines' && method(req) === 'GET') {
    const auth = await authorizeAfHomes(req, 'network.members');
    if ('error' in auth) return deny(res, auth);
    const parsed = memberListQuerySchema.pick({ position: true }).safeParse(req.query);
    if (!parsed.success || !parsed.data.position)
      return fail(res, 'VALIDATION_ERROR', 'A member position is required', 400);
    return list(res, await roleHolders(db, parsed.data.position, true));
  }

  /* ---------------- OST referrers (Sales Manager onboarding only) ---------------- */
  if (path === 'ost-referrers' && method(req) === 'GET') {
    const auth = await authorizeAfHomes(req, 'network.members');
    if ('error' in auth) return deny(res, auth);
    return list(res, await roleHolders(db, 'ost', false));
  }

  /* ---------------- list ---------------- */
  if (path === '' && method(req) === 'GET') {
    const auth = await authorizeAfHomes(req, 'network.members');
    if ('error' in auth) return deny(res, auth);
    const parsed = memberListQuerySchema.safeParse(req.query);
    if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid member query', 400);
    return list(res, await memberRows(db, parsed.data.search ?? '', parsed.data.position));
  }

  /* ---------------- issue a missing AA number (never a renumber) ---------------- */
  const issue = route(req, 'POST', /^([0-9a-f-]+)\/accreditation$/);
  if (issue) {
    const id = issue[1]!;
    const auth = await authorizeAfHomes(req, 'network.members', 'update');
    if ('error' in auth) return deny(res, auth);
    const parsed = issueAccreditationSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Some fields need attention', 400, fieldDetails(parsed));
    const manual = parsed.data.aaNumberMode === 'manual' ? (parsed.data.aaNumber ?? null) : null;
    const { data: profile, error: profileError } = await db
      .from('network_member_profiles')
      .select('staff_id')
      .eq('staff_id', id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return fail(res, 'NOT_FOUND', 'Member not found', 404);
    // Hierarchy sellers only: OST numbers ride the approval flow.
    const roles = await roleCatalog(db);
    const { data: assignment } = await db
      .from('staff_role_assignments')
      .select('role_id')
      .eq('staff_id', id)
      .maybeSingle();
    const slug = roles.find(
      (r) => r.id === String((assignment as { role_id?: string } | null)?.role_id),
    )?.slug;
    if (slug !== 'vice_director' && slug !== 'senior_sales_manager' && slug !== 'sales_manager')
      return fail(res, 'VALIDATION_ERROR', 'Only hierarchy sellers hold an AA number', 400);
    const { data: existing, error: existingError } = await db.rpc('get_sale_team_accreditation', {
      p_staff_id: id,
    });
    if (existingError) throw existingError;
    if (singleRpcRow(existing)) return fail(res, 'CONFLICT', 'AA number already issued', 409);
    if (manual && (await aaNumberTaken(db, manual)))
      return fail(res, 'CONFLICT', 'This AA number is already issued', 409);
    const baseArgs = {
      p_actor_id: auth.userId,
      p_staff_id: id,
      p_kind: 'IST',
      p_action: 'approve',
      p_starts_on: null,
      p_expires_on: null,
    };
    const { error: accreditationError } = await db.rpc(
      'manage_sale_team_accreditation',
      manual ? { ...baseArgs, p_aa_number: manual } : baseArgs,
    );
    if (accreditationError) {
      if (accreditationFailure(res, accreditationError as { message?: string }, manual)) return;
      throw accreditationError;
    }
    await audit(db, auth.userId, 'MEMBER_ACCREDITATION_ISSUED', 'network_member', id, null, {
      aaNumberMode: parsed.data.aaNumberMode,
    });
    const rows = await memberRows(db, '', undefined);
    const row = rows.find((r: Member) => r.id === id);
    if (!row) return fail(res, 'NOT_FOUND', 'Member not found', 404);
    return res.status(200).json(row);
  }

  /* ---------------- create OST directly (management onboarding) ---------------- */
  if (path === 'ost' && method(req) === 'POST') {
    const auth = await authorizeAfHomes(req, 'network.members', 'create');
    if ('error' in auth) return deny(res, auth);
    const parsed = createOstMemberSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Some fields need attention', 400, fieldDetails(parsed));
    const input = parsed.data;
    if (input.mode === 'complete' && !['admin', 'super_admin'].includes(auth.roleSlug))
      return fail(res, 'FORBIDDEN', 'Administrator approval is required.', 403);
    const sponsor = await validateOstSponsor(db, input.sponsorStaffId, 'manual');
    if (!sponsor.ok) return fail(res, 'VALIDATION_ERROR', sponsor.message, sponsor.status);
    const verified = await verifyOstAddress(input.identity);
    if (!verified.ok)
      return fail(
        res,
        verified.status === 503 ? 'INTERNAL' : 'VALIDATION_ERROR',
        'Choose a verified address hierarchy.',
        verified.status,
      );
    input.identity = verified.identity;
    // The shared submission writes the application, its official form and the
    // frozen sponsor snapshot, and re-checks the sponsor, duplicates and scope
    // in SQL. It takes no operator identity on trust.
    const submitted = await db.rpc('submit_ost_accreditation', {
      p_request_id: input.requestId,
      p_actor_id: auth.userId,
      p_sponsor_id: input.sponsorStaffId,
      p_code_id: null,
      p_identity: input.identity,
      p_form: input.form,
      p_source: 'manual',
    });
    if (submitted.error) {
      const failure = ostDirectFailure(submitted.error);
      if (failure) return fail(res, failure.code, failure.message, failure.status);
      throw submitted.error;
    }
    const applicationId = String(submitted.data);
    if (input.mode === 'pending')
      return res
        .status(201)
        .json(
          createOstMemberResultSchema.parse({ applicationId, memberId: null, status: 'submitted' }),
        );
    // Complete: the operator recorded the signatures that were actually
    // signed (with their real dates) and management approves now. The SQL
    // re-checks both signatures and the sponsor; no endorsement is invented.
    const existing = await db
      .from('ost_members')
      .select('id')
      .eq('application_id', applicationId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const signatures = existing.data
      ? { error: null }
      : await db.rpc('confirm_ost_application_signatures', {
          p_id: applicationId,
          p_actor_id: auth.userId,
          p_applicant_date: input.form.applicantSignedOn,
          p_referrer_date: input.form.referrerSignedOn,
        });
    if (signatures.error) {
      const failure = ostDirectFailure(signatures.error);
      if (failure) return fail(res, failure.code, failure.message, failure.status);
      throw signatures.error;
    }
    const installed = await createAndInstallDirectOst(db, {
      applicationId,
      actorId: auth.userId,
      email: input.identity.email.toLowerCase(),
      fullName: ostFullName(input.identity),
      temporaryPassword: input.temporaryPassword!,
      aaNumber: input.aaNumberMode === 'manual' ? input.aaNumber! : null,
      startsOn: input.startsOn!,
      expiresOn: input.expiresOn!,
    });
    if (!installed.ok) return fail(res, installed.code, installed.message, installed.status);
    return res.status(201).json(
      createOstMemberResultSchema.parse({
        applicationId,
        memberId: installed.memberId,
        status: 'approved',
      }),
    );
  }

  /* ---------------- approved OST genealogy move (no kind or AA change) ---------------- */
  const teamTransfer = route(req, 'POST', /^([0-9a-f-]+)\/team-transfer$/);
  if (teamTransfer) {
    const auth = await authorizeAfHomes(req, 'network.members', 'update');
    if ('error' in auth) return deny(res, auth);
    const parsed = transferOstTeamSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(
        res,
        'VALIDATION_ERROR',
        'Choose the new Sales Manager, give a reason and confirm approval.',
        400,
        fieldDetails(parsed),
      );
    const id = teamTransfer[1]!;
    const { error } = await db.rpc('transfer_ost_team', {
      p_actor_id: auth.userId,
      p_ost_id: id,
      p_request_id: parsed.data.requestId,
      p_sponsor_id: parsed.data.sponsorStaffId,
      p_reason: parsed.data.reason,
    });
    if (error) {
      const failure = ostDirectFailure(error);
      if (failure) return fail(res, failure.code, failure.message, failure.status);
      throw error;
    }
    const row = (await memberRows(db, '', undefined)).find((member: Member) => member.id === id);
    if (!row)
      return fail(res, 'INTERNAL', 'The transfer outcome requires review before retrying.', 500);
    return res.status(200).json(row);
  }

  /* ---------------- convert an accredited member between kinds ---------------- */
  const transfer = route(req, 'POST', /^([0-9a-f-]+)\/transfer$/);
  if (transfer) {
    const id = transfer[1]!;
    const auth = await authorizeAfHomes(req, 'network.members', 'update');
    if ('error' in auth) return deny(res, auth);
    const parsed = transferMemberSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Some fields need attention', 400, fieldDetails(parsed));
    const input = parsed.data;
    if (input.direction === 'IST_TO_OST') {
      const sponsor = await validateOstSponsor(db, input.sponsorStaffId, 'manual');
      if (!sponsor.ok) return fail(res, 'VALIDATION_ERROR', sponsor.message, sponsor.status);
      const verified = await verifyOstAddress(input.identity);
      if (!verified.ok)
        return fail(
          res,
          verified.status === 503 ? 'INTERNAL' : 'VALIDATION_ERROR',
          'Choose a verified address hierarchy.',
          verified.status,
        );
      input.identity = verified.identity;
    }
    const rows = await memberRows(db, '', undefined);
    if (!rows.some((r: Member) => r.id === id))
      return fail(res, 'NOT_FOUND', 'Member not found', 404);
    // One call, one transaction: the held number is retired into the
    // accreditation history and the successor is issued with the new kind's
    // complete footprint. A transfer never takes a manually typed number.
    const { error } = await db.rpc(
      'transfer_sale_team_member',
      input.direction === 'IST_TO_OST'
        ? {
            p_actor_id: auth.userId,
            p_staff_id: id,
            p_direction: input.direction,
            p_request_id: input.requestId,
            p_reason: input.reason,
            p_sponsor_id: input.sponsorStaffId,
            p_identity: input.identity,
            p_form: input.form,
            p_starts_on: input.startsOn,
            p_expires_on: input.expiresOn,
          }
        : {
            p_actor_id: auth.userId,
            p_staff_id: id,
            p_direction: input.direction,
            p_request_id: input.requestId,
            p_reason: input.reason,
            p_target_position: input.targetPosition,
            p_head_id: input.headStaffId ?? null,
          },
    );
    if (error) {
      const failure = ostDirectFailure(error);
      if (failure) return fail(res, failure.code, failure.message, failure.status);
      throw error;
    }
    const updated = await memberRows(db, '', undefined);
    const row = updated.find((r: Member) => r.id === id);
    if (!row) return fail(res, 'INTERNAL', 'Member was transferred but cannot be read', 500);
    return res.status(200).json(row);
  }

  const detail = route(req, 'GET', /^([0-9a-f-]+)$/);
  const patch = route(req, 'PATCH', /^([0-9a-f-]+)$/);
  if (detail || patch) {
    const id = (detail ?? patch)![1]!;
    if (detail) {
      const auth = await authorizeAfHomes(req, 'network.members');
      if ('error' in auth) return deny(res, auth);
      const rows = await memberRows(db, '', undefined);
      const row = rows.find((r: Member) => r.id === id);
      if (!row) return fail(res, 'NOT_FOUND', 'Member not found', 404);
      // The console's single-record read carries the identification fields in
      // clear so an operator can verify the recorded values; every list-shaped
      // read keeps the masks. The detail read is the only place they surface.
      const { data: secrets, error: secretsError } = await db
        .from('network_member_profiles')
        .select('tin,government_id_number')
        .eq('staff_id', id)
        .maybeSingle();
      if (secretsError) throw secretsError;
      const secretRow = secrets as Record<string, unknown> | null;
      return res.status(200).json(
        memberDetailSchema.parse({
          ...row,
          tin: isoOrNull(secretRow?.tin),
          governmentIdNumber: isoOrNull(secretRow?.government_id_number),
        }),
      );
    }
    const auth = await authorizeAfHomes(req, 'network.members', 'update');
    if ('error' in auth) return deny(res, auth);
    const parsed = updateMemberProfileSchema.safeParse(jsonBody(req));
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      return fail(res, 'VALIDATION_ERROR', 'Some fields need attention', 400, fieldDetails(parsed));
    const input = parsed.data;
    const { data: profile, error: profileError } = await db
      .from('network_member_profiles')
      .select('staff_id,referrer_staff_id,ost_referrer_staff_id')
      .eq('staff_id', id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return fail(res, 'NOT_FOUND', 'Member not found', 404);
    const profileRow = profile as Record<string, unknown>;
    const {
      tin,
      governmentIdNumber,
      fullName,
      email,
      temporaryPassword,
      position,
      referrerStaffId,
      headChangeReason,
      ostReferrerStaffId,
      provinceCode,
      cityMunicipalityCode,
      ...rest
    } = input;

    // --- position and head ------------------------------------------------
    // The position IS the role assignment; a change re-resolves the role (a
    // tampered slug cannot escalate: the target's permissions must be a subset
    // of the caller's) and re-runs the head rules creation enforces, because
    // every level names a different immediate upline. A head move carries a
    // reason and is audited; the database trigger stays the final authority
    // on direction and cycles.
    const roles = await roleCatalog(db);
    const { data: assignment } = await db
      .from('staff_role_assignments')
      .select('role_id')
      .eq('staff_id', id)
      .maybeSingle();
    const currentSlug = roles.find(
      (r) => r.id === String((assignment as { role_id?: string } | null)?.role_id),
    )?.slug;
    const currentHead = (profileRow.referrer_staff_id as string | undefined) ?? null;
    const currentOst = (profileRow.ost_referrer_staff_id as string | undefined) ?? null;

    const positionChanged = position !== undefined && position !== currentSlug;
    if (positionChanged && (currentSlug === 'ost' || position === 'ost'))
      return fail(
        res,
        'CONFLICT',
        'Use the controlled OST conversion workflow for accreditation role changes.',
        409,
      );
    if (currentSlug === 'ost' && referrerStaffId !== undefined && referrerStaffId !== currentHead)
      return fail(
        res,
        'CONFLICT',
        'OST team changes require the expired-accreditation renewal approval workflow.',
        409,
      );
    let effectivePosition = (position ?? currentSlug) as MemberPosition | undefined;
    let targetRole: RoleRow | undefined;
    if (positionChanged) {
      targetRole = roles.find((r) => r.slug === position);
      if (!targetRole?.is_active)
        return fail(res, 'VALIDATION_ERROR', 'Position is not active', 400);
      if (!permissionsAreSubset(targetRole.permissions, auth.permissions))
        return fail(res, 'FORBIDDEN', 'Cannot assign a position you do not possess', 403);
      effectivePosition = position;
    }
    const expectedUpline = effectivePosition ? MEMBER_UPLINE_ROLE[effectivePosition] : null;

    /** undefined = leave the link alone; null = a position without a head. */
    const headDecision = referrerStaffId !== undefined ? (referrerStaffId ?? null) : undefined;
    let nextHead: string | null | undefined;
    if (positionChanged) {
      if (!expectedUpline) {
        if (headDecision) return fail(res, 'VALIDATION_ERROR', 'A Vice Director has no head', 400);
        nextHead = null;
      } else {
        if (!headDecision) return fail(res, 'VALIDATION_ERROR', 'A head is required', 400);
        nextHead = headDecision;
      }
    } else if (headDecision !== undefined) {
      if (headDecision === null && expectedUpline)
        return fail(res, 'VALIDATION_ERROR', 'A head is required', 400);
      nextHead = headDecision;
    }

    let headReason: string | undefined;
    const headWillChange = nextHead !== undefined && nextHead !== currentHead;
    if (nextHead !== undefined && nextHead !== null) {
      if (nextHead === id)
        return fail(res, 'VALIDATION_ERROR', 'A member cannot be their own head', 400);
      const [{ data: candidate }, { data: candidateAssignment }] = await Promise.all([
        db.from('staff_users').select('id,status').eq('id', nextHead).maybeSingle(),
        db.from('staff_role_assignments').select('role_id').eq('staff_id', nextHead).maybeSingle(),
      ]);
      if (!candidate) return fail(res, 'NOT_FOUND', 'Head not found', 404);
      if ((candidate as { status?: string }).status !== 'active')
        return fail(res, 'CONFLICT', 'Head is not active', 409);
      const candidateSlug = roles.find(
        (r) => r.id === String((candidateAssignment as { role_id?: string } | null)?.role_id),
      )?.slug;
      if (!hierarchyAllowsUpline(effectivePosition as never, (candidateSlug ?? '') as never))
        return fail(res, 'VALIDATION_ERROR', 'Head must be the immediate upline', 400);
    }
    if (headWillChange) {
      const reason = (headChangeReason ?? '').trim();
      if (reason.length < 3)
        return fail(res, 'VALIDATION_ERROR', 'A head change needs a reason', 400, {
          headChangeReason: 'A head change needs a reason',
        });
      headReason = reason;
    }

    // The OST referrer is informational (Sales Managers only): leaving the
    // seat retires it, and it must always name an active OST.
    let nextOst: string | null | undefined;
    if (ostReferrerStaffId !== undefined) {
      if (ostReferrerStaffId !== null && effectivePosition !== 'sales_manager')
        return fail(res, 'VALIDATION_ERROR', 'An OST referrer is for Sales Managers only', 400);
      if (ostReferrerStaffId !== null) {
        const ostRole = roles.find((r) => r.slug === 'ost');
        const [{ data: ostCandidate }, { data: ostAssignment }] = await Promise.all([
          db.from('staff_users').select('id,status').eq('id', ostReferrerStaffId).maybeSingle(),
          db
            .from('staff_role_assignments')
            .select('role_id')
            .eq('staff_id', ostReferrerStaffId)
            .maybeSingle(),
        ]);
        if (
          !ostCandidate ||
          (ostCandidate as { status?: string }).status !== 'active' ||
          String((ostAssignment as { role_id?: string } | null)?.role_id) !== ostRole?.id
        )
          return fail(res, 'VALIDATION_ERROR', 'OST referrer must be an active OST', 400);
      }
      nextOst = ostReferrerStaffId ?? null;
    } else if (positionChanged && effectivePosition !== 'sales_manager' && currentOst) {
      nextOst = null;
    }

    // --- address ----------------------------------------------------------
    // Codes travel as a pair: when both are present the reference re-resolves
    // them and owns the saved names and codes, while the ZIP stays the
    // operator's (see resolveMemberLocation). Without them the typed text is
    // saved for legacy rows that were never verified.
    let location: ResolvedMemberLocation | null = null;
    if (provinceCode !== undefined || cityMunicipalityCode !== undefined) {
      if (!provinceCode || !cityMunicipalityCode)
        return fail(res, 'VALIDATION_ERROR', 'Choose the province and city from the list.', 400);
      location = await resolveMemberLocation({
        province: rest.province ?? '',
        cityMunicipality: rest.cityMunicipality ?? '',
        provinceCode,
        cityMunicipalityCode,
        zipCode: rest.zipCode ?? '',
      });
      if (!location.ok)
        return fail(
          res,
          location.status === 503 ? 'INTERNAL' : 'VALIDATION_ERROR',
          location.message,
          location.status,
        );
    }

    // --- sign-in account (email and/or administrator password reset) ------
    const { data: staffRow, error: staffError } = await db
      .from('staff_users')
      .select('id,email')
      .eq('id', id)
      .maybeSingle();
    if (staffError) throw staffError;
    if (!staffRow) return fail(res, 'NOT_FOUND', 'Member not found', 404);
    const currentEmail = String((staffRow as { email?: string }).email ?? '').toLowerCase();
    const emailChanged = email !== undefined && email !== currentEmail;
    if (emailChanged) {
      const { data: duplicate } = await db
        .from('staff_users')
        .select('id')
        .eq('email', email)
        .limit(1);
      if ((duplicate ?? []).some((row: { id?: string }) => String(row.id) !== id))
        return fail(res, 'CONFLICT', 'A staff member with this email already exists', 409);
    }
    if (emailChanged || temporaryPassword !== undefined) {
      const { error: authUpdateError } = await db.auth.admin.updateUserById(id, {
        ...(emailChanged ? { email, email_confirm: true } : {}),
        ...(temporaryPassword !== undefined ? { password: temporaryPassword } : {}),
      });
      if (authUpdateError) {
        const raw = String((authUpdateError as { message?: string }).message ?? '').toLowerCase();
        if (emailChanged && /already.*(registered|exists|in use)|duplicate/i.test(raw))
          return fail(res, 'CONFLICT', 'An account with this email already exists', 409);
        return fail(res, 'INTERNAL', 'Unable to update the sign-in account', 500);
      }
    }

    // --- writes -----------------------------------------------------------
    const now = new Date().toISOString();
    if (fullName !== undefined || emailChanged || temporaryPassword !== undefined) {
      const { error: staffWriteError } = await db
        .from('staff_users')
        .update({
          ...(fullName !== undefined ? { full_name: fullName } : {}),
          ...(emailChanged ? { email } : {}),
          // An administrator reset puts the account back on a temporary
          // password: the next sign-in forces a change.
          ...(temporaryPassword !== undefined ? { must_change_password: true } : {}),
          updated_at: now,
        })
        .eq('id', id);
      if (staffWriteError) throw staffWriteError;
    }
    if (positionChanged && targetRole) {
      const { error: roleError } = await db
        .from('staff_role_assignments')
        .update({ role_id: targetRole.id, assigned_by: auth.userId })
        .eq('staff_id', id);
      if (roleError) throw roleError;
    }
    if (headWillChange) {
      const { data: active, error: activeError } = await db
        .from('referral_relationships')
        .select('id')
        .eq('subject_staff_id', id)
        .eq('is_active', true)
        .maybeSingle();
      if (activeError) throw activeError;
      if (active) {
        const { error: retireError } = await db
          .from('referral_relationships')
          .update({ is_active: false, updated_at: now })
          .eq('id', String((active as { id?: string }).id));
        if (retireError) throw retireError;
      }
      if (nextHead !== null) {
        const { error: linkError } = await db.from('referral_relationships').insert({
          subject_staff_id: id,
          upline_staff_id: nextHead,
          hierarchy_role: effectivePosition,
          is_authoritative: true,
          is_active: true,
          assigned_by: auth.userId,
        });
        if (linkError) {
          const raw = String((linkError as { message?: string }).message ?? '');
          if (/GENEALOGY_CYCLE/.test(raw))
            return fail(res, 'VALIDATION_ERROR', 'That head would create a cycle', 400);
          if (/SUBJECT_ROLE_MISMATCH|INVALID_HIERARCHY_DIRECTION|HIERARCHY_ROLE_REQUIRED/.test(raw))
            return fail(res, 'VALIDATION_ERROR', 'Head must be the immediate upline', 400);
          if (/UPLINE_SELF_REFERENCE/.test(raw))
            return fail(res, 'VALIDATION_ERROR', 'A member cannot be their own head', 400);
          if ((linkError as { code?: string }).code === '23505')
            return fail(res, 'CONFLICT', 'That person already has an active upline', 409);
          throw linkError;
        }
      }
      await audit(
        db,
        auth.userId,
        'UPLINE_CORRECTED',
        'referral_relationship',
        id,
        { uplineStaffId: currentHead },
        { uplineStaffId: nextHead },
        { reason: headReason },
      );
    }
    const { error: updateError } = await db
      .from('network_member_profiles')
      .update({
        ...Object.fromEntries(
          Object.entries(rest).map(([key, value]) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            value ?? null,
          ]),
        ),
        ...(location && location.ok
          ? {
              province: location.province,
              city_municipality: location.cityMunicipality,
              province_code: location.provinceCode,
              city_municipality_code: location.cityMunicipalityCode,
              zip_code: location.zipCode,
            }
          : {}),
        ...(tin !== undefined ? { tin } : {}),
        ...(governmentIdNumber !== undefined ? { government_id_number: governmentIdNumber } : {}),
        ...(nextHead !== undefined ? { referrer_staff_id: nextHead } : {}),
        ...(nextOst !== undefined ? { ost_referrer_staff_id: nextOst } : {}),
        updated_at: now,
      })
      .eq('staff_id', id);
    if (updateError) throw updateError;
    // Masked before/after so the audit trail holds no secret.
    await audit(db, auth.userId, 'MEMBER_UPDATED', 'network_member', id, null, {
      fields: Object.keys(parsed.data),
    });
    const rows = await memberRows(db, '', undefined);
    const row = rows.find((r: Member) => r.id === id);
    if (!row) return fail(res, 'NOT_FOUND', 'Member not found', 404);
    return res.status(200).json(row);
  }

  /* ---------------- create ---------------- */
  if (path === '' && method(req) === 'POST') {
    const auth = await authorizeAfHomes(req, 'network.members', 'create');
    if ('error' in auth) return deny(res, auth);
    const parsed = createMemberSchema.safeParse(jsonBody(req));
    if (!parsed.success)
      return fail(res, 'VALIDATION_ERROR', 'Some fields need attention', 400, fieldDetails(parsed));
    const input = parsed.data;
    if (input.position === 'ost')
      return fail(
        res,
        'CONFLICT',
        'Create OST accounts through official OST registration and approval.',
        409,
      );

    const roles = await roleCatalog(db);
    const target = roles.find((r) => r.slug === input.position);
    if (!target?.is_active) return fail(res, 'VALIDATION_ERROR', 'Position is not active', 400);
    if (!permissionsAreSubset(target.permissions, auth.permissions))
      return fail(res, 'FORBIDDEN', 'Cannot assign a position you do not possess', 403);

    const { data: department } = await db
      .from('departments')
      .select('id,code,is_active')
      .eq('id', input.departmentId)
      .maybeSingle();
    // Members are fixed in Sales: the department field is display-only.
    if (!department || (department as { code?: string }).code !== 'SALES')
      return fail(res, 'VALIDATION_ERROR', 'Members belong to the Sales department', 400);
    if ((department as { is_active?: boolean }).is_active === false)
      return fail(res, 'VALIDATION_ERROR', 'Department is not active', 400);

    // The head must be the immediate upline of the position, and a Vice
    // Director has none. Every other position names its head.
    const expectedUpline = MEMBER_UPLINE_ROLE[input.position];
    let referrer: { id: string } | null = null;
    if (input.referrerStaffId) {
      if (!expectedUpline) return fail(res, 'VALIDATION_ERROR', 'A Vice Director has no head', 400);
      const { data: candidate } = await db
        .from('staff_users')
        .select('id,status')
        .eq('id', input.referrerStaffId)
        .maybeSingle();
      if (!candidate) return fail(res, 'NOT_FOUND', 'Referrer not found', 404);
      if ((candidate as { status?: string }).status !== 'active')
        return fail(res, 'CONFLICT', 'Referrer is not active', 409);
      const { data: referrerAssignment } = await db
        .from('staff_role_assignments')
        .select('role_id')
        .eq('staff_id', input.referrerStaffId)
        .maybeSingle();
      const referrerSlug = roles.find(
        (r) => r.id === String((referrerAssignment as { role_id?: string } | null)?.role_id),
      )?.slug;
      if (!hierarchyAllowsUpline(input.position, (referrerSlug ?? '') as never))
        return fail(res, 'VALIDATION_ERROR', 'Head must be the immediate upline', 400);
      referrer = { id: input.referrerStaffId };
    } else if (expectedUpline) {
      return fail(res, 'VALIDATION_ERROR', 'A head is required', 400);
    }

    // The OST referrer is informational only (Sales Managers): it must name
    // an active OST, and it never becomes a genealogy edge.
    let ostReferrer: { id: string } | null = null;
    if (input.ostReferrerStaffId) {
      const ostRole = roles.find((r) => r.slug === 'ost');
      const [{ data: ostCandidate }, { data: ostAssignment }] = await Promise.all([
        db.from('staff_users').select('id,status').eq('id', input.ostReferrerStaffId).maybeSingle(),
        db
          .from('staff_role_assignments')
          .select('role_id')
          .eq('staff_id', input.ostReferrerStaffId)
          .maybeSingle(),
      ]);
      if (
        !ostCandidate ||
        (ostCandidate as { status?: string }).status !== 'active' ||
        String((ostAssignment as { role_id?: string } | null)?.role_id) !== ostRole?.id
      )
        return fail(res, 'VALIDATION_ERROR', 'OST referrer must be an active OST', 400);
      ostReferrer = { id: input.ostReferrerStaffId };
    }

    const email = input.email.toLowerCase();
    // The saved address follows the reference for names and codes; the ZIP is
    // whatever the body carried.
    const location = await resolveMemberLocation(input);
    if (!location.ok)
      return fail(
        res,
        location.status === 503 ? 'INTERNAL' : 'VALIDATION_ERROR',
        location.message,
        location.status,
      );
    // A typed AA number is checked before any write: the friendly conflict
    // arrives with no side effects (a race is still possible and maps to the
    // same 409 at the accreditation step).
    const manualAa = input.aaNumberMode === 'manual' ? (input.aaNumber ?? null) : null;
    if (manualAa && (await aaNumberTaken(db, manualAa)))
      return fail(res, 'CONFLICT', 'This AA number is already issued', 409);
    const { data: duplicate } = await db
      .from('staff_users')
      .select('id')
      .eq('email', email)
      .limit(1);
    if ((duplicate ?? []).length > 0)
      return fail(res, 'CONFLICT', 'A staff member with this email already exists', 409);

    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password: input.temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
    if (createError || !created?.user) {
      // A duplicate address is a conflict; anything else (weak password,
      // provider failure) is a server error, never a misleading conflict.
      const raw = String((createError as { message?: string } | null)?.message ?? '').toLowerCase();
      if (/already.*(registered|exists)|duplicate/i.test(raw))
        return fail(res, 'CONFLICT', 'An account with this email already exists', 409);
      return fail(res, 'INTERNAL', 'Account provisioning failed', 500);
    }
    /**
     * Best-effort reverse-order compensation for a failed create. The tree
     * has no cross-system transaction between PostgREST and GoTrue, so every
     * step is attempted and none throws: a partial member must never survive
     * its failed request (the next retry would 409 on the orphan forever).
     * Staff rows are deleted BEFORE the Auth user: `staff_users.id`
     * references `auth.users(id)` on delete restrict, so deleting the login
     * first fails while the profile still references it.
     */
    const compensate = async () => {
      const id = created.user.id as string;
      const ignore = async (work: Promise<unknown>) => {
        try {
          await work;
        } catch {
          /* best-effort: keep compensating */
        }
      };
      await ignore(db.from('referral_relationships').delete().eq('subject_staff_id', id));
      await ignore(db.from('network_member_profiles').delete().eq('staff_id', id));
      await ignore(db.from('staff_role_assignments').delete().eq('staff_id', id));
      await ignore(db.from('staff_users').delete().eq('id', id));
      await ignore(db.auth.admin.deleteUser(id));
    };
    const insertError = (label: string, error: { message?: string; code?: string } | null) =>
      new Error(
        `${label} insert failed [${error?.code ?? 'unknown'}]: ${error?.message ?? 'unknown'}`,
      );
    try {
      const now = new Date().toISOString();
      const { error: staffError } = await db.from('staff_users').insert({
        id: created.user.id,
        email,
        full_name: input.fullName,
        department_id: input.departmentId,
        status: 'active',
        must_change_password: true,
        activated_at: now,
      });
      if (staffError) throw insertError('staff_users', staffError);
      const { error: assignmentError } = await db.from('staff_role_assignments').insert({
        staff_id: created.user.id,
        role_id: target.id,
        assigned_by: auth.userId,
      });
      if (assignmentError) throw insertError('staff_role_assignments', assignmentError);
      const { error: profileError } = await db.from('network_member_profiles').insert({
        staff_id: created.user.id,
        date_of_birth: input.dateOfBirth,
        sex: input.sex,
        civil_status: input.civilStatus,
        street_no: input.streetNo,
        city_municipality: location.cityMunicipality,
        province: location.province,
        province_code: location.provinceCode,
        city_municipality_code: location.cityMunicipalityCode,
        zip_code: location.zipCode,
        tel_no: input.telNo ?? null,
        mobile_no: input.mobileNo,
        fb_messenger: input.fbMessenger || null,
        tin: input.tin ?? null,
        employer_name: input.employerName,
        employer_address: input.employerAddress,
        job_position: input.jobPosition,
        government_id_type: input.governmentIdType,
        government_id_number: input.governmentIdNumber,
        referrer_staff_id: referrer?.id ?? null,
        ost_referrer_staff_id: ostReferrer?.id ?? null,
      });
      if (profileError) throw insertError('network_member_profiles', profileError);
      if (referrer) {
        const { error: referralError } = await db.from('referral_relationships').insert({
          subject_staff_id: created.user.id,
          upline_staff_id: referrer.id,
          hierarchy_role: input.position,
          is_authoritative: true,
          is_active: true,
          assigned_by: auth.userId,
        });
        if (referralError) {
          await compensate();
          if ((referralError as { code?: string }).code === '23505')
            return fail(res, 'CONFLICT', 'That person already has an active upline', 409);
          throw referralError;
        }
        await audit(
          db,
          auth.userId,
          'UPLINE_ASSIGNED',
          'referral_relationship',
          created.user.id,
          null,
          {
            uplineStaffId: referrer.id,
            hierarchyRole: input.position,
          },
        );
      }
      // Identity only: the temporary password, TIN and government ID never
      // enter the audit trail.
      await audit(db, auth.userId, 'MEMBER_CREATED', 'network_member', created.user.id, null, {
        email,
        fullName: input.fullName,
        departmentId: input.departmentId,
        position: input.position,
        aaNumberMode: input.aaNumberMode,
        referrerStaffId: referrer?.id ?? null,
        ostReferrerStaffId: ostReferrer?.id ?? null,
      });
      // IST receives an employee identity only; the compatible RPC must not create a term.
      const baseArgs = {
        p_actor_id: auth.userId,
        p_staff_id: created.user.id,
        p_kind: 'IST',
        p_action: 'approve',
        p_starts_on: null,
        p_expires_on: null,
      };
      const { error: accreditationError } = await db.rpc(
        'manage_sale_team_accreditation',
        manualAa ? { ...baseArgs, p_aa_number: manualAa } : baseArgs,
      );
      if (accreditationError) {
        await compensate();
        if (accreditationFailure(res, accreditationError as { message?: string }, manualAa)) return;
        throw new Error(
          `sale team accreditation failed: ${(accreditationError as { message?: string }).message ?? 'unknown'}`,
        );
      }
    } catch (error) {
      await compensate();
      // A concurrent duplicate (unique violation mid-create) is a conflict,
      // never a 500: without this the retry loop can never succeed.
      const message = error instanceof Error ? error.message : String(error);
      if (/23505|duplicate key|already exists/i.test(message))
        return fail(res, 'CONFLICT', 'A record with these details already exists', 409);
      throw error;
    }
    const rows = await memberRows(db, '', undefined);
    const row = rows.find((r: Member) => r.id === created.user.id);
    if (!row) return fail(res, 'INTERNAL', 'Member was created but cannot be read', 500);
    return res.status(201).json(row);
  }

  return fail(res, 'NOT_FOUND', `No handler for ${path || 'members'}`, 404);
}
import { handleMemberWorkbook } from '../_lib/member-workbook-handler.js';
