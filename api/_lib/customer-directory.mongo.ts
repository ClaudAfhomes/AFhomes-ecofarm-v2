import { Decimal128, type Db, type Document } from 'mongodb';
import { addMoney } from '@afhomes/shared';
import { hashIdentifier, normalizeIdentifier } from './identifier.js';
import type { MongoRow } from './customer-activation.mongo.js';

const decimal = (value: unknown) => ({ $toDecimal: value });
const zero = Decimal128.fromString('0.00');
/** Placeholder join key that matches no payment (avoids null-key matching). */
const NO_PURCHASE = '__afhomes_no_purchase__';
const nonnull = (value: unknown, fallback: unknown) => ({ $ifNull: [value, fallback] });
const sum = (value: unknown) => nonnull({ $sum: value }, zero);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Display name; shared by the early search prefilter and the enriched row so both agree. */
const fullName = {
  $trim: {
    input: {
      $reduce: {
        input: ['$first_name', '$middle_name', '$last_name', '$suffix'],
        initialValue: '',
        in: {
          $concat: [
            '$$value',
            { $cond: [{ $eq: [nonnull('$$this', ''), ''] }, '', { $concat: [' ', '$$this'] }] },
          ],
        },
      },
    },
  },
};
/** Driver Decimal128 -> exact cents; no binary floating-point conversion. */
function money(value: unknown): string {
  const text = String(value ?? '0');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Invalid persisted money');
  return addMoney(text, '0.00');
}

type DirectoryGroup =
  | 'base'
  | 'member'
  | 'memberCategory'
  | 'points'
  | 'purchasesRaw'
  | 'prefilter'
  | 'purchases'
  | 'application'
  | 'sellerPlan'
  | 'plan'
  | 'category';
/** Original stage order; a group always runs after the groups it reads. */
const GROUP_ORDER: DirectoryGroup[] = [
  'base',
  'member',
  'memberCategory',
  'points',
  'purchasesRaw',
  'prefilter',
  'purchases',
  'application',
  'sellerPlan',
  'plan',
  'category',
];
/** Groups that only narrow or decide before paging; never run on the page. */
const PRE_PAGE_ONLY = new Set<DirectoryGroup>(['memberCategory', 'prefilter']);
/** Transitively closed: every group a group's expressions read. */
const GROUP_DEPENDENCIES: Record<DirectoryGroup, DirectoryGroup[]> = {
  base: [],
  member: [],
  memberCategory: ['member'],
  points: ['member'],
  purchasesRaw: [],
  // The prefilter's own needs (memberCategory, purchasesRaw) are added with its conditions.
  prefilter: [],
  purchases: ['purchasesRaw'],
  application: [],
  sellerPlan: ['member', 'purchasesRaw', 'application'],
  plan: ['sellerPlan', 'member', 'purchasesRaw', 'application'],
  category: ['member', 'purchases', 'purchasesRaw'],
};
/** derivedCategory values decided by its first four (status-only) branches. */
const MEMBER_CATEGORIES = new Set(['CANCELLED', 'SUSPENDED', 'EXPIRED', 'ACTIVE_VIP']);
/** derivedCategory values that require a non-zero verified payment, hence some purchase row. */
const PAID_CATEGORIES = new Set([
  'FULLY_PAID_AWAITING_ACTIVATION',
  'DOWN_PAYMENT_COMPLETED',
  'RESERVATION_PAID',
  'PARTIALLY_PAID',
]);

/**
 * Explicit own-property allowlist lookup: unsupported keys (including inherited names such as
 * toString or constructor) resolve to undefined, i.e. the default created_at/_id order.
 */
const ownValue = <T>(map: Record<string, T>, key: unknown): T | undefined =>
  Object.hasOwn(map, String(key)) ? map[String(key)] : undefined;

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
  // Equality joins (localField/foreignField) instead of correlated sub-pipelines: MongoDB runs
  // them far cheaper per customer. Per-purchase sums and the latest application are then derived
  // with array expressions that reproduce the former sub-pipeline semantics exactly.
  const join = (from: string, localField: string, foreignField: string, as: string) => ({
    $lookup: { from, localField, foreignField, as },
  });
  // A missing/empty localField would match every foreign row whose key is null or absent.
  const keys = (field: string) => ({
    $cond: [{ $gt: [{ $size: `$${field}` }, 0] }, `$${field}._id`, [NO_PURCHASE]],
  });
  /** Raw rows that count as purchases (shared by the full and the payment-free shapes). */
  const purchaseCond = (reservation: boolean) =>
    reservation
      ? {
          $and: [
            { $in: ['$$p.status', ['submitted', 'executed']] },
            { $eq: [nonnull('$$p.sale_id', null), null] },
          ],
        }
      : { $ne: ['$$p.status', 'cancelled'] };
  const sellerOf = (reservation: boolean) =>
    reservation ? '$$p.seller_staff_id' : nonnull('$$p.seller_staff_id', '$$p.seller_ost_id');
  /**
   * The latest purchase without payments: the same rows in the same order, sorted by the same
   * keys as `purchases`, so its plan_id / seller_id equal `$first: '$purchases'` (which no other
   * field reads). Tier and seller filters therefore skip the payment joins before paging.
   */
  const latestPurchase = {
    $first: {
      $sortArray: {
        input: {
          $concatArrays: [false, true].map((reservation) => ({
            $map: {
              input: {
                $filter: {
                  input: reservation ? '$reservations_raw' : '$sales_raw',
                  as: 'p',
                  cond: purchaseCond(reservation),
                },
              },
              as: 'p',
              in: {
                _id: '$$p._id',
                created_at: '$$p.created_at',
                plan_id: '$$p.plan_id',
                seller_id: sellerOf(reservation),
              },
            },
          })),
        },
        sortBy: { created_at: -1, _id: 1 },
      },
    },
  };
  const shape = (reservation: boolean, raw: string, payments: string, link: string): Document => ({
    $map: {
      input: {
        $filter: {
          input: `$${raw}`,
          as: 'p',
          cond: purchaseCond(reservation),
        },
      },
      as: 'p',
      in: {
        _id: '$$p._id',
        created_at: '$$p.created_at',
        plan_id: '$$p.plan_id',
        seller_id: sellerOf(reservation),
        total: decimal(reservation ? '$$p.total_price_snapshot' : '$$p.cash_price_snapshot'),
        reservation_fee: decimal('$$p.reservation_fee_snapshot'),
        required_initial: decimal('$$p.required_initial_snapshot'),
        paid: {
          $let: {
            vars: {
              verified: {
                $filter: {
                  input: `$${payments}`,
                  as: 'pay',
                  cond: {
                    $and: [{ $eq: ['$$pay.status', 'verified'] }, { $eq: [`$$pay.${link}`, '$$p._id'] }],
                  },
                },
              },
            },
            in: {
              $cond: [
                { $gt: [{ $size: '$$verified' }, 0] },
                { $sum: { $map: { input: '$$verified', as: 'v', in: decimal('$$v.amount') } } },
                zero,
              ],
            },
          },
        },
        is_reservation: { $literal: reservation },
      },
    },
  });
  /** derivedCategory branches in order; the first four read only customer and membership status. */
  const categoryBranches = [
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
  ];
  /** The status-only prefix of derivedCategory: one of its first four categories, else null. */
  const memberCategory = { $switch: { branches: categoryBranches.slice(0, 4), default: null } };
  // Enrichment in dependency groups (same expressions as before). Before paging, only the groups
  // a filter or sort needs run on every customer; the others run after $sort/$skip/$limit on the
  // visible page only. Everything stays one aggregate, so $$NOW and every row value are exactly
  // what full enrichment computes; only work on rows that are filtered out or off-page is skipped.
  const groups: Record<DirectoryGroup, Document[]> = {
    base: [{ $set: { full_name: fullName } }],
    member: [
      // The raw join array is kept as member_all: the points join reads member_all._id exactly as
      // the former single pipeline read member._id before $first.
      join('memberships', '_id', 'customer_id', 'member_all'),
      { $set: { member: { $first: '$member_all' } } },
      {
        $set: {
          member_status: '$member.status',
          membership_number: '$member.membership_number',
          activated_at: '$member.activated_at',
          expires_at: '$member.expires_at',
          memberships: '$member',
        },
      },
    ],
    points: [
      join('points_accounts', 'member_all._id', 'membership_id', 'points'),
      {
        $set: {
          points: {
            $first: {
              $filter: {
                input: '$points',
                cond: { $eq: [nonnull('$$this.membership_id', null), nonnull('$member._id', null)] },
              },
            },
          },
        },
      },
      {
        $set: {
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
        },
      },
    ],
    memberCategory: [{ $set: { memberCategory: memberCategory } }],
    purchasesRaw: [
      join('card_sales', '_id', 'customer_id', 'sales_raw'),
      join('reservation_agreements', '_id', 'customer_id', 'reservations_raw'),
      { $set: { latest: latestPurchase } },
    ],
    // Filled below from the active filters: exact supersets that drop customers no matching row
    // can come from, before the payment joins.
    prefilter: [],
    purchases: [
      { $set: { sale_keys: keys('sales_raw'), reservation_keys: keys('reservations_raw') } },
      join('payments', 'sale_keys', 'sale_id', 'sale_payments'),
      join('payments', 'reservation_keys', 'reservation_id', 'reservation_payments'),
      {
        $set: {
          sales: shape(false, 'sales_raw', 'sale_payments', 'sale_id'),
          reservations: shape(true, 'reservations_raw', 'reservation_payments', 'reservation_id'),
        },
      },
      {
        $unset: [
          'sales_raw', 'reservations_raw', 'sale_keys', 'reservation_keys',
          'sale_payments', 'reservation_payments',
        ],
      },
      {
        $set: {
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
          verified_paid: sum('$purchases.paid'),
          frozen_total: sum('$purchases.total'),
          reservation_fee: sum('$purchases.reservation_fee'),
          required_initial: sum('$purchases.required_initial'),
          open_reservation_total: sum('$reservations.total'),
          open_reservation_paid: sum('$reservations.paid'),
        },
      },
      {
        $set: {
          payment_status: {
            $switch: {
              branches: [
                { case: { $eq: ['$verified_paid', zero] }, then: 'no_payment' },
                { case: { $gte: ['$verified_paid', '$frozen_total'] }, then: 'fully_paid' },
              ],
              default: 'partially_paid',
            },
          },
        },
      },
    ],
    application: [
      join('customer_applications', '_id', 'customer_id', 'applications_raw'),
      {
        $set: {
          application: {
            $first: {
              $sortArray: {
                input: {
                  $filter: {
                    input: '$applications_raw',
                    cond: { $not: [{ $in: ['$$this.status', ['cancelled', 'rejected']] }] },
                  },
                },
                sortBy: { created_at: -1, _id: 1 },
              },
            },
          },
        },
      },
      { $unset: 'applications_raw' },
    ],
    sellerPlan: [
      {
        $set: {
          seller_id: nonnull('$latest.seller_id', '$application.referrer_staff_id'),
          plan_id: nonnull('$member.product_id', nonnull('$latest.plan_id', '$application.plan_id')),
        },
      },
    ],
    plan: [
      { $lookup: { from: 'card_plans', localField: 'plan_id', foreignField: '_id', as: 'plan' } },
      {
        $set: {
          tier: { $first: '$plan.code' },
        },
      },
    ],
    category: [
      { $set: { derivedCategory: { $switch: { branches: categoryBranches, default: 'PARTIALLY_PAID' } } } },
    ],
  };
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
  // A category decided by derivedCategory's status-only first branches matches on that prefix:
  // derivedCategory equals it exactly when the prefix does, so no purchase or payment join runs
  // before paging (page rows still get the full derivedCategory).
  const category = filters.category;
  const memberOnlyCategory = typeof category === 'string' && MEMBER_CATEGORIES.has(category);
  if (memberOnlyCategory) {
    delete derived.derivedCategory;
    derived.memberCategory = category;
  }
  // Exact supersets of the final match, applied before the payment joins: other categories need
  // an empty status-only prefix, and paid categories / paid payment statuses need a non-zero
  // verified payment, hence at least one sale or reservation row.
  const prefilters: Document[] = [];
  if (typeof category === 'string' && category && !memberOnlyCategory)
    prefilters.push({ memberCategory: null });
  if (
    (typeof category === 'string' && PAID_CATEGORIES.has(category)) ||
    filters.payment === 'fully_paid' ||
    filters.payment === 'partially_paid'
  )
    prefilters.push({
      $expr: {
        $or: [{ $gt: [{ $size: '$sales_raw' }, 0] }, { $gt: [{ $size: '$reservations_raw' }, 0] }],
      },
    });
  groups.prefilter = prefilters.length ? [{ $match: { $and: prefilters } }] : [];
  // Search candidates are narrowed before the expensive membership/purchase/payment lookups.
  // The prefilter is a superset of `derived.$or`, which still runs unchanged after enrichment,
  // so rows, order and totals are identical; enrichment just runs on far fewer customers.
  let searchPrefilter: Document | null = null;
  if (filters.search) {
    const needle = escapeRegex(String(filters.search));
    const fallbackHash = hashIdentifier(normalizeIdentifier(String(filters.search)));
    const qrHash = hashIdentifier(String(filters.search));
    const [aliases, cardOwners] = await Promise.all([
      db
        .collection<MongoRow>('business_id_aliases')
        .find(
          {
            entity_type: 'customer',
            is_active: true,
            old_identifier: {
              $regex: `^${escapeRegex(String(filters.search).trim())}$`,
              $options: 'i',
            },
          },
          { projection: { entity_id: 1 } },
        )
        .toArray(),
      // Superset of the late `member.*_hash` test (which checks the joined membership).
      db
        .collection<MongoRow>('memberships')
        .find(
          { $or: [{ fallback_code_hash: fallbackHash }, { qr_token_hash: qrHash }] },
          { projection: { customer_id: 1 } },
        )
        .toArray(),
    ]);
    derived.$or = ['full_name', 'customer_number', 'customer_code', 'ra_number', 'email'].map(
      (field) => ({ [field]: { $regex: needle, $options: 'i' } }),
    );
    derived.$or.push(
      { 'member.fallback_code_hash': fallbackHash },
      { 'member.qr_token_hash': qrHash },
      { _id: { $in: aliases.map((row) => row.entity_id) } },
    );
    searchPrefilter = {
      $or: [
        ...['customer_number', 'customer_code', 'ra_number', 'email'].map((field) => ({
          [field]: { $regex: needle, $options: 'i' },
        })),
        { $expr: { $regexMatch: { input: fullName, regex: needle, options: 'i' } } },
        {
          _id: {
            $in: [
              ...aliases.map((row) => row.entity_id),
              ...cardOwners.map((row) => row.customer_id),
            ],
          },
        },
      ],
    };
  }
  const sort: Document = filters.sort === 'verified_paid' ? { verified_paid: -1 } : {};
  const field = ownValue(
    {
      name: 'full_name',
      tier: 'tier',
      category: 'derivedCategory',
      payment_status: 'payment_status',
      membership_status: 'member_status',
    } as Record<string, string>,
    filters.sort,
  );
  if (field) sort.sort_value = 1;
  Object.assign(sort, { created_at: -1, _id: 1 });
  // Groups each filter / sort reads before paging (closed over GROUP_DEPENDENCIES below).
  const needed = new Set<DirectoryGroup>();
  if (filters.search) needed.add('base').add('member');
  if (filters.membersOnly) needed.add('member');
  if (filters.activeVipOnly) needed.add('member').add('plan');
  if (filters.category) needed.add(memberOnlyCategory ? 'memberCategory' : 'category');
  if (prefilters.some((condition) => 'memberCategory' in condition)) needed.add('memberCategory');
  if (prefilters.some((condition) => '$expr' in condition)) needed.add('purchasesRaw');
  if (prefilters.length) needed.add('prefilter');
  if (filters.tier) needed.add('plan');
  if (filters.seller) needed.add('sellerPlan');
  if (filters.payment) needed.add('purchases');
  const sortGroup = ownValue(
    {
      verified_paid: 'purchases',
      name: 'base',
      tier: 'plan',
      category: 'category',
      payment_status: 'purchases',
      membership_status: 'member',
    } as Record<string, DirectoryGroup>,
    filters.sort,
  );
  if (sortGroup) needed.add(sortGroup);
  for (const group of [...needed])
    for (const dependency of GROUP_DEPENDENCIES[group]) needed.add(dependency);
  // Joins keyed only on stored fields go first and back to back (as in the former single pipeline),
  // which lets MongoDB fold them into the initial cursor; the remaining stages keep group order.
  const rawJoin = (stage: Document) =>
    !!stage.$lookup && ['_id', 'member_all._id'].includes(stage.$lookup.localField);
  const emit = (selected: DirectoryGroup[]) => [
    ...selected.flatMap((group) => groups[group].filter(rawJoin)),
    ...selected.flatMap((group) => groups[group].filter((stage) => !rawJoin(stage))),
  ];
  const before = emit(GROUP_ORDER.filter((group) => needed.has(group))),
    after = emit(GROUP_ORDER.filter((group) => !needed.has(group) && !PRE_PAGE_ONLY.has(group)));
  const query: Document[] = [
    { $match: match },
    ...(searchPrefilter ? [{ $match: searchPrefilter }] : []),
    ...before,
    ...(Object.keys(derived).length ? [{ $match: derived }] : []),
    ...(field ? [{ $set: { sort_value: { $toLower: nonnull(`$${field}`, '') } } }] : []),
  ];
  const projection = {
    $unset: [
      'sales', 'reservations', 'purchases', 'latest', 'application',
      'plan', 'points', 'member', 'member_all', 'sort_value', 'memberCategory',
    ],
  };
  query.push({
    $facet: {
      count: [{ $count: 'total' }],
      rows: [
        { $sort: sort },
        { $skip: Number(filters.offset ?? 0) },
        { $limit: Number(filters.limit ?? 50) },
        ...after,
        projection,
      ],
    },
  });
  const [result] = await db
    .collection('customers')
    .aggregate<{ count: { total: number }[]; rows: MongoRow[] }>(query)
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
