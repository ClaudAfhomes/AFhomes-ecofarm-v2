import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { mongoDashboard } from './dashboard.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>;
beforeAll(async () => { test = await createTestReplica(); }, 120_000);
afterAll(async () => { await test?.stop(); });
it('derives exact collections and queues from persisted statuses without exposing records', async () => {
  const now = new Date().toISOString();
  await test.db.collection('card_sales').insertMany([{ status: 'payment_verified', created_at: now }, { status: 'submitted', created_at: now }]);
  await test.db.collection('payments').insertMany([
    { status: 'verified', amount: '60000.01', verified_at: now, notes: 'PRIVATE FINANCE NOTE' },
    { status: 'verified', amount: '0.02', verified_at: now },
    { status: 'recorded', amount: '900000.00', verified_at: now },
    { status: 'rejected', amount: '900000.00', verified_at: now },
    { status: 'voided', amount: '900000.00', verified_at: now },
  ]);
  await test.db.collection('memberships').insertOne({ status: 'active', points_balance: 0, activated_at: now });
  await test.db.collection('commissions').insertMany([{ status: 'earned', amount: '2400.01' }, { status: 'pending', amount: '999.00' }]);
  const result = await mongoDashboard(test.db, 'today');
  expect(result.totals).toMatchObject({ verifiedSales: 1, verifiedCollections: '60000.03', activeMemberships: 1, earnedUnpaidCommissions: '2400.01', pointsIssued: 0 });
  expect(result.queues.paymentVerification).toBe(1);
  expect(result.trend).toEqual([{ period: now.slice(0, 10), verifiedSales: 1, collections: '60000.03', activatedCards: 1, pointsRedeemed: 0 }]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE FINANCE NOTE');
});
