/**
 * AFHomes sales-network Members.
 *
 * Hierarchy sellers (Vice Director, Senior Sales Manager, Sales Manager)
 * onboarded with a full personal record. A Member IS a staff account: creation
 * provisions the Auth login (administrator-set temporary password, forced
 * change on first sign-in) and stores the extra form fields on the linked
 * `network_member_profiles` row. OST is onboarded through OST registration,
 * never here.
 *
 * Sensitivity follows the customer record: TIN and the government ID number
 * are accepted on write, stored, masked on every read, and never appear in an
 * audit payload. The client sends the position slug; the server resolves the
 * role row, so a tampered role id cannot escalate.
 */
import {
  MEMBER_POSITION_LABELS,
  MEMBER_UPLINE_ROLE,
  afHomesModuleKeySchema,
  createMemberSchema,
  hierarchyAllowsUpline,
  maskGovernmentId,
  memberListQuerySchema,
  memberSchema,
  updateMemberProfileSchema,
  type AfHomesPermission,
  type Member,
  type MemberPosition,
} from '@afhomes/contracts';

import { authorizeAfHomes, permissionsAreSubset } from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  method,
  route,
  subPath,
  type Db,
} from '../_lib/handler-kit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { serviceClient } from '../_lib/rest.js';

const MEMBER_ROLES: readonly MemberPosition[] = [
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
];

/** Accreditation validity granted at onboarding: one year from approval. */
function accreditationWindow(now = new Date()): { startsOn: string; expiresOn: string } {
  const startsOn = now.toISOString().slice(0, 10);
  const expires = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
  return { startsOn, expiresOn: expires.toISOString().slice(0, 10) };
}

async function accreditationNumber(
  db: Db,
  staffId: string,
): Promise<string | null> {
  const { data, error } = await db.rpc('get_sale_team_accreditation', { p_staff_id: staffId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const number =
    row && typeof row === 'object' ? (row as Record<string, unknown>).aaNumber : null;
  return typeof number === 'string' ? number : null;
}

type RoleRow = {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  permissions: AfHomesPermission[];
};

async function roleCatalog(db: Db): Promise<RoleRow[]> {
  const [{ data: roles }, { data: grants }, { data: modules }] = await Promise.all([
    db.from('roles').select('id,slug,name,is_active'),
    db.from('role_permissions').select('role_id,module_id,can_view,can_create,can_update,can_delete'),
    db.from('modules').select('id,key'),
  ]);
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
  roleName: string | null,
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
    aaNumber,
    dateOfBirth: isoOrNull(profile?.date_of_birth) ? String(profile?.date_of_birth).slice(0, 10) : null,
    sex: (profile?.sex as string | undefined) ?? null,
    civilStatus: (profile?.civil_status as string | undefined) ?? null,
    streetNo: (profile?.street_no as string | undefined) ?? null,
    cityMunicipality: (profile?.city_municipality as string | undefined) ?? null,
    province: (profile?.province as string | undefined) ?? null,
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
): Promise<{ id: string; fullName: string; employeeNumber: string | null; positionLabel: string }[]> {
  const slug = asUpline ? MEMBER_UPLINE_ROLE[position] : position;
  if (!slug) return [];
  const roles = await roleCatalog(db);
  const target = roles.find((r) => r.slug === slug);
  if (!target) return [];
  const [{ data: assignments }, { data: staff }] = await Promise.all([
    db.from('staff_role_assignments').select('*').eq('role_id', target.id),
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

async function memberRows(db: Db, search: string, position?: MemberPosition) {
  const [{ data: staff }, { data: assignments }, { data: profiles }, { data: departments }] =
    await Promise.all([
      db.from('staff_users').select('*').order('created_at', { ascending: false }),
      db.from('staff_role_assignments').select('*'),
      db.from('network_member_profiles').select('*'),
      db.from('departments').select('id,name'),
    ]);
  const roles = await roleCatalog(db);
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
    const profile = profileByStaff.get(String(s.id)) ?? null;
    const referrerName = profile?.referrer_staff_id
      ? (nameByStaff.get(String(profile.referrer_staff_id)) ?? null)
      : null;
    const ostReferrerName = profile?.ost_referrer_staff_id
      ? (nameByStaff.get(String(profile.ost_referrer_staff_id)) ?? null)
      : null;
    const row = toMember(
      s,
      profile as Record<string, unknown> | null,
      roleById.get(assignmentByStaff.get(String(s.id)) ?? '')?.name ?? null,
      memberPosition,
      s.department_id ? (deptById.get(String(s.department_id)) ?? null) : null,
      referrerName,
      ostReferrerName,
      numbers.get(String(s.id)) ?? null,
    );
    if (term && !`${row.fullName} ${row.email} ${row.employeeNumber ?? ''}`.toLowerCase().includes(term))
      return [];
    return [row];
  });
  return rows;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  const path = subPath(req);

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
      return res.status(200).json(row);
    }
    const auth = await authorizeAfHomes(req, 'network.members', 'update');
    if ('error' in auth) return deny(res, auth);
    const parsed = updateMemberProfileSchema.safeParse(jsonBody(req));
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      return fail(res, 'VALIDATION_ERROR', 'Invalid member update', 400);
    const input = parsed.data;
    const { data: profile, error: profileError } = await db
      .from('network_member_profiles')
      .select('staff_id')
      .eq('staff_id', id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return fail(res, 'NOT_FOUND', 'Member not found', 404);
    const { tin, governmentIdNumber, ...rest } = input;
    const { error: updateError } = await db
      .from('network_member_profiles')
      .update({
        ...Object.fromEntries(
          Object.entries(rest).map(([key, value]) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            value ?? null,
          ]),
        ),
        ...(tin !== undefined ? { tin } : {}),
        ...(governmentIdNumber !== undefined ? { government_id_number: governmentIdNumber } : {}),
        updated_at: new Date().toISOString(),
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
    if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid member details', 400);
    const input = parsed.data;

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
      if (!expectedUpline)
        return fail(res, 'VALIDATION_ERROR', 'A Vice Director has no head', 400);
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
    if (createError || !created?.user)
      return fail(res, 'CONFLICT', 'Unable to create an account for this email address', 409);
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
      if (staffError) throw new Error(`staff_users insert failed: ${staffError.message}`);
      const { error: assignmentError } = await db.from('staff_role_assignments').insert({
        staff_id: created.user.id,
        role_id: target.id,
        assigned_by: auth.userId,
      });
      if (assignmentError)
        throw new Error(`staff_role_assignments insert failed: ${assignmentError.message}`);
      const { error: profileError } = await db.from('network_member_profiles').insert({
        staff_id: created.user.id,
        date_of_birth: input.dateOfBirth,
        sex: input.sex,
        civil_status: input.civilStatus,
        street_no: input.streetNo,
        city_municipality: input.cityMunicipality,
        province: input.province,
        zip_code: input.zipCode,
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
      if (profileError) throw new Error(`network_member_profiles insert failed: ${profileError.message}`);
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
          if ((referralError as { code?: string }).code === '23505')
            throw new Error('That person already has an active upline');
          throw referralError;
        }
        await audit(db, auth.userId, 'UPLINE_ASSIGNED', 'referral_relationship', created.user.id, null, {
          uplineStaffId: referrer.id,
          hierarchyRole: input.position,
        });
      }
      // Identity only: the temporary password, TIN and government ID never
      // enter the audit trail.
      await audit(db, auth.userId, 'MEMBER_CREATED', 'network_member', created.user.id, null, {
        email,
        fullName: input.fullName,
        departmentId: input.departmentId,
        position: input.position,
        referrerStaffId: referrer?.id ?? null,
        ostReferrerStaffId: ostReferrer?.id ?? null,
      });
      // The AA number is issued with the account for hierarchy sellers (IST
      // accreditation, one year). OST accreditation rides on the OST approval
      // flow, so OST members gain their number there, not here.
      if (input.position !== 'ost') {
        const { startsOn, expiresOn } = accreditationWindow();
        const { error: accreditationError } = await db.rpc('manage_sale_team_accreditation', {
          p_actor_id: auth.userId,
          p_staff_id: created.user.id,
          p_kind: 'IST',
          p_action: 'approve',
          p_starts_on: startsOn,
          p_expires_on: expiresOn,
        });
        if (accreditationError) {
          throw new Error(
            `sale team accreditation failed: ${(accreditationError as { message?: string }).message ?? 'unknown'}`,
          );
        }
      }
    } catch (error) {
      await db.auth.admin.deleteUser(created.user.id);
      throw error;
    }
    const rows = await memberRows(db, '', undefined);
    const row = rows.find((r: Member) => r.id === created.user.id);
    if (!row) return fail(res, 'INTERNAL', 'Member was created but cannot be read', 500);
    return res.status(201).json(row);
  }

  return fail(res, 'NOT_FOUND', `No handler for ${path || 'members'}`, 404);
}
