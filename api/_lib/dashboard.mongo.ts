import type { Db, Document } from 'mongodb';
import { afHomesDashboardSchema } from '@afhomes/contracts';

/**
 * Same business figures as `projectDashboard` (the source projection, still used by the
 * Supabase path and pinned against this one in tests), computed inside MongoDB:
 * totals stay all-time, the trend keeps the projection's UTC-day cutoff, and only
 * grouped counts/sums leave the database instead of every source document.
 */
const VERIFIED_SALE_STATUSES = ['payment_verified', 'final_qualification_pending', 'qualified', 'activated'];
const DAYS_BY_RANGE: Record<string, number> = { today: 1, week: 7, month: 31, year: 366 };
/** Exactly the money strings the projection's cents() accepts; anything else counts as 0. */
const MONEY_PATTERN = '^\\d+(?:\\.\\d{1,2})?$';

const amountText = (field: string) => ({ $toString: { $ifNull: [`$${field}`, '0'] } });
const validMoney = (field: string) => ({
  $cond: [
    { $regexMatch: { input: amountText(field), regex: MONEY_PATTERN } },
    { $toDecimal: amountText(field) },
    { $toDecimal: '0' },
  ],
});
const asDate = (field: string) => ({ $convert: { input: `$${field}`, to: 'date', onError: null, onNull: null } });
const byStatus = [{ $group: { _id: '$status', n: { $sum: 1 } } }];
/** Daily UTC buckets from `cutoff`, matching the projection's `toISOString().slice(0, 10)`. */
const daily = (dateField: string, cutoff: Date, extra: Document = {}) => [
  { $set: { _day: asDate(dateField) } },
  { $match: { _day: { $gte: cutoff } } },
  { $group: { _id: { $dateToString: { date: '$_day', format: '%Y-%m-%d', timezone: 'UTC' } }, n: { $sum: 1 }, ...extra } },
];

/** Decimal128 sum of 0-2dp addends -> the projection's `N.NN` text, without floating point. */
function centsText(value: unknown): string {
  const text = String(value ?? '0');
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Unexpected aggregated money value');
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
const counts = (rows: { _id: unknown; n: number }[]) => {
  const map = new Map(rows.map((row) => [row._id, row.n]));
  return {
    of: (...statuses: string[]) => statuses.reduce((sum, status) => sum + (map.get(status) ?? 0), 0),
    all: rows.reduce((sum, row) => sum + row.n, 0),
  };
};

export async function mongoDashboard(db: Db, range: string) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (DAYS_BY_RANGE[range] ?? DAYS_BY_RANGE.month!) + 1);
  cutoff.setUTCHours(0, 0, 0, 0);
  const facet = async (name: string, stages: Record<string, Document[]>) =>
    (await db.collection(name).aggregate<Record<string, Document[]>>([{ $facet: stages }]).toArray())[0]!;
  const [sales, payments, memberships, qualifications, commissions, ost, ostApplications, staff] =
    await Promise.all([
      facet('card_sales', {
        status: byStatus,
        trend: [{ $match: { status: { $in: VERIFIED_SALE_STATUSES } } }, ...daily('created_at', cutoff)],
      }),
      facet('payments', {
        status: byStatus,
        verified: [{ $match: { status: 'verified' } }, { $group: { _id: null, total: { $sum: validMoney('amount') } } }],
        trend: [{ $match: { status: 'verified' } }, ...daily('verified_at', cutoff, { total: { $sum: validMoney('amount') } })],
      }),
      facet('memberships', {
        status: byStatus,
        points: [{ $group: { _id: null, total: { $sum: { $convert: { input: { $ifNull: ['$points_balance', 0] }, to: 'double', onError: null } } } } }],
        trend: [{ $match: { status: 'active' } }, ...daily('activated_at', cutoff)],
      }),
      facet('final_qualifications', { status: byStatus }),
      facet('commissions', {
        status: byStatus,
        earned: [{ $match: { status: 'earned' } }, { $group: { _id: null, total: { $sum: validMoney('amount') } } }],
      }),
      facet('ost_members', { status: byStatus }),
      facet('ost_applications', { status: byStatus }),
      facet('staff_users', { status: byStatus }),
    ]);
  const sale = counts(sales.status as never),
    payment = counts(payments.status as never),
    membership = counts(memberships.status as never),
    seller = counts(ost.status as never),
    employee = counts(staff.status as never);
  const trend = new Map<string, { period: string; verifiedSales: number; collections: string; activatedCards: number; pointsRedeemed: number }>();
  const point = (period: string) => {
    let entry = trend.get(period);
    if (!entry) trend.set(period, (entry = { period, verifiedSales: 0, collections: '0.00', activatedCards: 0, pointsRedeemed: 0 }));
    return entry;
  };
  for (const row of sales.trend as { _id: string; n: number }[]) point(row._id).verifiedSales = row.n;
  for (const row of payments.trend as { _id: string; total: unknown }[]) point(row._id).collections = centsText(row.total);
  for (const row of memberships.trend as { _id: string; n: number }[]) point(row._id).activatedCards = row.n;
  return afHomesDashboardSchema.parse({
    totals: {
      verifiedSales: sale.of(...VERIFIED_SALE_STATUSES),
      verifiedCollections: centsText(payments.verified[0]?.total ?? '0'),
      activeMemberships: membership.of('active'),
      pendingAccounts: sale.of('pending'),
      downPaymentAccounts: sale.of('down_payment'),
      overdueAccounts: sale.of('overdue'),
      pointsIssued: Number(memberships.points[0]?.total ?? 0),
      pointsRedeemed: 0,
      pendingQualifications: counts(qualifications.status as never).of('pending'),
      earnedUnpaidCommissions: centsText(commissions.earned[0]?.total ?? '0'),
      activeSellers: seller.of('active'),
      inactiveSellers: seller.all - seller.of('active'),
      activeEmployees: employee.of('active'),
      inactiveEmployees: employee.all - employee.of('active'),
    },
    queues: {
      paymentVerification: payment.of('recorded'),
      cardActivation: sale.of('qualified'),
      finalQualification: sale.of('final_qualification_pending'),
      ostRegistrations: counts(ostApplications.status as never).of('submitted', 'under_review'),
      commissionPayouts: counts(commissions.status as never).of('earned'),
    },
    trend: [...trend.values()].sort((a, b) => a.period.localeCompare(b.period)),
  });
}
