import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoMembersHandler } from './members.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { VercelRequest } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';

vi.mock('./address-source.js', () => ({
  addressProvider: () => ({
    provinces: async () => [{ code: '0434000000', name: 'Laguna' }],
    localities: async () => [
      { code: '0434010000', name: 'Victoria', provinceCode: '0434000000', postalCode: '4018' },
    ],
  }),
}));
let test: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>,
  client: MongoClient;
const col = (name: string) => test.db.collection<MongoRow>(name);
beforeAll(async () => {
  test = await createTestReplica();
  fixture = await seedPhase7Fixture(
    test.db,
    test.client,
    {
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 'synthetic-member-deadline-only-'.repeat(3),
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
    'SyntheticDeadline123!',
  );
  const host = test.client.options.hosts[0]!.toString();
  client = new MongoClient(`mongodb://${host}/?replicaSet=${test.client.options.replicaSet}`, {
    timeoutMS: 200,
  });
  await client.connect();
}, 30000);
afterAll(async () => {
  await client?.close();
  await test?.stop();
});

it.each(['IST', 'OST'] as const)(
  'creates %s when fresh authorization outlasts the ordinary client deadline',
  async (kind) => {
    let calls = 0;
    const assignment = await col('staff_role_assignments').findOne({ staff_id: fixture.admin.id });
    const authorize: typeof authorizeAfHomes = async () => {
      if (++calls === 2) await new Promise((resolve) => setTimeout(resolve, 350));
      return {
        userId: fixture.admin.id,
        email: fixture.admin.email,
        fullName: 'Synthetic Admin',
        status: 'active',
        roleId: String(assignment!.role_id),
        roleSlug: 'super_admin',
        roleName: 'Super Admin',
        mustChangePassword: false,
        permissions: [],
      };
    };
    const email = `synthetic-deadline-${kind.toLowerCase()}@example.invalid`;
    const department = await col('departments').findOne({ code: 'SALES' });
    const body =
      kind === 'IST'
        ? {
            fullName: 'Synthetic Deadline IST',
            email,
            temporaryPassword: 'SyntheticDeadlineTemp123!',
            departmentId: department!._id,
            position: 'vice_director',
            dateOfBirth: '1990-01-01',
            sex: 'Male',
            civilStatus: 'Single',
            streetNo: 'Synthetic Street',
            cityMunicipality: 'Victoria',
            province: 'Laguna',
            provinceCode: '0434000000',
            cityMunicipalityCode: '0434010000',
            zipCode: '4018',
            mobileNo: '+639171234588',
            governmentIdType: 'passport',
            governmentIdNumber: 'SYNTH-DEADLINE',
            employerName: 'Synthetic Employer',
            employerAddress: 'Synthetic Office',
            jobPosition: 'Seller',
          }
        : {
            requestId: randomUUID(),
            mode: 'complete',
            temporaryPassword: 'SyntheticDeadlineTemp123!',
            sponsorStaffId: fixture.staff.id,
            startsOn: '2026-10-01',
            expiresOn: '2027-10-01',
            identity: {
              firstName: 'Synthetic',
              lastName: 'Deadline OST',
              email,
              phone: '+639171234599',
              birthDate: '1990-01-01',
              address: {
                line1: 'Synthetic Street',
                city: 'Victoria',
                province: 'Laguna',
                countryCode: 'PH',
              },
            },
            form: {
              dateApplied: '2026-10-01',
              programCategory: 'non_vip',
              vipCardType: null,
              sex: 'male',
              civilStatus: 'single',
              governmentIdType: 'passport',
              governmentIdNumber: 'SYNTHETIC-DEADLINE-OST',
              applicantSignatureStatus: 'received',
              referrerSignatureStatus: 'received',
              applicantSignedOn: '2026-10-01',
              referrerSignedOn: '2026-10-01',
            },
          };
    const result = makeRes();
    await createMongoMembersHandler(
      client.db('afhomes_dev'),
      client,
      authorize,
    )(
      {
        method: 'POST',
        query: { familyPath: kind === 'OST' ? 'ost' : '' },
        headers: {},
        body,
      } as VercelRequest,
      result.res,
    );
    expect(result.state.status, JSON.stringify(result.state.body)).toBe(201);
    const staff = await col('staff_users').findOne({ email });
    expect(staff).toMatchObject({ must_change_password: true, status: 'active' });
    expect(
      await col('auth_accounts').countDocuments({ userId: staff!._id, providerId: 'credential' }),
    ).toBe(1);
    expect(await col('sale_team_accreditations').findOne({ staff_id: staff!._id })).toMatchObject({
      kind,
      status: 'active',
    });
  },
  15000,
);
