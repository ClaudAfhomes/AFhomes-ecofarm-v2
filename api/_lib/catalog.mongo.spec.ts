import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cardProductSchema, cardCategorySchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoCatalogHandlers, setupMongoCatalog } from './catalog.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import { toErrorEnvelope } from './envelope.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { VercelRequest } from './http.js';
import { applicationPlanSnapshot } from './application-records.mongo.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
let handlers: ReturnType<typeof createMongoCatalogHandlers>;
let allowed = true;
let role = 'super_admin';
const authorize: typeof authorizeAfHomes = async () =>
  allowed
    ? {
        userId: randomUUID(),
        email: 'synthetic@example.invalid',
        fullName: 'Synthetic Staff',
        status: 'active',
        roleId: randomUUID(),
        roleSlug: role,
        roleName: role,
        mustChangePassword: false,
        permissions: [],
      }
    : { error: toErrorEnvelope('FORBIDDEN', 'Insufficient permission', 403) };
beforeAll(async () => {
  test = await createTestReplica();
  await setupMongoCatalog(test.db);
  handlers = createMongoCatalogHandlers(test.db, test.client, authorize);
}, 120_000);
afterAll(async () => {
  await test?.stop();
});
async function call(family: 'plans' | 'categories', verb: string, path = '', body?: unknown) {
  const response = makeRes();
  await handlers[family](
    { method: verb, query: { familyPath: path }, headers: {}, body } as VercelRequest,
    response.res,
  );
  return response.state;
}

it('persists UUID categories/plans with the existing response contracts and exact prices', async () => {
  const category = await call('categories', 'POST', '', { name: 'Membership', slug: 'membership' });
  expect(category.status).toBe(201);
  const parsedCategory = cardCategorySchema.parse(category.body);
  const plan = await call('plans', 'POST', '', {
    name: 'Bronze',
    code: ' bronze ',
    categoryId: parsedCategory.id,
    cashPrice: '100000.00',
    minimumDownPayment: '10000.00',
    yearlyPoints: 1000,
    commissionRate: '0.04',
  });
  expect(plan.status).toBe(201);
  const product = cardProductSchema.parse(plan.body);
  expect(product.cashPrice).toBe('100000.00');
  expect(product.categoryId).toBe(parsedCategory.id);
  const session = test.client.startSession();
  try {
    const snapshot = await applicationPlanSnapshot(test.db,{planId:product.id},undefined,session);
    expect(snapshot).toMatchObject({discount_percent_snapshot:0,annual_points_tranches_snapshot:1,holder_limit_snapshot:1,validity_years_snapshot:1});
  } finally { await session.endSession(); }
  expect(await test.db.collection('card_plans').countDocuments()).toBe(1);
  expect((await call('plans', 'GET', product.id)).status).toBe(200);
  expect(
    (await call('plans', 'PATCH', product.id, { minimumDownPayment: '999999.00' })).status,
  ).toBe(400);
  expect((await call('plans', 'DELETE', product.id)).status).toBe(404);
});

it('hides inactive categories and their plans from sellers while preserving history', async () => {
  role = 'super_admin';
  const category = cardCategorySchema.parse(
    (await call('categories', 'POST', '', { name: 'Disabled', slug: 'disabled' })).body,
  );
  const plan = cardProductSchema.parse(
    (
      await call('plans', 'POST', '', {
        name: 'Preserved',
        code: 'PRESERVED',
        categoryId: category.id,
        cashPrice: '100000.00',
        yearlyPoints: 1000,
        commissionRate: '0.04',
      })
    ).body,
  );
  expect((await call('categories', 'PATCH', category.id, { isActive: false })).status).toBe(200);
  role = 'sm';
  expect((await call('plans', 'GET', plan.id)).status).toBe(404);
  expect((await call('categories', 'GET', category.id)).status).toBe(404);
  role = 'super_admin';
  expect((await call('plans', 'GET', plan.id)).status).toBe(200);
  expect(await test.db.collection('card_plans').countDocuments({ code: 'PRESERVED' })).toBe(1);
});

it('denies writes before mutation and rejects duplicate identifiers', async () => {
  const before = await test.db.collection('card_categories').countDocuments();
  allowed = false;
  expect((await call('categories', 'POST', '', { name: 'Denied', slug: 'denied' })).status).toBe(
    403,
  );
  expect(await test.db.collection('card_categories').countDocuments()).toBe(before);
  allowed = true;
  expect(
    (await call('categories', 'POST', '', { name: 'Membership duplicate', slug: 'membership' }))
      .status,
  ).toBe(409);
});

it('rolls a catalog mutation back when its audit fails', async () => {
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CARD_CATEGORY_CREATED' } },
    validationLevel: 'strict',
  });
  try {
    expect(
      (await call('categories', 'POST', '', { name: 'Rollback', slug: 'rollback' })).status,
    ).toBe(503);
    expect(await test.db.collection('card_categories').countDocuments({ slug: 'rollback' })).toBe(
      0,
    );
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
});
