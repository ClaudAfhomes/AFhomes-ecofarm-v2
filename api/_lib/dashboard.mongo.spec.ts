import { beforeAll, afterAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { mongoDashboard } from './dashboard.mongo.js';
import { projectDashboard } from './dashboard-projection.js';
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

it('matches the source projection over full documents for every range and edge-case value', async () => {
  const day = (offset: number, hour = 12) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offset);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  await Promise.all(['card_sales', 'payments', 'memberships', 'commissions', 'final_qualifications', 'ost_members', 'ost_applications', 'staff_users'].map((name) => test.db.collection(name).deleteMany({})));
  const statuses = ['pending', 'down_payment', 'overdue', 'payment_verified', 'final_qualification_pending', 'qualified', 'activated', 'cancelled'];
  await test.db.collection('card_sales').insertMany(
    Array.from({ length: 120 }, (_, i) => ({ status: statuses[i % statuses.length], created_at: i % 17 === 0 ? 'not-a-date' : day(i % 400, i % 24) })),
  );
  const amounts = ['0.01', '60000.00', '1.5', '25000', '007.10', '-5.00', '1,000.00', '1.234', null, 12.5, '0'];
  await test.db.collection('payments').insertMany(
    Array.from({ length: 160 }, (_, i) => ({
      status: ['verified', 'verified', 'recorded', 'rejected', 'voided'][i % 5],
      amount: amounts[i % amounts.length],
      verified_at: i % 23 === 0 ? null : i % 29 === 0 ? new Date(day(i % 40)) : day(i % 400, (i * 7) % 24),
    })),
  );
  await test.db.collection('payments').insertOne({ status: 'verified' });
  await test.db.collection('memberships').insertMany(
    Array.from({ length: 90 }, (_, i) => ({ status: ['active', 'expired', 'suspended'][i % 3], points_balance: i % 11 === 0 ? null : i * 37, activated_at: day(i % 380) })),
  );
  await test.db.collection('memberships').insertOne({ status: 'active' });
  await test.db.collection('commissions').insertMany(
    Array.from({ length: 40 }, (_, i) => ({ status: ['earned', 'pending', 'paid'][i % 3], amount: amounts[i % amounts.length] })),
  );
  await test.db.collection('final_qualifications').insertMany([{ status: 'pending' }, { status: 'pending' }, { status: 'done' }, {}]);
  await test.db.collection('ost_members').insertMany([{ status: 'active' }, { status: 'expired' }, {}]);
  await test.db.collection('ost_applications').insertMany([{ status: 'submitted' }, { status: 'under_review' }, { status: 'approved' }]);
  await test.db.collection('staff_users').insertMany([{ status: 'active' }, { status: 'inactive' }, { status: 'invited' }]);
  const all = (name: string) => test.db.collection(name).find({}).toArray() as never;
  for (const range of ['today', 'week', 'month', 'year', 'unknown-range']) {
    const expected = projectDashboard(
      {
        sales: await all('card_sales'),
        payments: await all('payments'),
        memberships: await all('memberships'),
        qualifications: await all('final_qualifications'),
        commissions: await all('commissions'),
        ost: await all('ost_members'),
        ostApplications: await all('ost_applications'),
        staff: await all('staff_users'),
      },
      range,
    );
    expect(await mongoDashboard(test.db, range), range).toEqual(expected);
  }
});
