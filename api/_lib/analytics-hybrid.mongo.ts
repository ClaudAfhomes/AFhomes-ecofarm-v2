import type { Db, Document } from 'mongodb';
import type { AnalyticsPeriod } from '@afhomes/contracts';
import { decimalCents, type Row } from './analytics-projection.js';

/**
 * Hybrid database-side aggregation for the global/finance analytics overview.
 *
 * Each collection is read once (one aggregate, one `$facet`, so every document is classified
 * exactly once). A row is aggregated in MongoDB only when every value the JS projection would
 * read from it has a form whose result is provably identical:
 * - dates: absent (null/missing: JS treats them as invalid) or a canonical UTC string
 *   `YYYY-MM-DDTHH:mm:ss.sssZ` naming a real calendar instant (29 February excluded), which
 *   `new Date()` parses to exactly that instant and whose `toISOString()` is the stored text.
 *   Such fixed-width strings sort chronologically, so windows are plain string comparisons and
 *   buckets are prefixes - no date parsing in MongoDB (`analytics-hybrid.mongo.spec.ts` fuzzes
 *   the pattern against `new Date()`);
 * - money: absent (JS reads `'0'`), a string of 1-20 digits with 0-2 decimals (exact in
 *   Decimal128), or a string `decimalCents` ignores;
 * - sale references: strings (JS compares `String(sale_id)`).
 * Every other row is returned untouched and processed by the existing `projectAnalytics`; the
 * partial results are then added exactly. Reporting stays UTC; stored dates are never changed.
 */
export const CANONICAL_UTC =
  '^[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))' +
  'T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z\\z';
const MONEY_DB = '^[0-9]{1,20}(\\.[0-9]{1,2})?\\z';
const MONEY_JS = '^[0-9]+(\\.[0-9]{1,2})?\\z';
const COMMISSION_STATUSES = [
  'pending',
  'payment_verified',
  'final_qualification_pending',
  'earned',
  'paid',
  'cancelled',
] as const;

const typeOf = (field: string) => ({ $type: field });
/** 'absent' | 'strict' | 'other' */
function dateClass(field: string) {
  return {
    $cond: [
      { $in: [typeOf(field), ['missing', 'null']] },
      'absent',
      {
        $cond: [
          { $eq: [typeOf(field), 'string'] },
          { $cond: [{ $regexMatch: { input: field, regex: CANONICAL_UTC } }, 'strict', 'other'] },
          'other',
        ],
      },
    ],
  };
}
/** 'zero' (contributes nothing in JS) | 'db' (exact decimal) | 'other' */
function moneyClass(field: string) {
  return {
    $cond: [
      { $in: [typeOf(field), ['missing', 'null']] },
      'zero',
      {
        $cond: [
          { $ne: [typeOf(field), 'string'] },
          'other',
          {
            $cond: [
              { $regexMatch: { input: field, regex: MONEY_DB } },
              'db',
              { $cond: [{ $regexMatch: { input: field, regex: MONEY_JS } }, 'other', 'zero'] },
            ],
          },
        ],
      },
    ],
  };
}
/**  for canonical strings: fixed-width UTC text compares in time order. */
const inWindow = (field: string, classField: string, from: string, to: string) => ({
  $cond: [
    { $eq: [classField, 'strict'] },
    { $and: [{ $gte: [field, from] }, { $lt: [field, to] }] },
    false,
  ],
});
/** Same text `bucketKey(new Date(value), period)` produces for a canonical UTC string. */
function bucket(field: string, period: AnalyticsPeriod) {
  if (period === 'day') return { $concat: [{ $substrCP: [field, 0, 13] }, ':00'] };
  return { $substrCP: [field, 0, period === 'year' ? 7 : 10] };
}
const project = (fields: string[]) =>
  Object.fromEntries([['_id', 1], ...fields.map((field) => [field, 1])]);
const asRows = (docs: Document[]): Row[] => docs.map((row) => ({ ...row, id: row._id }));
/** Keeps each command far below the 16 MB limit; larger sale sets use the full-row path. */
const MAX_SALE_IDS = 100_000;
/** Decimal128/int sum -> 'N.NN' text accepted by decimalCents; null when not provably exact. */
function money(value: unknown) {
  const text = String(value ?? '0');
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? text : null;
}

export interface HybridAggregates {
  fallback: { customers: Row[]; payments: Row[]; memberships: Row[]; commissions: Row[] };
  customers: { total: number; inWindow: number };
  payments: { recorded: number; rejected: number; total: string };
  memberships: { active: number };
  commissions: Record<string, number>;
  buckets: Map<string, { verifiedPayments: string[]; activations: number }>;
}

/**
 * Returns null when the global sale set cannot be matched exactly in MongoDB (a non-string sale
 * id, or too many ids for one command) or any partial result is not provably exact; callers then
 * use the existing full-row path.
 */
export async function globalAnalyticsAggregates(
  db: Db,
  options: {
    sales: Row[];
    from: Date;
    to: Date;
    period: AnalyticsPeriod;
    withPayments: boolean;
    withCommissions: boolean;
    fields: Record<string, string[]>;
  },
): Promise<HybridAggregates | null> {
  const { period, fields } = options;
  // Window bounds as the same fixed-width text (years 0000-9999); otherwise not comparable.
  const from = options.from.toISOString(),
    to = options.to.toISOString();
  if (![from, to].every((text) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)))
    return null;
  if (options.sales.some((sale) => typeof sale.id !== 'string')) return null;
  if (options.sales.length > MAX_SALE_IDS) return null;
  // Exactly the set projectAnalytics uses (String(sale.id) of the same sales). Only rows whose
  // sale_id is a string reach these matches, so array/number semantics never apply.
  const saleIds = options.sales.map((sale) => sale.id as string);
  const run = async (collection: string, pipeline: Document[]) =>
    (await db.collection(collection).aggregate(pipeline).toArray())[0] as Document;
  const [customers, payments, memberships, commissions] = await Promise.all([
    run('customers', [
      { $project: { ...project(fields.customers!), _dc: dateClass('$created_at') } },
      {
        $facet: {
          db: [
            { $match: { _dc: { $ne: 'other' } } },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                inWindow: { $sum: { $cond: [inWindow('$created_at', '$_dc', from, to), 1, 0] } },
              },
            },
          ],
          fallback: [{ $match: { _dc: 'other' } }, { $project: { _dc: 0 } }],
        },
      },
    ]),
    options.withPayments
      ? run('payments', [
          { $project: project(fields.payments!) },
          { $set: { _dc: dateClass('$verified_at'), _mc: moneyClass('$amount') } },
          {
            $set: {
              _handled: {
                $and: [
                  { $eq: [typeOf('$sale_id'), 'string'] },
                  { $ne: ['$_dc', 'other'] },
                  { $ne: ['$_mc', 'other'] },
                ],
              },
            },
          },
          {
            $facet: {
              // One group: status counts over all included rows; key null unless the row is a
              // verified payment inside the window (then its trend bucket).
              handled: [
                { $match: { _handled: true, sale_id: { $in: saleIds } } },
                {
                  $group: {
                    _id: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ['$status', 'verified'] },
                            inWindow('$verified_at', '$_dc', from, to),
                          ],
                        },
                        bucket('$verified_at', period),
                        null,
                      ],
                    },
                    recorded: { $sum: { $cond: [{ $eq: ['$status', 'recorded'] }, 1, 0] } },
                    rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
                    sum: {
                      $sum: { $cond: [{ $eq: ['$_mc', 'db'] }, { $toDecimal: '$amount' }, 0] },
                    },
                  },
                },
              ],
              fallback: [
                { $match: { _handled: false } },
                { $project: { _dc: 0, _mc: 0, _handled: 0 } },
              ],
            },
          },
        ])
      : null,
    run('memberships', [
      { $project: { ...project(fields.memberships!), _dc: dateClass('$activated_at') } },
      {
        $facet: {
          counts: [
            { $match: { _dc: { $ne: 'other' } } },
            {
              $group: {
                _id: null,
                active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
              },
            },
          ],
          buckets: [
            { $match: { _dc: 'strict' } },
            { $match: { $expr: inWindow('$activated_at', '$_dc', from, to) } },
            { $group: { _id: bucket('$activated_at', period), n: { $sum: 1 } } },
          ],
          fallback: [{ $match: { _dc: 'other' } }, { $project: { _dc: 0 } }],
        },
      },
    ]),
    options.withCommissions
      ? run('commissions', [
          { $project: project(fields.commissions!) },
          { $set: { _handled: { $eq: [typeOf('$sale_id'), 'string'] } } },
          {
            $facet: {
              counts: [
                {
                  $match: {
                    _handled: true,
                    sale_id: { $in: saleIds },
                    $expr: {
                      $and: [
                        { $ne: ['$settled_before_system', true] },
                        { $eq: [typeOf('$status'), 'string'] },
                      ],
                    },
                  },
                },
                { $group: { _id: '$status', n: { $sum: 1 } } },
              ],
              fallback: [{ $match: { _handled: false } }, { $project: { _handled: 0 } }],
            },
          },
        ])
      : null,
  ]);

  const buckets = new Map<string, { verifiedPayments: string[]; activations: number }>();
  const slot = (key: string) => {
    const existing = buckets.get(key) ?? { verifiedPayments: [], activations: 0 };
    buckets.set(key, existing);
    return existing;
  };
  const paymentTotals: string[] = [];
  let recorded = 0,
    rejected = 0;
  for (const row of (payments?.handled ?? []) as Document[]) {
    recorded += Number(row.recorded);
    rejected += Number(row.rejected);
    if (row._id === null) continue;
    const sum = money(row.sum);
    if (sum === null) return null;
    slot(String(row._id)).verifiedPayments.push(sum);
    paymentTotals.push(sum);
  }
  for (const row of (memberships.buckets ?? []) as Document[])
    slot(String(row._id)).activations += Number(row.n);
  const commissionCounts = Object.fromEntries(COMMISSION_STATUSES.map((status) => [status, 0]));
  for (const row of (commissions?.counts ?? []) as Document[])
    if (Object.hasOwn(commissionCounts, row._id)) commissionCounts[row._id] += Number(row.n);
  return {
    fallback: {
      customers: asRows(customers.fallback),
      payments: asRows(payments?.fallback ?? []),
      memberships: asRows(memberships.fallback),
      commissions: asRows(commissions?.fallback ?? []),
    },
    customers: {
      total: Number(customers.db[0]?.total ?? 0),
      inWindow: Number(customers.db[0]?.inWindow ?? 0),
    },
    payments: {
      recorded,
      rejected,
      total: decimalCents(paymentTotals),
    },
    memberships: { active: Number(memberships.counts[0]?.active ?? 0) },
    commissions: commissionCounts,
    buckets,
  };
}

type Overview = ReturnType<typeof import('./analytics-projection.js').projectAnalytics>;
/** Adds the database partial results to `projectAnalytics` output computed from fallback rows. */
export function mergeAnalyticsAggregates(output: Overview, aggregates: HybridAggregates): Overview {
  const trends = new Map(output.trends.map((item) => [item.period, { ...item }]));
  for (const [key, value] of aggregates.buckets) {
    const item = trends.get(key) ?? {
      period: key,
      sales: 0,
      saleValue: decimalCents([]),
      verifiedPayments: decimalCents([]),
      activations: 0,
      redemptions: 0,
      pointsRedeemed: 0,
    };
    item.verifiedPayments = decimalCents([item.verifiedPayments, ...value.verifiedPayments]);
    item.activations += value.activations;
    trends.set(key, item);
  }
  return {
    ...output,
    headline: {
      ...output.headline,
      totalCustomers: output.headline.totalCustomers + aggregates.customers.total,
      newCustomers: output.headline.newCustomers + aggregates.customers.inWindow,
      periodVerifiedPayments: decimalCents([
        output.headline.periodVerifiedPayments,
        aggregates.payments.total,
      ]),
      activatedMemberships: output.headline.activatedMemberships + aggregates.memberships.active,
    },
    queues: {
      ...output.queues,
      pendingPaymentVerification:
        output.queues.pendingPaymentVerification + aggregates.payments.recorded,
      rejectedPayments: output.queues.rejectedPayments + aggregates.payments.rejected,
    },
    commissions: output.commissions
      ? Object.fromEntries(
          Object.entries(output.commissions).map(([status, count]) => [
            status,
            count + (aggregates.commissions[status] ?? 0),
          ]),
        )
      : output.commissions,
    trends: [...trends.values()].sort((a, b) => a.period.localeCompare(b.period)),
  };
}
