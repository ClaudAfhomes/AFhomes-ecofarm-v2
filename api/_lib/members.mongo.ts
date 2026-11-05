import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { ClientSession, Db, Document, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  createMemberSchema,
  createOstMemberSchema,
  createOstMemberResultSchema,
  memberSchema,
  memberDetailSchema,
  memberListQuerySchema,
  MEMBER_UPLINE_ROLE,
  MEMBER_POSITIONS,
  type MemberPosition,
  type Member,
  type MemberListQuery,
} from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { permissionsAreSubset } from './afhomes-access.js';
import { transferMongoMemberKind } from './member-kind-transfer.mongo.js';
import { updateMongoMemberProfile } from './member-profile-update.mongo.js';
import { transferMongoOstTeam } from './member-team-transfer.mongo.js';
import { createMongoOstAccess, readMongoOstApplicant } from './ost-accreditation.mongo.js';
import { createMongoSaleTeamRecords } from './sale-team.mongo.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { allocatePurchaseId, purchaseFingerprint } from './purchase-records.mongo.js';
import { verifyOstAddress } from './ost-address.js';
import { addressProvider } from './address-source.js';
import { decodeProfilePhoto } from './profile-photo-validation.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { hashIdentifier } from './identifier.js';
import { matchesSearch } from './list-search.js';
import { deny, fail, jsonBody, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const nullable = (v: unknown) => (typeof v === 'string' && v ? v : null);
type Principal = Exclude<Awaited<ReturnType<typeof authorizeAfHomes>>, { error: unknown }>;
const isNaNValue = (value: unknown) => typeof value === 'number' && Number.isNaN(value);
/** network_member_profiles fields the member views read (TIN / government ID handled apart). */
const PROFILE_FIELDS = [
  'staff_id',
  'referrer_staff_id',
  'ost_referrer_staff_id',
  'date_of_birth',
  'sex',
  'civil_status',
  'street_no',
  'city_municipality',
  'province',
  'province_code',
  'city_municipality_code',
  'zip_code',
  'tel_no',
  'mobile_no',
  'fb_messenger',
  'employer_name',
  'employer_address',
  'job_position',
  'government_id_type',
];
/** Last four characters of a non-empty ASCII string (code points = UTF-16 units); else as is. */
const lastFour = (field: string) => ({
  $cond: [
    { $eq: [{ $type: field }, 'string'] },
    {
      $cond: [
        { $regexMatch: { input: field, regex: '^[\\x01-\\x7f]+\\z' } },
        { $substrCP: [field, { $max: [0, { $subtract: [{ $strLenCP: field }, 4] }] }, 4] },
        field,
      ],
    },
    field,
  ],
});
export async function setupMongoMembers(db: Db) {
  await db.collection('network_member_profiles').createIndex({ staff_id: 1 }, { unique: true });
}

/** The existing Members console: one creation request commits login, profile, hierarchy and AA. */
export function createMongoMembersHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  objects?: PrivateObjectStore,
  /** Key that signs paged-list cursors; without one a per-process random key is used. */
  cursorSecret?: Buffer,
) {
  const col = (name: string) => db.collection<MongoRow>(name),
    access = createMongoOstAccess(db),
    cursorKey = cursorSecret ?? randomBytes(32);
  /** Member profiles with TIN / government ID reduced to their last four characters (see rows). */
  const readProfiles = (filter: Document, session?: ClientSession, leanFields?: string[]) =>
    col('network_member_profiles')
      .aggregate(
        [
          { $match: filter },
          {
            $project: leanFields
              ? { _id: 0, ...Object.fromEntries(leanFields.map((field) => [field, 1])) }
              : {
                  _id: 0,
                  ...Object.fromEntries(PROFILE_FIELDS.map((field) => [field, 1])),
                  tin: lastFour('$tin'),
                  government_id_number: lastFour('$government_id_number'),
                },
          },
        ],
        { session },
      )
      .toArray();
  /**
   * leanProfiles: only the profile fields list filtering and ordering read (paged lists fetch the
   * full, masked profile for the page rows separately).
   */
  async function rows(session?: ClientSession, leanProfiles = false) {
    // Rows keyed by staff_id / subject_staff_id never read their own _id, so it is not fetched.
    const read = (name: string, fields: string[], withId = true) =>
      col(name)
        .find(
          {},
          {
            session,
            projection: {
              ...(withId ? {} : { _id: 0 }),
              ...Object.fromEntries(fields.map((field) => [field, 1])),
            },
          },
        )
        .toArray();
    const [staff, assignments, roles, profiles, departments, numbers, edges] = await Promise.all([
      read('staff_users', [
        'employee_number',
        'full_name',
        'email',
        'department_id',
        'status',
        'created_at',
      ]),
      read('staff_role_assignments', ['staff_id', 'role_id'], false),
      read('roles', ['slug', 'name', 'is_active']),
      // Raw TIN / government ID numbers never leave MongoDB when they are plain ASCII text: only
      // their last four characters are read, which is all the masked views use
      // ('***' + String(value).slice(-4) gives the same text for the tail). Other forms are
      // returned unchanged and masked by the same JS code as before.
      readProfiles({}, session, leanProfiles ? ['staff_id', 'referrer_staff_id'] : undefined),
      read('departments', ['name', 'code', 'is_active']),
      read('sale_team_accreditations', ['staff_id', 'aa_number'], false),
      read('referral_relationships', ['subject_staff_id', 'upline_staff_id', 'is_active'], false),
    ]);
    return { staff, assignments, roles, profiles, departments, numbers, edges } as Record<
      'staff' | 'assignments' | 'roles' | 'profiles' | 'departments' | 'numbers' | 'edges',
      MongoRow[]
    >;
  }
  const indexCache = new WeakMap<object, ReturnType<typeof buildIndexes>>();
  function indexes(data: Awaited<ReturnType<typeof rows>>) {
    let built = indexCache.get(data);
    if (!built) indexCache.set(data, (built = buildIndexes(data)));
    return built;
  }
  /** Lookup maps that return exactly what the former Array.find calls returned (first match). */
  function buildIndexes(data: Awaited<ReturnType<typeof rows>>) {
    const first = (
      list: MongoRow[],
      key: (row: MongoRow) => unknown,
      keep = (_: MongoRow) => true,
    ) => {
      const map = new Map<unknown, MongoRow>();
      for (const row of list) {
        const value = key(row);
        // NaN never matched under ===, but Map keys use SameValueZero; keep the old behaviour.
        if (isNaNValue(value) || !keep(row) || map.has(value)) continue;
        map.set(value, row);
      }
      return map;
    };
    const activeChildren = new Map<unknown, MongoRow[]>();
    for (const row of data.edges)
      if (row.is_active === true && !isNaNValue(row.upline_staff_id)) {
        const list = activeChildren.get(row.upline_staff_id);
        if (list) list.push(row);
        else activeChildren.set(row.upline_staff_id, [row]);
      }
    return {
      staff: first(data.staff, (row) => row._id),
      assignment: first(data.assignments, (row) => row.staff_id),
      role: first(data.roles, (row) => row._id),
      profile: first(data.profiles, (row) => row.staff_id),
      department: first(data.departments, (row) => row._id),
      number: first(data.numbers, (row) => row.staff_id),
      activeEdge: first(
        data.edges,
        (row) => row.subject_staff_id,
        (row) => row.is_active === true,
      ),
      activeChildren,
    };
  }
  /** Every member view, validated (the canonical read used by every non-paged path). */
  function views(data: Awaited<ReturnType<typeof rows>>) {
    return unvalidatedViews(data).map((value) => memberSchema.parse(value));
  }
  /**
   * Only the fields listFilter and pageKey read, with the same values as unvalidatedViews: paged
   * lists filter and order every member with these, then build full views for the page rows.
   */
  function listKeys(data: Awaited<ReturnType<typeof rows>>) {
    const index = indexes(data);
    return data.staff.flatMap((staff) => {
      const role = index.role.get(index.assignment.get(staff._id)?.role_id);
      if (!role || !MEMBER_POSITIONS.includes(role.slug as MemberPosition)) return [];
      const headId =
        index.activeEdge.get(staff._id)?.upline_staff_id ??
        index.profile.get(staff._id)?.referrer_staff_id ??
        null;
      return [
        {
          id: staff._id,
          employeeNumber: staff.employee_number ?? null,
          fullName: staff.full_name,
          email: staff.email,
          position: role.slug,
          positionLabel: role.name,
          referrerName: index.staff.get(headId)?.full_name ?? null,
          aaNumber: index.number.get(staff._id)?.aa_number ?? null,
        } as Record<string, unknown>,
      ];
    });
  }
  /** Member views before memberSchema validation, in staff order. */
  function unvalidatedViews(
    data: Awaited<ReturnType<typeof rows>>,
    profiles?: Map<unknown, MongoRow>,
    only?: Set<unknown>,
  ) {
    const index = indexes(data);
    const getStaff = (id: unknown) => index.staff.get(id);
    // Lookups always use every row; `only` limits which members get a view.
    return (only ? data.staff.filter((row) => only.has(row._id)) : data.staff).flatMap((staff) => {
      const assignment = index.assignment.get(staff._id),
        role = index.role.get(assignment?.role_id);
      if (!role || !MEMBER_POSITIONS.includes(role.slug as MemberPosition)) return [];
      const profile = (profiles ?? index.profile).get(staff._id),
        edge = index.activeEdge.get(staff._id);
      const headId = edge?.upline_staff_id ?? profile?.referrer_staff_id ?? null;
      const value: Record<string, unknown> = {
        id: staff._id,
        employeeNumber: staff.employee_number ?? null,
        fullName: staff.full_name,
        email: staff.email,
        position: role.slug,
        positionLabel: role.name,
        departmentName: index.department.get(staff.department_id)?.name ?? null,
        status: staff.status,
        referrerName: getStaff(headId)?.full_name ?? null,
        ostReferrerName: getStaff(profile?.ost_referrer_staff_id)?.full_name ?? null,
        referrerStaffId: headId,
        ostReferrerStaffId: profile?.ost_referrer_staff_id ?? null,
        aaNumber: index.number.get(staff._id)?.aa_number ?? null,
        createdAt: staff.created_at ?? '',
        tinMasked: profile?.tin ? '***' + String(profile.tin).slice(-4) : null,
        governmentIdMasked: profile?.government_id_number
          ? '***' + String(profile.government_id_number).slice(-4)
          : null,
      };
      for (const [field, column] of Object.entries({
        dateOfBirth: 'date_of_birth',
        sex: 'sex',
        civilStatus: 'civil_status',
        streetNo: 'street_no',
        cityMunicipality: 'city_municipality',
        province: 'province',
        provinceCode: 'province_code',
        cityMunicipalityCode: 'city_municipality_code',
        zipCode: 'zip_code',
        telNo: 'tel_no',
        mobileNo: 'mobile_no',
        fbMessenger: 'fb_messenger',
        employerName: 'employer_name',
        employerAddress: 'employer_address',
        jobPosition: 'job_position',
        governmentIdType: 'government_id_type',
      }))
        value[field] = nullable(profile?.[column]);
      return [value];
    });
  }
  /**
   * Rows a list request may return: caller visibility, then the position and search filters.
   * Search sees what the caller sees: a member outside the caller's detail scope is listed with a
   * blank email (listRow), so its email is not searchable either - otherwise repeated searches
   * could reveal the masked address.
   */
  function listFilter(scope: ReturnType<typeof visibility>, query: MemberListQuery) {
    return (row: Record<string, unknown>) =>
      (!scope || scope.visible.has(row.id as string)) &&
      (!query.position || row.position === query.position) &&
      matchesSearch(query.search ?? '', [
        row.fullName,
        !scope || scope.detail.has(row.id as string) ? row.email : '',
        row.employeeNumber,
        row.aaNumber,
        row.positionLabel,
        row.referrerName,
      ]);
  }
  /** List masking: members outside the caller's detail scope lose contact and identity fields. */
  function listRow(row: Member, scope: ReturnType<typeof visibility>) {
    const detailAuthorized = !scope || scope.detail.has(row.id);
    if (detailAuthorized) return { ...row, detailAuthorized };
    const masked: Record<string, unknown> = { ...row, detailAuthorized: false, email: '' };
    for (const key of [
      'dateOfBirth',
      'streetNo',
      'cityMunicipality',
      'province',
      'zipCode',
      'telNo',
      'mobileNo',
      'fbMessenger',
      'tinMasked',
      'governmentIdMasked',
      'employerName',
      'employerAddress',
      'jobPosition',
    ])
      masked[key] = null;
    return memberSchema.parse(masked);
  }
  /** Deterministic paged order: full name, then id (plain code-unit comparison). */
  const pageKey = (row: Record<string, unknown>) => [String(row.fullName ?? ''), String(row.id)];
  const comparePageKeys = (a: string[], b: string[]) =>
    a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : a[1]! < b[1]! ? -1 : a[1]! > b[1]! ? 1 : 0;
  /** HMAC-signed cursor bound to the caller and the exact filters; it only marks a position. */
  function writeCursor(userId: string, filters: string, key: string[]) {
    const body = Buffer.from(JSON.stringify({ v: 1, u: userId, f: filters, k: key })).toString(
      'base64url',
    );
    return `${body}.${createHmac('sha256', cursorKey).update(body).digest('base64url')}`;
  }
  function readCursor(cursor: string, userId: string, filters: string): string[] | null {
    const [body, mac, extra] = cursor.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = createHmac('sha256', cursorKey).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return payload?.v === 1 &&
        payload.u === userId &&
        payload.f === filters &&
        Array.isArray(payload.k) &&
        payload.k.length === 2 &&
        payload.k.every((part: unknown) => typeof part === 'string')
        ? payload.k
        : null;
    } catch {
      return null;
    }
  }
  /**
   * Opt-in paged member list (`limit` and/or `cursor`). Same visibility, filters and masking as
   * the full list; exact total after authorization; deterministic name/id order. Only the page
   * rows are validated with memberSchema (approved for paged reads) and only they load full
   * profiles, so the other members' sensitive fields are never read. Writes are unaffected.
   */
  async function pagedList(principal: Principal, req: VercelRequest, res: VercelResponse) {
    const query = memberListQuerySchema.parse(req.query);
    const limit = query.limit ?? 50;
    const filters = JSON.stringify([query.position ?? null, query.search ?? '']);
    const after = query.cursor ? readCursor(query.cursor, principal.userId, filters) : null;
    if (query.cursor && !after) refuse(400, 'The page cursor is invalid for this list');
    const data = await rows(undefined, true);
    const scope = visibility(principal, data);
    const matching = listKeys(data)
      .filter(listFilter(scope, query))
      .sort((a, b) => comparePageKeys(pageKey(a), pageKey(b)));
    let start = 0;
    if (after) {
      start = matching.findIndex((row) => comparePageKeys(pageKey(row), after) > 0);
      if (start < 0) start = matching.length;
    }
    const page = matching.slice(start, start + limit);
    const ids = new Set(page.map((row) => row.id));
    const fullProfiles = new Map<unknown, MongoRow>();
    if (ids.size)
      for (const profile of await readProfiles({ staff_id: { $in: [...ids] } }))
        if (!fullProfiles.has(profile.staff_id))
          fullProfiles.set(profile.staff_id, profile as MongoRow);
    const byId = new Map(
      unvalidatedViews(data, fullProfiles, ids).map((value) => [value.id, value]),
    );
    const rowsOut = page.map((row) => listRow(memberSchema.parse(byId.get(row.id)), scope));
    const last = page[page.length - 1];
    res.status(200).json({
      data: rowsOut,
      meta: {
        total: matching.length,
        limit,
        nextCursor:
          last && start + page.length < matching.length
            ? writeCursor(principal.userId, filters, pageKey(last))
            : null,
      },
    });
  }
  function visibility(principal: Principal, data: Awaited<ReturnType<typeof rows>>) {
    if (!MEMBER_POSITIONS.includes(principal.roleSlug as MemberPosition)) return null;
    const index = indexes(data);
    const detail = new Set([principal.userId]),
      visible = new Set([principal.userId]),
      queue = [principal.userId];
    if (principal.roleSlug !== 'ost')
      for (let head = 0; head < queue.length; head++) {
        const parent = queue[head]!;
        for (const edge of index.activeChildren.get(parent) ?? []) {
          const id = String(edge.subject_staff_id);
          if (detail.has(id)) continue;
          const assignment = index.assignment.get(id),
            role = index.role.get(assignment?.role_id);
          if (principal.roleSlug === 'sales_manager' && role?.slug !== 'ost') continue;
          detail.add(id);
          visible.add(id);
          queue.push(id);
        }
      }
    if (principal.roleSlug !== 'vice_director') {
      let cursor = principal.userId;
      const seen = new Set([cursor]);
      while (true) {
        const edge = index.activeEdge.get(cursor);
        if (!edge || seen.has(String(edge.upline_staff_id))) break;
        cursor = String(edge.upline_staff_id);
        seen.add(cursor);
        visible.add(cursor);
      }
    }
    return { visible, detail };
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = subPath(req),
      verb = method(req),
      direct = path === 'ost';
    const teamTransfer = verb === 'POST' ? /^([0-9a-f-]+)\/team-transfer$/.exec(path) : null;
    const transferring = !!teamTransfer && z.uuid().safeParse(teamTransfer[1]).success;
    const kindTransfer = verb === 'POST' ? /^([0-9a-f-]+)\/transfer$/.exec(path) : null;
    const converting = !!kindTransfer && z.uuid().safeParse(kindTransfer[1]).success;
    const editing = verb === 'PATCH' && z.uuid().safeParse(path).success;
    const creating = verb === 'POST' && (path === '' || direct);
    if (
      !creating &&
      !transferring &&
      !converting &&
      !editing &&
      !(
        verb === 'GET' &&
        (['', 'uplines', 'ost-referrers'].includes(path) || z.uuid().safeParse(path).success)
      )
    )
      return fail(res, 'NOT_IMPLEMENTED', 'This native member workflow is not enabled', 501);
    const principal = await authorize(
      req,
      'network.members',
      creating ? 'create' : transferring || converting || editing ? 'update' : 'view',
    );
    if ('error' in principal) return deny(res, principal);
    let uploaded: string | undefined;
    const session = client.startSession();
    try {
      if (converting) {
        await transferMongoMemberKind(db, client, authorize, req, kindTransfer![1]!);
        const row = views(await rows()).find(value => value.id === kindTransfer![1]);
        if (!row) refuse(503, 'The conversion outcome requires review before retrying');
        return res.status(200).json(row);
      }
      if (editing) {
        await updateMongoMemberProfile(db, client, authorize, req, path, async (actor, transaction) => {
          const data = await rows(transaction);
          if (!views(data).some((row) => row.id === path)) refuse(404, 'Member not found');
          const scope = visibility(actor, data);
          if (scope && !scope.detail.has(path)) refuse(403, 'Member profile is outside your team');
        });
        const row = views(await rows()).find((value) => value.id === path);
        if (!row) refuse(503, 'The member update requires review before retrying');
        return res.status(200).json(row);
      }
      if (transferring) {
        await transferMongoOstTeam(db, client, authorize, req, teamTransfer![1]!);
        const row = views(await rows()).find((value) => value.id === teamTransfer![1]);
        if (!row) refuse(503, 'The transfer outcome requires review before retrying');
        return res.status(200).json(row);
      }
      if (!creating) {
        if (path === '' && (req.query.limit !== undefined || req.query.cursor !== undefined))
          return await pagedList(principal as Principal, req, res);
        const data = await rows(),
          all = views(data),
          scope = visibility(principal, data);
        if (path === 'uplines' || path === 'ost-referrers') {
          const position = memberListQuerySchema.parse(req.query).position;
          if (path === 'uplines' && !position) refuse(400, 'Choose the member position');
          const target = path === 'ost-referrers' ? 'ost' : MEMBER_UPLINE_ROLE[position!];
          return list(
            res,
            all
              .filter((row) => row.position === target && row.status === 'active')
              .map((row) => ({
                id: row.id,
                fullName: row.fullName,
                employeeNumber: row.employeeNumber,
                positionLabel: row.positionLabel,
              })),
          );
        }
        if (path) {
          let row = all.find((row) => row.id === path);
          if (!row) refuse(404, 'Member not found');
          if (scope && !scope.detail.has(path)) refuse(403, 'Member profile is outside your team');
          if (
            row!.position === 'ost' &&
            principal.permissions.some(
              (p) => p.moduleKey === 'network.ost_registrations' && p.canView,
            )
          ) {
            const member = await col('ost_members').findOne({ _id: path }, { session });
            if (member) {
              const current = await readMongoOstApplicant(db, member, session);
              const detail = await col('ost_registration_details').findOne(
                { application_id: member.application_id },
                { session },
              );
              const form = (detail?.official_details ?? {}) as Record<string, unknown>;
              const address = current.address ?? {};
              const title = (value: string | null) =>
                value?.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? null;
              row = {
                ...row!,
                fullName: current.fullName,
                email: current.email ?? row!.email,
                dateOfBirth: current.birthDate,
                sex: title(current.sex),
                civilStatus: title(current.civilStatus),
                streetNo: nullable(address.line1),
                cityMunicipality: nullable(address.city),
                province: nullable(address.province),
                zipCode: nullable(address.postalCode),
                mobileNo: current.phone,
                telNo: row!.telNo ?? nullable(form.telephone),
                fbMessenger: current.messenger,
                employerName: current.employerName,
                employerAddress: row!.employerAddress ?? nullable(form.employerAddress),
                jobPosition: current.jobPosition,
                governmentIdType: row!.governmentIdType ?? nullable(form.governmentIdType),
                tinMasked: current.tinMasked,
              };
            }
          }
          return res
            .status(200)
            .json(memberDetailSchema.parse({ ...row, tin: null, governmentIdNumber: null }));
        }
        const query = memberListQuerySchema.parse(req.query);
        return list(
          res,
          all.filter(listFilter(scope, query)).map((row) => listRow(row, scope)),
        );
      }
      const input = direct
        ? createOstMemberSchema.parse(jsonBody(req))
        : createMemberSchema.parse(jsonBody(req));
      if (!['admin', 'super_admin'].includes(principal.roleSlug))
        refuse(403, 'Administrator AA issuance required');
      if ('mode' in input && input.mode !== 'complete')
        refuse(400, 'Create the accredited OST account in one step');
      const photo = input.profilePhotoBase64 ? decodeProfilePhoto(input.profilePhotoBase64) : null;
      if (input.profilePhotoBase64 && !photo)
        refuse(400, 'Choose a valid compressed profile photo');
      if (photo && !objects) refuse(503, 'Private photo storage is unavailable');
      let location:
        | {
            province: string;
            cityMunicipality: string;
            provinceCode: string;
            cityMunicipalityCode: string;
            zipCode: string;
          }
        | undefined;
      if ('identity' in input) {
        const verified = await verifyOstAddress(input.identity);
        if (!verified.ok) refuse(verified.status, 'Choose a verified address hierarchy');
        if (verified.ok) input.identity = verified.identity;
      } else {
        const provider = addressProvider();
        const [provinces, cities] = await Promise.all([
          provider.provinces(),
          provider.localities(input.provinceCode),
        ]);
        const province = provinces.find((row) => row.code === input.provinceCode),
          city = cities.find((row) => row.code === input.cityMunicipalityCode);
        if (!province || !city || city.provinceCode !== province.code)
          refuse(400, 'Choose the province and city from the list');
        location = {
          province: province!.name,
          cityMunicipality: city!.name,
          provinceCode: province!.code,
          cityMunicipalityCode: city!.code,
          zipCode: input.zipCode || city!.postalCode || '',
        };
      }
      const userId = randomUUID(),
        password = await hashPassword(input.temporaryPassword!);
      const { temporaryPassword: _password, profilePhotoBase64: _photo, ...replayInput } = input;
      const fingerprint = purchaseFingerprint({
        ...replayInput,
        photoDigest: input.profilePhotoBase64 ? hashIdentifier(input.profilePhotoBase64) : null,
      });
      // Provisioning spans identity, hierarchy, AA and audit writes on remote MongoDB.
      const result = await session.withTransaction(async () => {
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
        const fresh = await authorize(req, 'network.members', 'create');
        if ('error' in fresh) refuse(fresh.error.status, 'Member creation is not permitted');
        const actor = fresh as Principal;
        if (!['admin', 'super_admin'].includes(actor.roleSlug))
          refuse(403, 'Administrator AA issuance required');
        const data = await rows(session),
          position = 'identity' in input ? 'ost' : input.position;
        const role = data.roles.find((row) => row.slug === position && row.is_active === true);
        if (!role) refuse(409, 'The selected position is not active');
        if (actor.roleSlug !== 'super_admin') {
          const permissions = await col('role_permissions')
              .find({ role_id: role!._id }, { session })
              .toArray(),
            modules = await col('modules').find({ is_active: true }, { session }).toArray();
          const grants = permissions.flatMap((grant) => {
            const module = modules.find((row) => row._id === grant.module_id);
            return module
              ? [
                  {
                    moduleKey: String(module.key),
                    canView: grant.can_view === true,
                    canCreate: grant.can_create === true,
                    canUpdate: grant.can_update === true,
                    canDelete: grant.can_delete === true,
                  },
                ]
              : [];
          });
          if (!permissionsAreSubset(grants as Principal['permissions'], actor.permissions))
            refuse(403, 'Cannot assign permissions you do not possess');
        }
        const now = new Date().toISOString(),
          date = new Date();
        let applicationId: string | null = null;
        let head: string | null = null;
        let fullName: string, email: string;
        if ('identity' in input) {
          const prior = await col('ost_registration_details').findOne(
            { request_id: input.requestId },
            { session },
          );
          if (prior) {
            if (prior.created_by !== actor.userId || prior.payload_hash !== fingerprint)
              refuse(409, 'Request payload changed');
            const member = await col('ost_members').findOne(
              { application_id: prior.application_id },
              { session },
            );
            if (!member) refuse(409, 'The saved account requires administrator review');
            return createOstMemberResultSchema.parse({
              applicationId: prior.application_id,
              memberId: member!._id,
              status: 'approved',
            });
          }
          const sponsor = await access.sponsor(input.sponsorStaffId, session, true);
          await access.scope(
            actor,
            { _id: input.sponsorStaffId, sponsor_staff_id: input.sponsorStaffId },
            session,
          );
          head = sponsor.staffId;
          fullName = [input.identity.firstName, input.identity.middleName, input.identity.lastName]
            .filter(Boolean)
            .join(' ');
          email = input.identity.email.toLowerCase();
          if (
            (await col('ost_applications').findOne(
              {
                status: { $in: ['submitted', 'under_review', 'changes_requested', 'approved'] },
                $or: [{ email }, { phone: input.identity.phone }],
              },
              { session },
            )) ||
            (await col('ost_members').findOne({ phone: input.identity.phone }, { session }))
          )
            refuse(409, 'An OST account or application already exists');
          applicationId = randomUUID();
          const codeId = randomUUID();
          await col('referral_codes').insertOne(
            {
              _id: codeId,
              code_hash: hashIdentifier(randomUUID()),
              code_hint: 'MANUAL',
              sponsor_staff_id: head,
              is_active: false,
              max_uses: 1,
              use_count: 1,
              expires_at: now,
              created_by: actor.userId,
            },
            { session },
          );
          await col('ost_applications').insertOne(
            {
              _id: applicationId,
              referral_code_id: codeId,
              sponsor_staff_id: head,
              email,
              phone: input.identity.phone,
              first_name: input.identity.firstName,
              middle_name: input.identity.middleName || null,
              last_name: input.identity.lastName,
              birth_date: input.identity.birthDate,
              address: input.identity.address,
              registration_details: {
                officialAccreditation: true,
                addressHierarchy: input.identity.addressHierarchy ?? null,
              },
              status: 'approved',
              submitted_at: now,
              reviewed_at: now,
              reviewed_by: actor.userId,
              review_notes: null,
            },
            { session },
          );
          const {
            dateApplied,
            programCategory,
            vipCardType,
            applicantSignatureStatus,
            referrerSignatureStatus,
            referrerSnapshot,
            ...official
          } = input.form;
          await col('ost_registration_details').insertOne(
            {
              _id: randomUUID(),
              application_id: applicationId,
              request_id: input.requestId,
              payload_hash: fingerprint,
              created_by: actor.userId,
              form_number: await allocatePurchaseId(
                db,
                'AF-ACC',
                'ost_registration_details',
                'form_number',
                session,
              ),
              date_applied: dateApplied,
              program_category: programCategory,
              vip_card_type: vipCardType,
              applicant_signature_status: applicantSignatureStatus,
              referrer_signature_status: referrerSignatureStatus,
              applicant_signed_on: input.form.applicantSignedOn,
              referrer_signed_on: input.form.referrerSignedOn,
              official_details: official,
              referrer_snapshot: { ...referrerSnapshot, ...sponsor },
              endorsed_at: null,
              endorsed_by: null,
              source: 'manual',
              created_at: now,
            },
            { session },
          );
        } else {
          fullName = input.fullName;
          email = input.email.toLowerCase();
          head = input.referrerStaffId ?? null;
          const department = data.departments.find((row) => row._id === input.departmentId);
          if (!department || department.code !== 'SALES' || department.is_active !== true)
            refuse(400, 'Choose the active Sales department');
          const expected = MEMBER_UPLINE_ROLE[input.position];
          if (expected) {
            const parent = await access.required('staff_users', String(head), session),
              assigned = await access.role(String(head), session);
            if (parent.status !== 'active' || assigned?.slug !== expected)
              refuse(400, 'Head must be the active immediate upline');
          } else if (head) refuse(400, 'A Vice Director has no head');
          if (input.ostReferrerStaffId) {
            const referrer = await access.required(
                'staff_users',
                input.ostReferrerStaffId,
                session,
              ),
              assigned = await access.role(input.ostReferrerStaffId, session);
            if (referrer.status !== 'active' || assigned?.slug !== 'ost')
              refuse(400, 'Choose an active OST referrer');
          }
        }
        if (
          (await col('auth_users').findOne({ email }, { session })) ||
          (await col('staff_users').findOne({ email }, { session }))
        )
          refuse(409, 'An account with this email already exists');
        await col('auth_users').insertOne(
          {
            _id: userId,
            email,
            emailVerified: true,
            name: fullName,
            createdAt: date,
            updatedAt: date,
          },
          { session },
        );
        await col('auth_accounts').insertOne(
          {
            _id: randomUUID(),
            accountId: userId,
            userId,
            providerId: 'credential',
            password,
            createdAt: date,
            updatedAt: date,
          },
          { session },
        );
        await col('staff_users').insertOne(
          {
            _id: userId,
            email,
            full_name: fullName,
            department_id: 'identity' in input ? null : input.departmentId,
            status: 'active',
            must_change_password: true,
            invited_at: null,
            activated_at: now,
            created_at: now,
            updated_at: now,
            employee_number: await allocatePurchaseId(
              db,
              'AF-EMP',
              'staff_users',
              'employee_number',
              session,
            ),
            sales_number:
              position === 'ost'
                ? null
                : await allocatePurchaseId(db, 'AF-SALES', 'staff_users', 'sales_number', session),
          },
          { session },
        );
        await col('staff_role_assignments').insertOne(
          {
            _id: randomUUID(),
            staff_id: userId,
            role_id: role!._id,
            assigned_by: actor.userId,
            created_at: now,
          },
          { session },
        );
        if (head)
          await col('referral_relationships').insertOne(
            {
              _id: randomUUID(),
              subject_staff_id: userId,
              upline_staff_id: head,
              hierarchy_role: position,
              is_active: true,
              is_authoritative: true,
              assigned_by: actor.userId,
              created_at: now,
            },
            { session },
          );
        if ('identity' in input) {
          await col('ost_members').insertOne(
            {
              _id: userId,
              application_id: applicationId,
              sponsor_staff_id: head,
              ost_number: await allocatePurchaseId(
                db,
                'AF-OST',
                'ost_members',
                'ost_number',
                session,
              ),
              full_name: fullName,
              email,
              phone: input.identity.phone,
              status: 'active',
              approved_by: actor.userId,
              approved_at: now,
              created_at: now,
            },
            { session },
          );
          await col('ost_accreditation_terms').insertOne(
            {
              _id: randomUUID(),
              ost_id: userId,
              application_id: applicationId,
              starts_on: input.startsOn,
              expires_on: input.expiresOn,
              status: 'active',
              approved_by: actor.userId,
              approved_at: now,
            },
            { session },
          );
        } else {
          const profile: Record<string, unknown> = {
            _id: randomUUID(),
            staff_id: userId,
            referrer_staff_id: head,
            ost_referrer_staff_id: input.ostReferrerStaffId ?? null,
            created_at: now,
          };
          for (const [field, column] of Object.entries({
            dateOfBirth: 'date_of_birth',
            sex: 'sex',
            civilStatus: 'civil_status',
            streetNo: 'street_no',
            telNo: 'tel_no',
            mobileNo: 'mobile_no',
            fbMessenger: 'fb_messenger',
            tin: 'tin',
            employerName: 'employer_name',
            employerAddress: 'employer_address',
            jobPosition: 'job_position',
            governmentIdType: 'government_id_type',
            governmentIdNumber: 'government_id_number',
          }))
            profile[column] = (input as Record<string, unknown>)[field] ?? null;
          Object.assign(profile, {
            province: location!.province,
            city_municipality: location!.cityMunicipality,
            province_code: location!.provinceCode,
            city_municipality_code: location!.cityMunicipalityCode,
            zip_code: location!.zipCode,
          });
          await col('network_member_profiles').insertOne(profile as MongoRow, { session });
        }
        await createMongoSaleTeamRecords(db).manage(
          userId,
          actor.userId,
          {
            kind: position === 'ost' ? 'OST' : 'IST',
            action: 'approve',
            ...(input.aaNumberMode === 'manual' ? { aaNumber: input.aaNumber } : {}),
          },
          session,
        );
        if (photo && objects) {
          uploaded ??= `profile-photos/${userId}/${randomUUID()}.jpg`;
          await objects.put(uploaded, photo, 'image/jpeg');
          await col('profile_photos').insertOne(
            { _id: randomUUID(), owner_id: userId, object_key: uploaded, updated_at: now },
            { session },
          );
        }
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: actor.userId,
            action: position === 'ost' ? 'OST_ACCREDITATION_APPROVED' : 'MEMBER_CREATED',
            entity_type: position === 'ost' ? 'ost_application' : 'network_member',
            entity_id: applicationId ?? userId,
            after_data: {
              memberId: userId,
              email,
              fullName,
              position,
              source: 'direct',
              endorsed: false,
            },
            created_at: now,
          },
          { session },
        );
        return position === 'ost'
          ? createOstMemberResultSchema.parse({
              applicationId,
              memberId: userId,
              status: 'approved',
            })
          : views(await rows(session)).find((row) => row.id === userId)!;
      }, { timeoutMS: 45_000 });
      return res.status(201).json(result);
    } catch (error) {
      if (uploaded && objects) {
        // shortcut: uncertain storage/DB failures retain a private object for operator reconciliation.
        try {
          if (!(await col('profile_photos').findOne({ object_key: uploaded })))
            await objects.remove(uploaded);
        } catch {
          /* Never delete a possibly committed photo. */
        }
      }
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Some fields need attention', 400);
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 404
              ? 'NOT_FOUND'
              : error.status === 400
                ? 'VALIDATION_ERROR'
                : 'CONFLICT',
          error.message,
          error.status,
        );
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(res, 'CONFLICT', 'This identity or AA number already exists', 409);
      return fail(res, 'INTERNAL', 'Member action is unavailable. Please retry', 503);
    } finally {
      await session.endSession();
    }
  };
}
