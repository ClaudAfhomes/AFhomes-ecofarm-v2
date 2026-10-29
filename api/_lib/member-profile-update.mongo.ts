import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import {
  updateMemberProfileSchema,
  MEMBER_UPLINE_ROLE,
  type MemberPosition,
} from '@afhomes/contracts';
import { permissionsAreSubset, type authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { createMongoOstAccess } from './ost-accreditation.mongo.js';
import { addressProvider } from './address-source.js';
import { jsonBody } from './handler-kit.js';
import type { VercelRequest } from './http.js';

type Principal = Exclude<Awaited<ReturnType<typeof authorizeAfHomes>>, { error: unknown }>;
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};

/** The existing member edit contract, with identity/profile/hierarchy/audit in one transaction. */
export async function updateMongoMemberProfile(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  req: VercelRequest,
  id: string,
  assertScope: (actor: Principal, session: ClientSession) => Promise<void>,
) {
  const input = updateMemberProfileSchema.parse(jsonBody(req));
  if (!Object.keys(input).length) refuse(400, 'Some fields need attention');
  const {
    fullName,
    email,
    temporaryPassword,
    position,
    referrerStaffId,
    headChangeReason,
    ostReferrerStaffId,
    provinceCode,
    cityMunicipalityCode,
    tin,
    governmentIdNumber,
    ...rest
  } = input;
  let location: Record<string, unknown> | undefined;
  if (provinceCode !== undefined || cityMunicipalityCode !== undefined) {
    if (!provinceCode || !cityMunicipalityCode)
      refuse(400, 'Choose the province and city from the list');
    const provider = addressProvider();
    const [provinces, cities] = await Promise.all([
      provider.provinces(),
      provider.localities(provinceCode!),
    ]);
    const province = provinces.find((row) => row.code === provinceCode);
    const city = cities.find(
      (row) => row.code === cityMunicipalityCode && row.provinceCode === provinceCode,
    );
    if (!province || !city) refuse(400, 'Choose the province and city from the list');
    location = {
      province: province!.name,
      city_municipality: city!.name,
      province_code: province!.code,
      city_municipality_code: city!.code,
      zip_code: rest.zipCode || city!.postalCode || '',
    };
  }
  const password =
    temporaryPassword === undefined ? undefined : await hashPassword(temporaryPassword);
  const col = (name: string) => db.collection<MongoRow>(name);
  const access = createMongoOstAccess(db),
    session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await db
        .collection<{ _id: string; seq: number }>('counters')
        .updateOne({ _id: 'organization-write' }, { $inc: { seq: 1 } }, { upsert: true, session });
      const actor = await authorize(req, 'network.members', 'update');
      if ('error' in actor) return refuse(actor.error.status, 'Member update is not permitted');
      await assertScope(actor, session);
      const staff = await access.required('staff_users', id, session);
      const profile = await col('network_member_profiles').findOne({ staff_id: id }, { session });
      if (!profile) refuse(404, 'Member profile not found');
      const assignment = await col('staff_role_assignments').findOne({ staff_id: id }, { session });
      const currentRole = assignment
        ? await col('roles').findOne({ _id: String(assignment.role_id) }, { session })
        : null;
      if (!currentRole) refuse(409, 'Member position is unavailable');
      const currentPosition = String(currentRole!.slug) as MemberPosition;
      const changingPosition = position !== undefined && position !== currentPosition;
      if (changingPosition && (currentPosition === 'ost' || position === 'ost'))
        refuse(409, 'Use the controlled OST conversion workflow for accreditation role changes');
      const currentHead = profile!.referrer_staff_id ? String(profile!.referrer_staff_id) : null;
      if (
        currentPosition === 'ost' &&
        referrerStaffId !== undefined &&
        referrerStaffId !== currentHead
      )
        refuse(409, 'OST team changes require an approved transfer or renewal');
      const effectivePosition = position ?? currentPosition;
      let targetRole: MongoRow | null = null;
      if (changingPosition) {
        targetRole = await col('roles').findOne({ slug: position, is_active: true }, { session });
        if (!targetRole) refuse(400, 'Position is not active');
        const [grants, modules] = await Promise.all([
          col('role_permissions').find({ role_id: targetRole!._id }, { session }).toArray(),
          col('modules').find({ is_active: true }, { session }).toArray(),
        ]);
        const permissions = grants.flatMap((grant) => {
          const module = modules.find((row) => row._id === grant.module_id);
          return module
            ? [
                {
                  moduleKey: module.key,
                  canView: grant.can_view === true,
                  canCreate: grant.can_create === true,
                  canUpdate: grant.can_update === true,
                  canDelete: grant.can_delete === true,
                },
              ]
            : [];
        });
        if (!permissionsAreSubset(permissions as Principal['permissions'], actor.permissions))
          refuse(403, 'Cannot assign a position you do not possess');
      }
      const expected = MEMBER_UPLINE_ROLE[effectivePosition];
      let nextHead: string | null | undefined;
      if (changingPosition || referrerStaffId !== undefined) {
        if (!expected) {
          if (referrerStaffId) refuse(400, 'A Vice Director has no head');
          nextHead = null;
        } else {
          if (!referrerStaffId) refuse(400, 'A head is required');
          nextHead = referrerStaffId;
        }
      }
      const movingHead = nextHead !== undefined && nextHead !== currentHead;
      if (movingHead && (!headChangeReason || headChangeReason.trim().length < 3))
        refuse(400, 'A head change needs a reason');
      if (nextHead) {
        if (nextHead === id) refuse(400, 'A member cannot be their own head');
        const candidate = await access.required('staff_users', nextHead, session);
        const candidateRole = await access.role(nextHead, session);
        if (candidate.status !== 'active') refuse(409, 'Head is not active');
        if (candidateRole?.slug !== expected) refuse(400, 'Head must be the immediate upline');
        let cursor: string | null = nextHead;
        const seen = new Set([id]);
        while (cursor) {
          if (seen.has(cursor)) refuse(400, 'That head would create a cycle');
          seen.add(cursor);
          const edge: MongoRow | null = await col('referral_relationships').findOne(
            { subject_staff_id: cursor, is_active: true },
            { session },
          );
          cursor = edge ? String(edge.upline_staff_id) : null;
        }
      }
      let nextOst: string | null | undefined;
      if (ostReferrerStaffId !== undefined) {
        if (ostReferrerStaffId) {
          if (effectivePosition !== 'sales_manager')
            refuse(400, 'An OST referrer is for Sales Managers only');
          const referrer = await access.required('staff_users', ostReferrerStaffId, session);
          const role = await access.role(ostReferrerStaffId, session);
          if (referrer.status !== 'active' || role?.slug !== 'ost')
            refuse(400, 'OST referrer must be an active OST');
        }
        nextOst = ostReferrerStaffId;
      } else if (
        changingPosition &&
        effectivePosition !== 'sales_manager' &&
        profile!.ost_referrer_staff_id
      ) {
        nextOst = null;
      }
      const normalizedEmail = email?.toLowerCase();
      const changingEmail =
        normalizedEmail !== undefined && normalizedEmail !== String(staff.email).toLowerCase();
      if (changingEmail) {
        for (const table of ['staff_users', 'auth_users'])
          if (await col(table).findOne({ email: normalizedEmail, _id: { $ne: id } }, { session }))
            refuse(409, 'An account with this email already exists');
      }
      const now = new Date(),
        iso = now.toISOString();
      if (fullName !== undefined || changingEmail || password !== undefined) {
        const user = await col('auth_users').findOne({ _id: id }, { session });
        if (!user) refuse(409, 'The linked sign-in account requires review');
        await col('auth_users').updateOne(
          { _id: id },
          {
            $set: {
              ...(fullName !== undefined ? { name: fullName } : {}),
              ...(changingEmail ? { email: normalizedEmail, emailVerified: true } : {}),
              updatedAt: now,
            },
          },
          { session },
        );
        await col('staff_users').updateOne(
          { _id: id },
          {
            $set: {
              ...(fullName !== undefined ? { full_name: fullName } : {}),
              ...(changingEmail ? { email: normalizedEmail } : {}),
              ...(password !== undefined ? { must_change_password: true } : {}),
              updated_at: iso,
            },
          },
          { session },
        );
      }
      if (password !== undefined) {
        const account = await col('auth_accounts').findOne(
          { userId: id, providerId: 'credential' },
          { session },
        );
        if (!account) refuse(409, 'The credential account requires review');
        await col('auth_accounts').updateOne(
          { _id: account!._id },
          { $set: { password, updatedAt: now } },
          { session },
        );
      }
      if (password !== undefined || changingEmail) {
        await col('auth_sessions').deleteMany({ userId: id }, { session });
        await col('auth_session_assurance').deleteMany({ user_id: id }, { session });
      }
      if (targetRole)
        await col('staff_role_assignments').updateOne(
          { staff_id: id },
          { $set: { role_id: targetRole._id, assigned_by: actor.userId } },
          { session },
        );
      if (movingHead) {
        const edges = await col('referral_relationships')
          .find({ subject_staff_id: id, is_active: true }, { session })
          .toArray();
        if (edges.length > 1) refuse(409, 'Current genealogy requires review');
        if (edges[0])
          await col('referral_relationships').updateOne(
            { _id: edges[0]._id },
            { $set: { is_active: false, updated_at: iso } },
            { session },
          );
        if (nextHead)
          await col('referral_relationships').insertOne(
            {
              _id: randomUUID(),
              subject_staff_id: id,
              upline_staff_id: nextHead,
              hierarchy_role: effectivePosition,
              is_authoritative: true,
              is_active: true,
              assigned_by: actor.userId,
              assigned_at: iso,
              updated_at: iso,
            },
            { session },
          );
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: actor.userId,
            action: 'UPLINE_CORRECTED',
            entity_type: 'referral_relationship',
            entity_id: id,
            before_data: { uplineStaffId: currentHead },
            after_data: { uplineStaffId: nextHead },
            reason: headChangeReason,
            created_at: iso,
          },
          { session },
        );
      }
      await col('network_member_profiles').updateOne(
        { _id: profile!._id },
        {
          $set: {
            ...Object.fromEntries(
              Object.entries(rest).map(([key, value]) => [
                key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
                value ?? null,
              ]),
            ),
            ...location,
            ...(tin !== undefined ? { tin } : {}),
            ...(governmentIdNumber !== undefined
              ? { government_id_number: governmentIdNumber }
              : {}),
            ...(nextHead !== undefined ? { referrer_staff_id: nextHead } : {}),
            ...(nextOst !== undefined ? { ost_referrer_staff_id: nextOst } : {}),
            updated_at: iso,
          },
        },
        { session },
      );
      await col('audit_events').insertOne(
        {
          _id: randomUUID(),
          actor_id: actor.userId,
          action: 'MEMBER_UPDATED',
          entity_type: 'network_member',
          entity_id: id,
          before_data: null,
          after_data: { fields: Object.keys(input) },
          created_at: iso,
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
