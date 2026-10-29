import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { createAfHomesAdminAuth } from '../auth.js';
import type { MongoRow } from '../customer-activation.mongo.js';
import { seedPhase5Fixture } from './phase5-fixture.js';

/** Synthetic browser records for a fresh createTestReplica instance only. */
export async function seedPhase6Fixture(
  db: Db,
  client: MongoClient,
  env: NodeJS.ProcessEnv,
  password: string,
) {
  const base = await seedPhase5Fixture(db, client, env, password),
    col = (name: string) => db.collection<MongoRow>(name);
  let parent = '';
  for (const slug of ['vice_director', 'senior_sales_manager']) {
    const id = randomUUID(),
      roleId = randomUUID();
    await col('roles').insertOne({ _id: roleId, slug, name: slug, is_active: true });
    await col('staff_users').insertOne({
      _id: id,
      email: `${slug}@example.invalid`,
      full_name: `SYNTHETIC ${slug}`,
      status: 'active',
    });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: id,
      role_id: roleId,
    });
    if (parent)
      await col('referral_relationships').insertOne({
        _id: randomUUID(),
        subject_staff_id: id,
        upline_staff_id: parent,
        hierarchy_role: slug,
        is_authoritative: true,
        is_active: true,
      });
    parent = id;
  }
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: base.staff.id,
    upline_staff_id: parent,
    hierarchy_role: 'sales_manager',
    is_authoritative: true,
    is_active: true,
  });
  const moduleId = randomUUID();
  await col('modules').insertOne({
    _id: moduleId,
    key: 'network.ost_registrations',
    is_active: true,
  });
  const assignment = await col('staff_role_assignments').findOne({ staff_id: base.staff.id });
  await col('role_permissions').insertOne({
    _id: randomUUID(),
    role_id: assignment!.role_id,
    module_id: moduleId,
    can_view: true,
    can_create: false,
    can_update: false,
    can_delete: false,
  });
  const internal = createAfHomesAdminAuth(db, client, env),
    email = 'phase6-ost@example.invalid';
  const identity = await internal.api.createUser({
    body: { email, password, name: 'Synthetic OST Member', data: { emailVerified: true } },
  });
  const id = identity.user.id,
    roleId = randomUUID(),
    appId = randomUUID();
  await col('roles').insertOne({ _id: roleId, slug: 'ost', name: 'OST', is_active: true });
  await col('staff_users').insertOne({
    _id: id,
    email,
    full_name: 'SYNTHETIC OST MEMBER',
    status: 'active',
    must_change_password: true,
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: id,
    role_id: roleId,
  });
  await col('ost_applications').insertOne({
    _id: appId,
    sponsor_staff_id: base.staff.id,
    first_name: 'SYNTHETIC',
    email,
    phone: '+639171234568',
    status: 'approved',
    submitted_at: '2024-01-01T00:00:00.000Z',
    last_name: 'OST MEMBER',
    birth_date: '1990-01-01',
    address: { line1: 'Synthetic Street', city: 'Quezon City', province: 'Metro Manila' },
  });
  await col('ost_members').insertOne({
    _id: id,
    application_id: appId,
    sponsor_staff_id: base.staff.id,
    ost_number: 'AF-OST-QAABC',
    full_name: 'SYNTHETIC OST MEMBER',
    email,
    phone: '+639171234568',
    status: 'active',
    approved_by: base.staff.id,
    approved_at: '2024-01-01T00:00:00.000Z',
    created_at: '2024-01-01T00:00:00.000Z',
  });
  await col('referral_relationships').insertOne({
    _id: randomUUID(),
    subject_staff_id: id,
    upline_staff_id: base.staff.id,
    hierarchy_role: 'ost',
    is_authoritative: true,
    is_active: true,
  });
  await col('ost_registration_details').insertOne({
    _id: randomUUID(),
    application_id: appId,
    form_number: 'SYNTHETIC-OST-FORM',
    date_applied: '2024-01-01',
    program_category: 'future_vip',
    vip_card_type: null,
    applicant_signature_status: 'received',
    referrer_signature_status: 'received',
    endorsed_at: '2024-01-01T00:00:00.000Z',
    official_details: { sex: 'male', civilStatus: 'single' },
  });
  await col('ost_accreditation_terms').insertOne({
    _id: randomUUID(),
    ost_id: id,
    application_id: appId,
    status: 'active',
    starts_on: '2024-01-01',
    expires_on: '2025-01-01',
    approved_by: base.staff.id,
    approved_at: '2024-01-01T00:00:00.000Z',
  });
  await col('sale_team_accreditations').insertOne({
    _id: randomUUID(),
    staff_id: id,
    aa_number: 'AAO24010001',
    kind: 'OST',
    public_name: 'SYNTHETIC OST MEMBER',
    status: 'active',
    starts_on: '2024-01-01',
    expires_on: '2025-01-01',
    approved_by: base.staff.id,
    approved_at: '2024-01-01T00:00:00.000Z',
  });
  return { ...base, ost: { id, email } };
}
