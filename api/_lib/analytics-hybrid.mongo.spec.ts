import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Decimal128, type Document } from 'mongodb';
import type { AnalyticsPeriod } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { calendarWindow, projectAnalytics, type Row } from './analytics-projection.js';
import {
  CANONICAL_UTC,
  globalAnalyticsAggregates,
  mergeAnalyticsAggregates,
} from './analytics-hybrid.mongo.js';
import { FIELDS } from './analytics.mongo.js';
import type { AfHomesPrincipal } from './afhomes-access.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
const NOW = new Date('2026-11-15T12:00:00.000Z');
const MISSING = Symbol('missing');
const principal = {
  userId: 'admin-1',
  roleSlug: 'super_admin',
  permissions: [],
} as unknown as AfHomesPrincipal;

/** Every date form the JS projection may meet, incl. window edges for day/week/month/year. */
const DATES: unknown[] = [
  '2026-11-15T12:00:00.000Z',
  '2026-11-15T00:00:00.000Z',
  '2026-11-14T23:59:59.999Z',
  '2026-11-16T00:00:00.000Z',
  '2026-11-09T00:00:00.000Z',
  '2026-11-08T23:59:59.999Z',
  '2026-11-01T00:00:00.000Z',
  '2026-10-31T23:59:59.999Z',
  '2026-11-30T23:59:59.999Z',
  '2026-12-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z',
  '2025-12-31T23:59:59.999Z',
  '2027-01-01T00:00:00.000Z',
  '2026-11-15T20:00:00+08:00',
  '2026-11-01T07:59:59+08:00',
  '2026-11-15T10:00:00',
  '2026-11-15 10:00',
  '2026-11-15',
  '2026-11-01',
  'Nov 15, 2026',
  new Date('2026-11-15T12:34:56.789Z'),
  new Date('2026-11-01T00:00:00.000Z'),
  1794744000000,
  null,
  MISSING,
  '',
  'garbage',
  '2026-02-30T00:00:00.000Z',
  '2028-02-29T10:00:00.000Z',
  '2026-04-31T00:00:00.000Z',
  '2026-11-15T24:00:00.000Z',
  '2026-11-15T12:00:00.000Z\n',
  '2026-11-15t12:00:00.000z',
  '2026-11-15T12:00:00.000000Z',
  '2026-11-15T12:00:00Z',
  ['2026-11-15T12:00:00.000Z'],
  '0000-01-01T00:00:00.000Z',
  '+002026-11-15T12:00:00.000Z',
];
const MONEY: unknown[] = [
  '100',
  '100.5',
  '100.55',
  '100.555',
  '-5',
  ' 5',
  '5\n',
  100,
  100.5,
  Decimal128.fromString('100.50'),
  '1234567890123456789012345',
  '1234567890123456789012345678901234567890.15',
  '99999999999999999999.99',
  null,
  MISSING,
  'abc',
  '007.10',
  '0',
];
const PAYMENT_STATUS: unknown[] = [
  'verified',
  'recorded',
  'rejected',
  'voided',
  'Verified',
  ['verified'],
];
const COMMISSION_STATUS: unknown[] = [
  'pending',
  'payment_verified',
  'final_qualification_pending',
  'earned',
  'paid',
  'cancelled',
  'Pending',
  'toString',
];

const doc = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== MISSING));
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

async function seed(saleRefs: unknown[]) {
  const rnd = random(7);
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]!;
  const col = (name: string) => test.db.collection<Document>(name);
  await col('customers').insertMany(DATES.map((d, i) => doc({ _id: `cus-${i}`, created_at: d })));
  await col('memberships').insertMany(
    DATES.flatMap((d, i) =>
      ['active', 'expired', ['active']].map((status, j) =>
        doc({ _id: `mem-${i}-${j}`, status, activated_at: d }),
      ),
    ),
  );
  const payments = [];
  // Every date x money pair once (verified, matched sale) plus a random mix of everything.
  for (const [i, d] of DATES.entries())
    for (const [j, m] of MONEY.entries())
      payments.push(
        doc({
          _id: `pay-${i}-${j}`,
          sale_id: 'sale-0',
          status: 'verified',
          verified_at: d,
          amount: m,
        }),
      );
  for (let n = 0; n < 1500; n += 1)
    payments.push(
      doc({
        _id: `pay-r-${n}`,
        sale_id: pick(saleRefs),
        status: pick(PAYMENT_STATUS),
        verified_at: pick(DATES),
        amount: pick(MONEY),
      }),
    );
  await col('payments').insertMany(payments);
  const commissions = [];
  for (let n = 0; n < 600; n += 1)
    commissions.push(
      doc({
        _id: `com-${n}`,
        sale_id: pick(saleRefs),
        status: pick(COMMISSION_STATUS),
        settled_before_system: pick([true, false, MISSING, 1, 'true']),
      }),
    );
  await col('commissions').insertMany(commissions);
}

const fetchRows = async (name: string, filter: Document = {}): Promise<Row[]> =>
  (
    await test.db
      .collection<Document>(name)
      .find(filter, {
        projection: { _id: 1, ...Object.fromEntries(FIELDS[name]!.map((f) => [f, 1])) },
      })
      .toArray()
  ).map((row) => ({ ...row, id: row._id }));

async function compare(period: AnalyticsPeriod) {
  const { from, to } = calendarWindow(period, NOW);
  const sales = await fetchRows('card_sales', { origin: 'normal' });
  const scoped = { sales, attributed: 0, legacy: [] as Row[] };
  const common = {
    principal,
    period,
    from,
    to,
    kind: 'global' as const,
    scoped,
    canCommissions: true,
    canRedemption: false,
    plans: [],
    redemptionsAll: [],
    sellers: null,
    organizationStaff: [],
    organizationDepartments: [],
    networkContext: null,
  };
  // Reference: the existing full-row path (projectAnalytics over every projected row).
  const reference = projectAnalytics({
    ...common,
    allCustomers: await fetchRows('customers'),
    paymentsAll: await fetchRows('payments'),
    membershipsAll: await fetchRows('memberships'),
    commissionsAll: await fetchRows('commissions'),
  });
  const aggregates = await globalAnalyticsAggregates(test.db, {
    sales,
    from,
    to,
    period,
    withPayments: true,
    withCommissions: true,
    fields: FIELDS,
  });
  expect(aggregates).not.toBeNull();
  const hybrid = mergeAnalyticsAggregates(
    projectAnalytics({
      ...common,
      allCustomers: aggregates!.fallback.customers,
      paymentsAll: aggregates!.fallback.payments,
      membershipsAll: aggregates!.fallback.memberships,
      commissionsAll: aggregates!.fallback.commissions,
    }),
    aggregates!,
  );
  return { reference, hybrid, aggregates: aggregates! };
}

beforeAll(async () => {
  test = await createTestReplica();
  await test.db.collection<{ _id: string } & Document>('card_sales').insertMany([
    { _id: 'sale-0', origin: 'normal', status: 'active', created_at: '2026-11-15T01:00:00.000Z' },
    { _id: 'sale-1', origin: 'normal', status: 'active', created_at: '2026-11-02T01:00:00.000Z' },
    {
      _id: 'sale-arr',
      origin: ['normal'],
      status: 'active',
      created_at: '2026-11-03T01:00:00.000Z',
    },
    {
      _id: 'sale-imp',
      origin: 'imported',
      status: 'active',
      created_at: '2026-11-04T01:00:00.000Z',
    },
  ]);
  await seed(['sale-0', 'sale-1', 'sale-arr', 'sale-imp', 'unknown', 7, ['sale-0'], null, MISSING]);
}, 60_000);
afterAll(async () => test?.stop());

describe('hybrid global analytics aggregation', () => {
  it.each(['day', 'week', 'month', 'year'] as const)(
    'matches the full-row projection exactly for period %s',
    async (period) => {
      const { reference, hybrid, aggregates } = await compare(period);
      expect(hybrid).toStrictEqual(reference);
      // The database really did the work for canonical rows; only legacy forms fell back.
      expect(aggregates.customers.total).toBeGreaterThan(0);
      expect(aggregates.fallback.customers.length).toBeLessThan(DATES.length);
      expect(reference.trends.length).toBeGreaterThan(0);
    },
  );

  it('classifies only canonical UTC strings (and absent values) for database processing', async () => {
    const { aggregates } = await compare('month');
    const fallbackDates = aggregates.fallback.customers.map((row) =>
      row.created_at instanceof Date ? 'BSON Date' : row.created_at,
    );
    expect(fallbackDates).toEqual(
      expect.arrayContaining([
        '2026-11-15T20:00:00+08:00',
        '2026-11-15T10:00:00',
        '2026-11-15',
        'Nov 15, 2026',
        'BSON Date',
        1794744000000,
        '',
        '2026-02-30T00:00:00.000Z',
        '2026-11-15T24:00:00.000Z',
        '2026-11-15T12:00:00.000Z\n',
        '2026-11-15T12:00:00.000000Z',
        '+002026-11-15T12:00:00.000Z',
      ]),
    );
    expect(fallbackDates).not.toContain('2026-11-15T12:00:00.000Z');
    expect(fallbackDates).not.toContain('2026-11-01T00:00:00.000Z');
    expect(fallbackDates).not.toContain(null);
    // Each document is classified exactly once: database count + fallback rows = all rows.
    expect(aggregates.customers.total + aggregates.fallback.customers.length).toBe(DATES.length);
  });

  it('accepts only strings that new Date() parses to exactly that instant (fuzzed)', () => {
    // MongoDB's pattern uses \z; JS needs $ (no multiline) for the same end-of-input anchor.
    const pattern = new RegExp(CANONICAL_UTC.replace(/\\z$/, '$'));
    const rnd = random(11);
    const digit = () => String(Math.floor(rnd() * 10));
    const two = (max: number) => String(Math.floor(rnd() * max)).padStart(2, '0');
    let accepted = 0;
    for (let n = 0; n < 200_000; n += 1) {
      const year = n % 50 === 0 ? `${digit()}${digit()}${digit()}${digit()}` : `20${two(100)}`;
      const text = `${year}-${two(14)}-${two(33)}T${two(26)}:${two(62)}:${two(62)}.${digit()}${digit()}${digit()}Z`;
      if (!pattern.test(text)) continue;
      accepted += 1;
      const date = new Date(text);
      expect(Number.isFinite(date.valueOf()), text).toBe(true);
      expect(date.toISOString(), text).toBe(text);
    }
    expect(accepted).toBeGreaterThan(10_000);
    for (const text of [
      '2028-02-29T00:00:00.000Z',
      '2026-02-29T00:00:00.000Z',
      '2026-04-31T00:00:00.000Z',
      '2026-11-15T24:00:00.000Z',
      '2026-11-15T12:00:60.000Z',
      '2026-13-01T00:00:00.000Z',
      '2026-00-10T00:00:00.000Z',
      '2026-11-00T00:00:00.000Z',
    ])
      expect(pattern.test(text), text).toBe(false);
    // 200,000 generated strings: allow more than the 5 s default on a busy machine.
  }, 30_000);

  it('declines (null) when a normal sale id is not a string, so the full-row path is used', async () => {
    const sales = [{ id: 42 }] as Row[];
    const { from, to } = calendarWindow('month', NOW);
    await expect(
      globalAnalyticsAggregates(test.db, {
        sales,
        from,
        to,
        period: 'month',
        withPayments: true,
        withCommissions: true,
        fields: FIELDS,
      }),
    ).resolves.toBeNull();
  });
});
