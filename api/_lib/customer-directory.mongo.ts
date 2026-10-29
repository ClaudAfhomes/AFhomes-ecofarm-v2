import { Decimal128, type Db, type Document } from 'mongodb';
import { addMoney } from '@afhomes/shared';
import { hashIdentifier, normalizeIdentifier } from './identifier.js';
import type { MongoRow } from './customer-activation.mongo.js';

const decimal = (value: unknown) => ({ $toDecimal: value });
const zero = Decimal128.fromString('0.00');
const nonnull = (value: unknown, fallback: unknown) => ({ $ifNull: [value, fallback] });
const sum = (value: unknown) => nonnull({ $sum: value }, zero);
/** Driver Decimal128 -> exact cents; no binary floating-point conversion. */
function money(value: unknown): string {
  const text = String(value ?? '0');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid persisted money');
  return addMoney(text, '0.00');
}

/** Source customer_directory latest purchase/reservation semantics, paged in MongoDB. */
export async function mongoCustomerDirectory(db: Db, filters: Record<string, unknown>) {
  const match: Document = {};
  if (filters.id) match._id = filters.id;
  for (const [input, field] of [
    ['status', 'status'],
    ['companyStatus', 'company_status'],
  ])
    if (filters[input]) match[field] = filters[input];
  if (filters.from || filters.to) {
    match.created_at = {};
    if (filters.from) match.created_at.$gte = `${filters.from}T00:00:00.000Z`;
    if (filters.to)
      match.created_at.$lt = new Date(Date.parse(String(filters.to)) + 86_400_000).toISOString();
  }
  const purchase = (reservation: boolean): Document[] => [
    {
      $match: {
        $expr: { $eq: ['$customer_id', '$$customer'] },
        ...(reservation
          ? { status: { $in: ['submitted', 'executed'] }, sale_id: null }
          : { status: { $ne: 'cancelled' } }),
      },
    },
    {
      $lookup: {
        from: 'payments',
        let: { purchase: '$_id' },
        pipeline: [
          {
            $match: {
              status: 'verified',
              $expr: { $eq: [reservation ? '$reservation_id' : '$sale_id', '$$purchase'] },
            },
          },
          { $group: { _id: null, paid: { $sum: decimal('$amount') } } },
        ],
        as: 'pay',
      },
    },
    {
      $project: {
        _id: 1,
        created_at: 1,
        plan_id: 1,
        seller_id: reservation ? '$seller_staff_id' : nonnull('$seller_staff_id', '$seller_ost_id'),
        total: decimal(reservation ? '$total_price_snapshot' : '$cash_price_snapshot'),
        reservation_fee: decimal('$reservation_fee_snapshot'),
        required_initial: decimal('$required_initial_snapshot'),
        paid: nonnull({ $first: '$pay.paid' }, zero),
        is_reservation: { $literal: reservation },
      },
    },
  ];
  const pipeline: Document[] = [
    { $match: match },
    {
      $lookup: {
        from: 'memberships',
        localField: '_id',
        foreignField: 'customer_id',
        as: 'member',
      },
    },
    { $set: { member: { $first: '$member' } } },
    {
      $lookup: {
        from: 'points_accounts',
        localField: 'member._id',
        foreignField: 'membership_id',
        as: 'points',
      },
    },
    { $set: { points: { $first: '$points' } } },
    {
      $lookup: {
        from: 'card_sales',
        let: { customer: '$_id' },
        pipeline: purchase(false),
        as: 'sales',
      },
    },
    {
      $lookup: {
        from: 'reservation_agreements',
        let: { customer: '$_id' },
        pipeline: purchase(true),
        as: 'reservations',
      },
    },
    {
      $lookup: {
        from: 'customer_applications',
        let: { customer: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$customer_id', '$$customer'] },
              status: { $nin: ['cancelled', 'rejected'] },
            },
          },
          { $sort: { created_at: -1, _id: 1 } },
          { $limit: 1 },
        ],
        as: 'application',
      },
    },
    {
      $set: {
        application: { $first: '$application' },
        purchases: {
          $sortArray: {
            input: { $concatArrays: ['$sales', '$reservations'] },
            sortBy: { created_at: -1, _id: 1 },
          },
        },
      },
    },
    {
      $set: {
        latest: { $first: '$purchases' },
        verified_paid: sum('$purchases.paid'),
        frozen_total: sum('$purchases.total'),
        reservation_fee: sum('$purchases.reservation_fee'),
        required_initial: sum('$purchases.required_initial'),
        open_reservation_total: sum('$reservations.total'),
        open_reservation_paid: sum('$reservations.paid'),
        member_status: '$member.status',
        membership_number: '$member.membership_number',
        activated_at: '$member.activated_at',
        available_points: nonnull('$points.balance', 0),
        weekday_available_points: {
          $max: [
            0,
            { $min: [nonnull('$points.weekday_balance', 0), nonnull('$points.balance', 0)] },
          ],
        },
        weekend_available_points: {
          $max: [
            0,
            { $min: [nonnull('$points.weekend_balance', 0), nonnull('$points.balance', 0)] },
          ],
        },
        expires_at: '$member.expires_at',
        memberships: '$member',
        full_name: {
          $trim: {
            input: {
              $reduce: {
                input: ['$first_name', '$middle_name', '$last_name', '$suffix'],
                initialValue: '',
                in: {
                  $concat: [
                    '$$value',
                    {
                      $cond: [
                        { $eq: [nonnull('$$this', ''), ''] },
                        '',
                        { $concat: [' ', '$$this'] },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    {
      $set: {
        seller_id: nonnull('$latest.seller_id', '$application.referrer_staff_id'),
        plan_id: nonnull('$member.product_id', nonnull('$latest.plan_id', '$application.plan_id')),
      },
    },
    { $lookup: { from: 'card_plans', localField: 'plan_id', foreignField: '_id', as: 'plan' } },
    {
      $set: {
        tier: { $first: '$plan.code' },
        payment_status: {
          $switch: {
            branches: [
              { case: { $eq: ['$verified_paid', zero] }, then: 'no_payment' },
              { case: { $gte: ['$verified_paid', '$frozen_total'] }, then: 'fully_paid' },
            ],
            default: 'partially_paid',
          },
        },
        derivedCategory: {
          $switch: {
            branches: [
              {
                case: {
                  $or: [
                    { $eq: ['$status', 'cancelled'] },
                    { $eq: ['$member.status', 'cancelled'] },
                  ],
                },
                then: 'CANCELLED',
              },
              {
                case: {
                  $or: [
                    { $eq: ['$status', 'suspended'] },
                    { $eq: ['$member.status', 'suspended'] },
                  ],
                },
                then: 'SUSPENDED',
              },
              {
                case: {
                  $or: [
                    { $eq: ['$member.status', 'expired'] },
                    {
                      $and: [
                        { $eq: ['$member.status', 'active'] },
                        { $ne: [nonnull('$member.expires_at', null), null] },
                        { $lte: [{ $toDate: '$member.expires_at' }, '$$NOW'] },
                      ],
                    },
                  ],
                },
                then: 'EXPIRED',
              },
              { case: { $eq: ['$member.status', 'active'] }, then: 'ACTIVE_VIP' },
              {
                case: { $eq: ['$verified_paid', zero] },
                then: { $cond: [{ $eq: ['$status', 'prospect'] }, 'PENDING', 'ACTIVE'] },
              },
              {
                case: { $gte: ['$verified_paid', '$frozen_total'] },
                then: 'FULLY_PAID_AWAITING_ACTIVATION',
              },
              {
                case: {
                  $and: [
                    { $gt: ['$required_initial', '$reservation_fee'] },
                    { $gte: ['$verified_paid', '$required_initial'] },
                  ],
                },
                then: 'DOWN_PAYMENT_COMPLETED',
              },
              {
                case: {
                  $and: [
                    { $gt: ['$reservation_fee', zero] },
                    { $gte: ['$verified_paid', '$reservation_fee'] },
                  ],
                },
                then: 'RESERVATION_PAID',
              },
            ],
            default: 'PARTIALLY_PAID',
          },
        },
      },
    },
  ];
  const derived: Document = {};
  if (filters.membersOnly) derived['member._id'] = { $exists: true };
  if (filters.activeVipOnly) {
    Object.assign(derived, {
      status: 'active',
      'member._id': { $exists: true },
      member_status: 'active',
      tier: { $in: ['BRONZE', 'SILVER', 'GOLD'] },
      $expr: {
        $gt: [
          { $convert: { input: '$expires_at', to: 'date', onNull: null, onError: null } },
          '$$NOW',
        ],
      },
    });
  }
  for (const [key, field] of [
    ['category', 'derivedCategory'],
    ['tier', 'tier'],
    ['seller', 'seller_id'],
    ['payment', 'payment_status'],
  ])
    if (filters[key]) derived[field] = filters[key];
  if (filters.search) {
    const needle = String(filters.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aliases = await db
      .collection<MongoRow>('business_id_aliases')
      .find(
        {
          entity_type: 'customer',
          is_active: true,
          old_identifier: {
            $regex: `^${String(filters.search)
              .trim()
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            $options: 'i',
          },
        },
        { projection: { entity_id: 1 } },
      )
      .toArray();
    derived.$or = ['full_name', 'customer_number', 'customer_code', 'ra_number', 'email'].map(
      (field) => ({ [field]: { $regex: needle, $options: 'i' } }),
    );
    derived.$or.push(
      { 'member.fallback_code_hash': hashIdentifier(normalizeIdentifier(String(filters.search))) },
      { 'member.qr_token_hash': hashIdentifier(String(filters.search)) },
      { _id: { $in: aliases.map((row) => row.entity_id) } },
    );
  }
  pipeline.push({ $match: derived });
  const sort: Document = filters.sort === 'verified_paid' ? { verified_paid: -1 } : {};
  const field = (
    {
      name: 'full_name',
      tier: 'tier',
      category: 'derivedCategory',
      payment_status: 'payment_status',
      membership_status: 'member_status',
    } as Record<string, string>
  )[String(filters.sort)];
  if (field) {
    pipeline.push({ $set: { sort_value: { $toLower: nonnull(`$${field}`, '') } } });
    sort.sort_value = 1;
  }
  Object.assign(sort, { created_at: -1, _id: 1 });
  pipeline.push({
    $facet: {
      count: [{ $count: 'total' }],
      rows: [
        { $sort: sort },
        { $skip: Number(filters.offset ?? 0) },
        { $limit: Number(filters.limit ?? 50) },
        {
          $unset: [
            'sales',
            'reservations',
            'purchases',
            'latest',
            'application',
            'plan',
            'points',
            'member',
            'sort_value',
          ],
        },
      ],
    },
  });
  const [result] = await db
    .collection('customers')
    .aggregate<{ count: { total: number }[]; rows: MongoRow[] }>(pipeline)
    .toArray();
  return {
    total: result?.count[0]?.total ?? 0,
    rows: (result?.rows ?? []).map((row) => ({
      ...row,
      id: row._id,
      verified_paid: money(row.verified_paid),
      frozen_total: money(row.frozen_total),
      open_reservation_total: money(row.open_reservation_total),
      open_reservation_paid: money(row.open_reservation_paid),
    })),
  };
}
