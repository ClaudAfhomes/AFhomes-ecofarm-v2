import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  AF_ID_ALPHABET,
  afHomesDepartmentSchema,
  afHomesRoleSchema,
  afHomesStaffSchema,
  afHomesRestrictionSchema,
  createAfHomesRoleSchema,
  createAfHomesStaffSchema,
  type AfHomesPermission,
} from '@afhomes/contracts';
import { permissionsAreSubset } from './afhomes-permissions.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { createMongoStaffSalesInvolvementHandler } from './staff-sales-involvement.mongo.js';
import { STAFF_DELETE_BLOCKER_CHECKS } from './staff-history.js';
import { deny, fail, list, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

const departmentInput = z.object({ name: z.string().trim().min(2).max(80) }).strict();
const staffUpdate = z.object({
  departmentId: z.string().uuid().nullable().optional(),
  roleId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  restrictions: z.array(afHomesRestrictionSchema).optional(),
});
const titleInput = z
  .object({ name: z.string().trim().min(1).max(100), departmentId: z.string().uuid().optional() })
  .strict();
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value ?? ''));
const protectedSlug = (slug: unknown) =>
  ['admin', 'super_admin', 'customer'].includes(String(slug));

/** Explicit operator setup, never request-time initialization. */
export async function setupMongoOrganization(db: Db) {
  for (const [table, field] of [
    ['departments', 'code'],
    ['departments', 'name'],
    ['roles', 'slug'],
    ['roles', 'name'],
    ['staff_users', 'email'],
  ])
    await db.collection(table!).createIndex({ [field!]: 1 }, { unique: true });
  for (const field of ['employee_number', 'sales_number'])
    await db
      .collection('staff_users')
      .createIndex(
        { [field]: 1 },
        { unique: true, partialFilterExpression: { [field]: { $type: 'string' } } },
      );
  await db.collection('staff_role_assignments').createIndex({ staff_id: 1 }, { unique: true });
  await db
    .collection('role_permissions')
    .createIndex({ role_id: 1, module_id: 1 }, { unique: true });
  await db
    .collection('staff_permission_restrictions')
    .createIndex({ staff_id: 1, module_id: 1 }, { unique: true });
}

export function createMongoOrganizationHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const staffSalesInvolvement = createMongoStaffSalesInvolvementHandler(db, client, authorize);
  async function catalogs(session?: ClientSession) {
    const data: Record<string, MongoRow[]> = {};
    for (const name of [
      'departments',
      'roles',
      'modules',
      'role_permissions',
      'staff_users',
      'staff_role_assignments',
      'staff_permission_restrictions',
    ])
      data[name] = await col(name).find({}, { session }).toArray();
    const moduleById = new Map(data.modules!.map((row) => [String(row._id), row.key]));
    const departmentById = new Map(data.departments!.map((row) => [row._id, row.name]));
    const roles = data
      .roles!.map((row) =>
        afHomesRoleSchema.parse({
          id: row._id,
          slug: row.slug,
          name: row.name,
          isSystem: row.is_system === true,
          isActive: row.is_active === true,
          departmentId: row.department_id ?? null,
          departmentName: departmentById.get(String(row.department_id)) ?? null,
          assignedCount: data.staff_role_assignments!.filter((entry) => entry.role_id === row._id)
            .length,
          permissions: data
            .role_permissions!.filter((entry) => entry.role_id === row._id)
            .map((entry) => ({
              moduleKey: moduleById.get(String(entry.module_id)),
              canView: entry.can_view,
              canCreate: entry.can_create,
              canUpdate: entry.can_update,
              canDelete: entry.can_delete,
            })),
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const staff = data
      .staff_users!.flatMap((row) => {
        const assignment = data.staff_role_assignments!.find((entry) => entry.staff_id === row._id),
          role = roles.find((entry) => entry.id === assignment?.role_id);
        if (!role) return [];
        return [
          afHomesStaffSchema.parse({
            id: row._id,
            email: row.email,
            fullName: row.full_name,
            status: row.status,
            departmentId: row.department_id ?? null,
            departmentName: departmentById.get(String(row.department_id)) ?? null,
            roleId: role.id,
            roleName: role.name,
            employeeNumber: row.employee_number ?? null,
            salesNumber: row.sales_number ?? null,
            restrictions: data
              .staff_permission_restrictions!.filter((entry) => entry.staff_id === row._id)
              .map((entry) => ({
                moduleKey: moduleById.get(String(entry.module_id)),
                denyView: entry.deny_view,
                denyCreate: entry.deny_create,
                denyUpdate: entry.deny_update,
                denyDelete: entry.deny_delete,
              })),
            mustChangePassword: row.must_change_password === true,
            invitedAt: row.invited_at ?? null,
            activatedAt: row.activated_at ?? null,
            createdAt: iso(row.created_at),
          }),
        ];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const departments = data
      .departments!.map((row) =>
        afHomesDepartmentSchema.parse({
          id: row._id,
          code: row.code,
          name: row.name,
          isActive: row.is_active === true,
          staffCount: data.staff_users!.filter((entry) => entry.department_id === row._id).length,
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return { rows: data, roleViews: roles, staffViews: staff, departmentViews: departments };
  }
  async function allocate(prefix: string, field: string, session: ClientSession) {
    for (let attempt = 0; attempt < 64; attempt++) {
      const value = `${prefix}-${Array.from(randomBytes(5), (byte) => AF_ID_ALPHABET[byte & 31]).join('')}`;
      if (!(await col('staff_users').findOne({ [field]: value }, { session }))) return value;
    }
    throw new Error('Identifier allocation failed');
  }
  async function permissions(roleId: string, input: AfHomesPermission[], session: ClientSession) {
    const modules = await col('modules')
      .find({ key: { $in: input.map((row) => row.moduleKey) } }, { session })
      .toArray();
    const byKey = new Map(modules.map((row) => [row.key, row._id]));
    if (
      new Set(input.map((row) => row.moduleKey)).size !== input.length ||
      input.some((row) => !byKey.has(row.moduleKey))
    )
      refuse(400, 'Invalid module permissions');
    await col('role_permissions').deleteMany({ role_id: roleId }, { session });
    if (input.length)
      await col('role_permissions').insertMany(
        input.map((row) => ({
          _id: randomUUID(),
          role_id: roleId,
          module_id: byKey.get(row.moduleKey),
          can_view: row.canView,
          can_create: row.canCreate,
          can_update: row.canUpdate,
          can_delete: row.canDelete,
        })),
        { session },
      );
  }
  async function audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    session: ClientSession,
  ) {
    await col('audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actorId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        before_data: before ?? null,
        after_data: after ?? null,
        created_at: new Date().toISOString(),
      },
      { session },
    );
  }
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method === 'GET' && /^staff\/[^/]+\/sales-involvement$/.test(subPath(req)))
        return staffSalesInvolvement(req, res);
      const path = subPath(req),
        verb = method(req),
        match = /^(roles|departments|staff)(?:\/([a-f0-9-]{36}))?(?:\/(audit|deactivate))?$/.exec(
          path,
        );
      if (!match) return fail(res, 'NOT_FOUND', 'Organization endpoint not found', 404);
      const family = match[1] as 'roles' | 'departments' | 'staff',
        id = match[2],
        suffix = match[3];
      if (
        (suffix === 'audit' && (!id || verb !== 'GET' || family === 'departments')) ||
        (suffix === 'deactivate' && (family !== 'staff' || verb !== 'POST')) ||
        (!suffix && !['GET', ...(id ? ['PATCH', 'DELETE'] : ['POST'])].includes(verb))
      )
        return fail(res, 'NOT_FOUND', 'Organization endpoint not found', 404);
      const module =
        suffix === 'audit' && family === 'roles'
          ? 'governance.audit'
          : (`organization.${family}` as const);
      const action =
        verb === 'GET'
          ? 'view'
          : suffix === 'deactivate' || verb === 'PATCH'
            ? 'update'
            : verb === 'DELETE'
              ? 'delete'
              : 'create';
      const auth = await authorize(req, module, action);
      if ('error' in auth) return deny(res, auth);
      if (verb === 'GET') {
        if (suffix === 'audit') {
          const events = await col('audit_events')
            .find({ entity_type: family === 'roles' ? 'role' : 'staff_user', entity_id: id })
            .sort({ created_at: -1 })
            .toArray();
          return list(
            res,
            events.map(({ _id, ...row }) => ({ id: _id, ...row })),
          );
        }
        const data = await catalogs(),
          rows =
            family === 'roles'
              ? data.roleViews
              : family === 'staff'
                ? data.staffViews
                : data.departmentViews;
        if (family === 'staff' && !id && req.query.includeAccreditation === '1') {
          // Accreditation is read from saved records, never generated by listing staff.
          const records = await col('sale_team_accreditations')
            .find({ staff_id: { $in: data.staffViews.map((row) => row.id) } })
            .toArray();
          return list(
            res,
            data.staffViews.map((row) => ({
              ...row,
              aaNumber: ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(
                data.roleViews.find((role) => role.id === row.roleId)?.slug ?? '',
              )
                ? (records.find((entry) => entry.staff_id === row.id)?.aa_number ?? null)
                : null,
            })),
          );
        }
        const found = id ? rows.find((row) => row.id === id) : null;
        return id
          ? found
            ? res.status(200).json(found)
            : fail(res, 'NOT_FOUND', 'Record not found', 404)
          : list(res, rows);
      }
      const session = client.startSession();
      try {
        const result = await session.withTransaction(async () => {
          // Serialize organization mutations so assignment/delete checks cannot race.
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne(
              { _id: 'organization-write' },
              { $inc: { seq: 1 } },
              { upsert: true, session },
            );
          const fresh = await authorize(req, module, action);
          if ('error' in fresh) return refuse(fresh.error.status, fresh.error.error.message);
          const data = await catalogs(session),
            now = new Date().toISOString(),
            targetId = id ?? randomUUID();
          const raw = data.rows[family === 'staff' ? 'staff_users' : family]?.find(
            (row) => row._id === id,
          );
          if (id && !raw) refuse(404, 'Record not found');
          const requireDepartment = async (value: string | null | undefined, active: boolean) => {
            if (
              value &&
              !(await col('departments').findOne(
                { _id: value, ...(active ? { is_active: true } : {}) },
                { session },
              ))
            )
              refuse(400, 'Unknown department');
          };
          if (family === 'departments') {
            if (verb === 'DELETE') {
              if (
                data.rows.staff_users!.some((row) => row.department_id === id) ||
                data.rows.roles!.some((row) => row.department_id === id)
              )
                refuse(409, 'Department has assigned staff or roles');
              await col('departments').deleteOne({ _id: id }, { session });
              await audit(
                fresh.userId,
                'DEPARTMENT_DELETED',
                'department',
                targetId,
                raw,
                null,
                session,
              );
              return { deleted: true };
            }
            const input = departmentInput.parse(req.body);
            if (id)
              await col('departments').updateOne(
                { _id: id },
                { $set: { name: input.name, updated_at: now } },
                { session },
              );
            else {
              const slug = input.name
                  .toUpperCase()
                  .replace(/[^A-Z0-9]+/g, '_')
                  .replace(/^_+|_+$/g, '')
                  .slice(0, 32),
                code = /^[A-Z]/.test(slug) ? slug : `DEPT_${slug}`;
              if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) refuse(400, 'Invalid department input');
              await col('departments').insertOne(
                {
                  _id: targetId,
                  code,
                  name: input.name,
                  is_active: true,
                  created_at: now,
                  updated_at: now,
                },
                { session },
              );
            }
            await audit(
              fresh.userId,
              id ? 'DEPARTMENT_UPDATED' : 'DEPARTMENT_CREATED',
              'department',
              targetId,
              raw,
              { name: input.name },
              session,
            );
            return (await catalogs(session)).departmentViews.find((row) => row.id === targetId);
          }
          if (family === 'roles') {
            if (verb === 'DELETE') {
              if (raw!.is_system || protectedSlug(raw!.slug))
                refuse(403, 'System roles cannot be deleted');
              if (data.rows.staff_role_assignments!.some((row) => row.role_id === id))
                refuse(409, 'Role has assigned staff');
              await col('role_permissions').deleteMany({ role_id: id }, { session });
              await col('roles').deleteOne({ _id: id }, { session });
              await audit(fresh.userId, 'ROLE_DELETED', 'role', targetId, raw, null, session);
              return { deleted: true };
            }
            if (raw && protectedSlug(raw.slug))
              refuse(403, 'System access and protected role titles cannot be changed');
            if (raw?.is_system) {
              const input = titleInput.safeParse(req.body);
              if (fresh.roleSlug !== 'super_admin' || protectedSlug(raw.slug) || !input.success)
                refuse(403, 'System access and protected role titles cannot be changed');
              const title = titleInput.parse(req.body);
              await requireDepartment(title.departmentId, true);
              await col('roles').updateOne(
                { _id: id },
                {
                  $set: {
                    name: title.name,
                    department_id: title.departmentId ?? raw.department_id ?? null,
                    updated_at: now,
                  },
                },
                { session },
              );
              await audit(
                fresh.userId,
                'ROLE_DISPLAY_TITLE_UPDATED',
                'role',
                targetId,
                { name: raw.name, department_id: raw.department_id ?? null },
                title,
                session,
              );
            } else {
              if (id === fresh.roleId) refuse(403, 'You cannot edit your own role permissions');
              const input = id
                ? createAfHomesRoleSchema.partial().parse(req.body)
                : createAfHomesRoleSchema.parse(req.body);
              if (input.permissions && !permissionsAreSubset(input.permissions, fresh.permissions))
                refuse(403, 'Cannot grant permissions you do not possess');
              await requireDepartment(input.departmentId, true);
              if (id)
                await col('roles').updateOne(
                  { _id: id },
                  {
                    $set: {
                      ...(input.name === undefined ? {} : { name: input.name }),
                      ...(input.isActive === undefined ? {} : { is_active: input.isActive }),
                      ...(input.departmentId === undefined
                        ? {}
                        : { department_id: input.departmentId }),
                      updated_at: now,
                    },
                  },
                  { session },
                );
              else {
                const slug = input
                  .name!.toLowerCase()
                  .replace(/[^a-z0-9]+/g, '_')
                  .replace(/^_|_$/g, '');
                await col('roles').insertOne(
                  {
                    _id: targetId,
                    slug,
                    name: input.name,
                    is_system: false,
                    is_active: input.isActive,
                    department_id: input.departmentId,
                    created_at: now,
                    updated_at: now,
                  },
                  { session },
                );
              }
              if (input.permissions) await permissions(targetId, input.permissions, session);
              if (id)
                await audit(
                  fresh.userId,
                  'ROLE_PERMISSIONS_UPDATED',
                  'role',
                  targetId,
                  null,
                  null,
                  session,
                );
              await audit(
                fresh.userId,
                id ? 'ROLE_UPDATED' : 'ROLE_CREATED',
                'role',
                targetId,
                raw,
                input,
                session,
              );
            }
            return (await catalogs(session)).roleViews.find((row) => row.id === targetId);
          }
          const before = data.staffViews.find((row) => row.id === id),
            beforeRole = data.roleViews.find((row) => row.id === before?.roleId);
          if (id === fresh.userId) refuse(403, 'You cannot edit your own account');
          if (beforeRole?.slug === 'super_admin' && fresh.roleSlug !== 'super_admin')
            refuse(403, 'Only Super Admin can modify a Super Admin');
          if (verb === 'DELETE') {
            if (fresh.roleSlug !== 'super_admin' || beforeRole?.slug === 'super_admin')
              refuse(403, 'Super Admin accounts cannot be permanently deleted');
            const blockers = new Set<string>();
            for (const [label, table, column] of STAFF_DELETE_BLOCKER_CHECKS)
              if (
                await col(table).findOne(
                  { [column === 'id' ? '_id' : column]: id },
                  { session, projection: { _id: 1 } },
                )
              )
                blockers.add(label);
            if (
              await col('commission_rules').findOne(
                { target_id: id, target_type: { $in: ['staff', 'ost'] } },
                { session },
              )
            )
              blockers.add('commission rules');
            if (await col('customers').findOne({ auth_user_id: id }, { session }))
              blockers.add('customer login');
            if (blockers.size) return { protectedHistory: [...blockers] };
            for (const [name, field] of [
              ['staff_invitations', 'auth_user_id'],
              ['staff_permission_restrictions', 'staff_id'],
              ['staff_role_assignments', 'staff_id'],
              ['auth_sessions', 'userId'],
              ['auth_accounts', 'userId'],
              ['auth_two_factors', 'userId'],
              ['auth_session_assurance', 'user_id'],
            ])
              await col(name!).deleteMany({ [field!]: id }, { session });
            await col('staff_users').deleteOne({ _id: id }, { session });
            await col('auth_users').deleteOne({ _id: id }, { session });
            await audit(
              fresh.userId,
              'STAFF_DELETED',
              'staff_user',
              targetId,
              before,
              { deleted: true },
              session,
            );
            return { deleted: true };
          }
          if (!id) {
            const input = createAfHomesStaffSchema.parse(req.body),
              role = data.roleViews.find((row) => row.id === input.roleId);
            if (!role?.isActive) refuse(400, 'Role is not active');
            if (role!.slug === 'ost')
              refuse(409, 'Create OST accounts through official OST registration and approval.');
            if (role!.slug === 'customer')
              refuse(400, 'Customer accounts cannot be assigned staff roles');
            if (role!.slug === 'super_admin' && fresh.roleSlug !== 'super_admin')
              refuse(403, 'Only Super Admin can assign Super Admin');
            if (!permissionsAreSubset(role!.permissions, fresh.permissions))
              refuse(403, 'Cannot assign permissions you do not possess');
            await requireDepartment(input.departmentId, false);
            const email = input.email.toLowerCase();
            if (
              (await col('auth_users').findOne({ email }, { session })) ||
              (await col('staff_users').findOne({ email }, { session }))
            )
              refuse(409, 'An account with this email already exists');
            const password = await hashPassword(input.temporaryPassword),
              date = new Date();
            await col('auth_users').insertOne(
              {
                _id: targetId,
                email,
                emailVerified: true,
                name: input.fullName,
                createdAt: date,
                updatedAt: date,
              },
              { session },
            );
            await col('auth_accounts').insertOne(
              {
                _id: randomUUID(),
                accountId: targetId,
                providerId: 'credential',
                userId: targetId,
                password,
                createdAt: date,
                updatedAt: date,
              },
              { session },
            );
            await col('staff_users').insertOne(
              {
                _id: targetId,
                email,
                full_name: input.fullName,
                department_id: input.departmentId,
                status: 'active',
                must_change_password: true,
                employee_number: await allocate('AF-EMP', 'employee_number', session),
                sales_number: ['vice_director', 'senior_sales_manager', 'sales_manager'].includes(
                  role!.slug,
                )
                  ? await allocate('AF-SALES', 'sales_number', session)
                  : null,
                invited_at: null,
                activated_at: now,
                created_at: now,
                updated_at: now,
              },
              { session },
            );
            await col('staff_role_assignments').insertOne(
              {
                _id: randomUUID(),
                staff_id: targetId,
                role_id: input.roleId,
                assigned_by: fresh.userId,
                created_at: now,
              },
              { session },
            );
            const { temporaryPassword: _, ...safe } = input;
            await audit(fresh.userId, 'STAFF_CREATED', 'staff_user', targetId, null, safe, session);
          } else {
            const input =
              suffix === 'deactivate'
                ? { status: 'inactive' as const }
                : staffUpdate.parse(req.body);
            if (
              beforeRole?.slug === 'super_admin' &&
              input.status &&
              input.status !== 'active' &&
              data.staffViews.filter(
                (row) => row.status === 'active' && row.roleId === beforeRole.id,
              ).length <= 1
            )
              refuse(409, 'The last active Super Admin cannot be deactivated');
            await requireDepartment(input.departmentId, false);
            if (input.roleId) {
              const role = data.roleViews.find((row) => row.id === input.roleId);
              if (!role?.isActive) refuse(400, 'Role is not active');
              if (
                input.roleId !== before?.roleId &&
                (role!.slug === 'ost' || beforeRole?.slug === 'ost')
              )
                refuse(409, 'Use the controlled OST accreditation workflow for role changes.');
              if (role!.slug === 'customer')
                refuse(400, 'Customer accounts cannot be assigned staff roles');
              if (role!.slug === 'super_admin' && fresh.roleSlug !== 'super_admin')
                refuse(403, 'Only Super Admin can assign Super Admin');
              if (!permissionsAreSubset(role!.permissions, fresh.permissions))
                refuse(403, 'Cannot assign permissions you do not possess');
              await col('staff_role_assignments').updateOne(
                { staff_id: id },
                { $set: { role_id: role!.id, assigned_by: fresh.userId } },
                { session },
              );
              if (
                !raw!.sales_number &&
                ['vice_director', 'senior_sales_manager', 'sales_manager'].includes(role!.slug)
              )
                await col('staff_users').updateOne(
                  { _id: id },
                  { $set: { sales_number: await allocate('AF-SALES', 'sales_number', session) } },
                  { session },
                );
            }
            await col('staff_users').updateOne(
              { _id: id },
              {
                $set: {
                  ...(input.departmentId === undefined
                    ? {}
                    : { department_id: input.departmentId }),
                  ...(input.status === undefined ? {} : { status: input.status }),
                  updated_at: now,
                },
              },
              { session },
            );
            let retiredEdges = 0;
            if (input.status && input.status !== 'active')
              retiredEdges = (
                await col('referral_relationships').updateMany(
                  { upline_staff_id: id, is_active: true },
                  { $set: { is_active: false } },
                  { session },
                )
              ).modifiedCount;
            if (input.restrictions) {
              const byKey = new Map(data.rows.modules!.map((row) => [row.key, row._id]));
              if (
                new Set(input.restrictions.map((row) => row.moduleKey)).size !==
                  input.restrictions.length ||
                input.restrictions.some((row) => !byKey.has(row.moduleKey))
              )
                refuse(400, 'Invalid restriction module');
              await col('staff_permission_restrictions').deleteMany({ staff_id: id }, { session });
              const restrictions = input.restrictions.filter(
                (row) => row.denyView || row.denyCreate || row.denyUpdate || row.denyDelete,
              );
              if (restrictions.length)
                await col('staff_permission_restrictions').insertMany(
                  restrictions.map((row) => ({
                    _id: randomUUID(),
                    staff_id: id,
                    module_id: byKey.get(row.moduleKey),
                    deny_view: row.denyView,
                    deny_create: row.denyCreate,
                    deny_update: row.denyUpdate,
                    deny_delete: row.denyDelete,
                  })),
                  { session },
                );
            }
            await audit(
              fresh.userId,
              suffix === 'deactivate' ? 'STAFF_DEACTIVATED' : 'STAFF_ACCESS_UPDATED',
              'staff_user',
              targetId,
              before,
              { ...input, retiredDownlineEdges: retiredEdges },
              session,
            );
            if (suffix === 'deactivate') return { deactivated: true };
          }
          return (await catalogs(session)).staffViews.find((row) => row.id === targetId);
        });
        if (result && 'protectedHistory' in result)
          return fail(
            res,
            'PROTECTED_HISTORY',
            'This staff account has historical business records and cannot be permanently deleted. Deactivate the account instead.',
            409,
            { canDelete: false, blockers: result.protectedHistory },
          );
        return res.status(verb === 'POST' && !id ? 201 : 200).json(result);
      } finally {
        await session.endSession();
      }
    } catch (error) {
      if (error instanceof z.ZodError)
        return fail(res, 'VALIDATION_ERROR', 'Invalid organization details', 400);
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 404
              ? 'NOT_FOUND'
              : error.status === 409
                ? 'CONFLICT'
                : 'VALIDATION_ERROR',
          error.message,
          error.status,
        );
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return fail(res, 'CONFLICT', 'That name, email or identifier already exists', 409);
      return fail(res, 'INTERNAL', 'Organization service is unavailable', 503);
    }
  };
}
