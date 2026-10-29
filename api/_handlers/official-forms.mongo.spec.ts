import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { purchaseReservationCreateSchema } from '@afhomes/contracts';
import { createMongoOfficialFormsHandler } from '../_lib/official-forms.mongo.js';
import { createMongoStaffAccess } from '../_lib/afhomes-access.mongo.js';
import { createMongoSessionVerifier } from '../_lib/auth-verify.mongo.js';
import { createAfHomesAuth, getAuthOptions } from '../_lib/auth.js';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import { seedPhase5Fixture } from '../_lib/testing/phase5-fixture.js';
import { makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { toErrorEnvelope } from '../_lib/envelope.js';
type OfficialFormsHandler = ReturnType<typeof createMongoOfficialFormsHandler>;

const holder = vi.hoisted(() => ({ handler: null as OfficialFormsHandler | null, authorize: null as unknown }));

const env = {
  BETTER_AUTH_SECRET: 'phase5-loopback-fixture-only-'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:3000',
  AFHOMES_WEB_URL: 'http://localhost:5173',
};

const APP_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'cccccccc-0000-4000-8000-000000000003';
const TERMS_ID = '22222222-2222-4222-8222-222222222222';
const RES_ID = 'bbbbbbbb-0000-4000-8000-00000000000a';
const RESERVE_REQUEST = '44444444-4444-4444-8444-444444444444';

const applicationOriginBody = {
  origin: 'application',
  requestId: RESERVE_REQUEST,
  customerApplicationId: APP_ID,
  purchaseTermsId: TERMS_ID,
  reservationDate: '2026-10-07',
  agreementDate: '2026-10-07',
  scheduleNotes: [],
};

async function setupTest() {
  const replica = await createTestReplica({ timeoutMS: 15000 });
  const fixture = await seedPhase5Fixture(replica.db, replica.client, env);
  const auth = createAfHomesAuth(replica.db, replica.client, env);
  const options = getAuthOptions(env);
  const sessions = createMongoSessionVerifier(replica.db, auth);
  const access = createMongoStaffAccess(replica.db, sessions, env);
  const handler = createMongoOfficialFormsHandler(replica.db, replica.client, access.authorize);
  holder.handler = handler;
  holder.authorize = access.authorize;
  return { replica, fixture, handler, authorize: access.authorize };
}

async function call(opts: {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
}) {
  const { res, state } = makeRes();
  await holder.handler!(
    makeReq({
      method: opts.method ?? 'GET',
      familyPath: opts.path,
      body: opts.body,
      headers: { authorization: `Bearer ${opts.token ?? 'seller-token'}` },
    }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

describe('official-forms.mongo - application-origin reservation', () => {
  let replica: Awaited<ReturnType<typeof createTestReplica>>;
  let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;

  beforeEach(async () => {
    const setup = await setupTest();
    replica = setup.replica;
    fixture = setup.fixture;
  });

  afterEach(async () => {
    await replica?.stop();
  });

  it('the create contract needs no sale id at all', () => {
    expect(purchaseReservationCreateSchema.safeParse(applicationOriginBody).success).toBe(true);
    expect(
      purchaseReservationCreateSchema.safeParse({
        ...applicationOriginBody,
        saleId: 'eeeeeeee-0000-4000-8000-000000000005',
      }).success,
    ).toBe(false);
  });

  it('returns 401 for application-origin reservation creation without valid session', async () => {
    const response = await call({
      path: 'reservations',
      method: 'POST',
      body: applicationOriginBody,
    });
    expect(response.status).toBe(401);
  });

  it('returns 401 for unauthorized actor', async () => {
    const response = await call({
      path: 'reservations',
      method: 'POST',
      body: applicationOriginBody,
      token: 'forbidden-token',
    });
    expect(response.status).toBe(401);
  });
});

describe('official-forms.mongo - customer applications list', () => {
  let replica: Awaited<ReturnType<typeof createTestReplica>>;
  let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;

  beforeEach(async () => {
    const setup = await setupTest();
    replica = setup.replica;
    fixture = setup.fixture;
  });

  afterEach(async () => {
    await replica?.stop();
  });

  it('returns 401 for unknown application without valid session', async () => {
    const response = await call({
      path: 'customer-applications/aaaaaaaa-0000-4000-8000-000000000001',
      method: 'GET',
    });
    expect(response.status).toBe(401);
  });

  it('returns 401 for unauthorized access', async () => {
    const response = await call({
      path: 'customer-applications',
      method: 'GET',
      token: 'forbidden-token',
    });
    expect(response.status).toBe(401);
  });
});

describe('official-forms.mongo - reservations list', () => {
  let replica: Awaited<ReturnType<typeof createTestReplica>>;
  let fixture: Awaited<ReturnType<typeof seedPhase5Fixture>>;

  beforeEach(async () => {
    const setup = await setupTest();
    replica = setup.replica;
    fixture = setup.fixture;
  });

  afterEach(async () => {
    await replica?.stop();
  });

  it('returns 401 for unauthorized access', async () => {
    const response = await call({
      path: 'reservations',
      method: 'GET',
      token: 'forbidden-token',
    });
    expect(response.status).toBe(401);
  });
});