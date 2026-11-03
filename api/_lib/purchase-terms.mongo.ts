import type { ClientSession, Db as MongoDb } from 'mongodb';
import type { PaymentScheme } from '@afhomes/contracts';
import { addMoney, compareMoney } from '@afhomes/shared';
import type { MongoRow } from './customer-activation.mongo.js';
import { PLAN_BENEFIT_DEFAULTS } from './catalog-model.js';
import { calculateCommission, resolveSchemeEconomics } from './commerce.js';
import { isoOrNull } from './handler-kit.mongo.js';
export async function getStaffRoleSlug(
  db: MongoDb,
  staffId: string,
  session?: ClientSession,
): Promise<string | null> {
  const col = (name: string) => db.collection<MongoRow>(name);
  const assignment = await col('staff_role_assignments').findOne(
    { staff_id: staffId },
    { session },
  );
  if (!assignment) return null;
  const role = await col('roles').findOne({ _id: String(assignment.role_id) }, { session });
  return (role?.slug as string) ?? null;
}

export interface PurchaseTerms {
  applicationId: string;
  customerId: string;
  planId: string;
  sellerStaffId: string;
  version: number;
  captureKind: 'submission' | 'review';
  reason: string | null;
  tier: string;
  paymentScheme: string;
  totalPrice: string;
  reservationFee: string;
  minimumDownPayment: string;
  requiredInitial: string;
  installmentMonths: number | null;
  monthlyAmount: string | null;
  spotCashDays: number;
  validityMonths: number;
  discountPercent: number;
  yearlyPoints: number;
  annualPointsTranches: number;
  holderLimit: number;
  inclusions: string[];
  commissionRuleId: string | null;
  commissionRate: string;
  commissionBase: string;
  expectedCommission: string;
}

export async function purchaseTermsForApplication(
  db: MongoDb,
  applicationId: string,
  sellerId: string,
  captureKind: 'submission' | 'review',
  session?: ClientSession,
): Promise<PurchaseTerms> {
  const col = (name: string) => db.collection<MongoRow>(name);
  const app = await col('customer_applications').findOne({ _id: applicationId }, { session });
  if (!app) throw new Error('APPLICATION_NOT_FOUND');
  const customer = await col('customers').findOne({ _id: String(app.customer_id) }, { session });
  if (!customer || customer.status === 'cancelled') throw new Error('CUSTOMER_NOT_ELIGIBLE');
  const plan = await col('card_plans').findOne(
    { _id: String(app.plan_id), is_active: true },
    { session },
  );
  if (!plan) throw new Error('PLAN_NOT_ACTIVE');
  const tier = String(plan.code).toUpperCase();
  if (!['BRONZE', 'SILVER', 'GOLD'].includes(tier)) throw new Error('INVALID_TIER');

  if (compareMoney(String(plan.reservation_fee), '10000.00') !== 0)
    throw new Error('RESERVATION_FEE_INVALID');
  const paymentScheme = app.payment_scheme_snapshot as PaymentScheme;
  const result = resolveSchemeEconomics(
    {
      cashPrice: String(plan.cash_price),
      installmentPrice: isoOrNull(plan.installment_price),
      reservationFee: String(plan.reservation_fee),
      validityYears: Number(plan.validity_years),
      standardInstallmentMonths: Number(plan.standard_installment_months ?? 4),
      moveAEnabled: plan.move_a_enabled === true,
      moveB1Enabled: plan.move_b1_enabled === true,
      moveB2Enabled: plan.move_b2_enabled === true,
    },
    paymentScheme,
  );
  if ('error' in result) throw new Error(result.error);
  const {
    total,
    requiredInitial: initial,
    reservationFee: fee,
    validityMonths,
    installmentMonths,
    monthlyAmount,
  } = result.economics;
  // Get commission rule
  const date = new Date().toISOString().split('T')[0];
  const rules = await col('commission_rules')
    .find(
      {
        is_active: true,
        effective_from: { $lte: date },
        $and: [
          { $or: [{ effective_until: null }, { effective_until: { $gte: date } }] },
          {
            $or: [
              { accredited_on_or_after: null },
              {
                accredited_on_or_after: {
                  $lte: String(
                    (await col('staff_users').findOne({ _id: sellerId }, { session }))
                      ?.activated_at ?? '',
                  ).split('T')[0],
                },
              },
            ],
          },
          {
            $or: [
              { target_type: 'staff', target_id: sellerId },
              {
                target_type: 'role',
                target_id: (
                  await col('roles').findOne(
                    { slug: await getStaffRoleSlug(db, sellerId, session) },
                    { projection: { _id: 1 }, session },
                  )
                )?._id,
              },
            ],
          },
        ],
      },
      { session },
    )
    .toArray();
  const rule = rules.find((r) => r.target_type === 'staff') ?? rules[0];
  const rate = String(rule?.rate ?? '0');
  const commission = calculateCommission(total, rate);

  const inclusions = [
    `Priority reservation: ${plan.priority_reservation ? 'yes' : 'no'}`,
    `Monthly annual dues: ${plan.no_monthly_annual_dues ? 'none' : 'applies'}`,
    `Total loyalty value: ${plan.total_loyalty_value}`,
    `Annual benefit tranches: ${plan.annual_points_tranches}`,
  ];

  const version =
    ((
      await col('customer_application_purchase_terms')
        .find({ application_id: applicationId }, { session })
        .sort({ version: -1 })
        .limit(1)
        .toArray()
    )[0]?.version as number) ?? 0;

  return {
    applicationId,
    customerId: String(app.customer_id),
    planId: String(app.plan_id),
    sellerStaffId: sellerId,
    version: version + 1,
    captureKind,
    reason: null,
    tier,
    paymentScheme,
    totalPrice: addMoney(total, '0.00'),
    reservationFee: addMoney(fee, '0.00'),
    minimumDownPayment: String(plan.minimum_down_payment),
    requiredInitial: addMoney(initial, '0.00'),
    installmentMonths,
    monthlyAmount,
    spotCashDays: Number(plan.spot_cash_days),
    validityMonths,
    discountPercent: Number(plan.discount_percent ?? PLAN_BENEFIT_DEFAULTS.discount_percent),
    yearlyPoints: Number(plan.yearly_points),
    annualPointsTranches: Number(
      plan.annual_points_tranches ?? PLAN_BENEFIT_DEFAULTS.annual_points_tranches,
    ),
    holderLimit: Number(plan.cardholder_limit ?? PLAN_BENEFIT_DEFAULTS.cardholder_limit),
    inclusions,
    commissionRuleId: rule?._id ?? null,
    commissionRate: rate,
    commissionBase: addMoney(total, '0.00'),
    expectedCommission: addMoney(commission, '0.00'),
  };
}

async function getStaffStatus(
  db: MongoDb,
  staffId: string,
  session?: ClientSession,
): Promise<string | null> {
  const col = (name: string) => db.collection<MongoRow>(name);
  const staff = await col('staff_users').findOne({ _id: staffId }, { session });
  return (staff?.status as string) ?? null;
}

async function isActiveDownline(
  db: MongoDb,
  actorId: string,
  candidateId: string,
  session?: ClientSession,
): Promise<boolean> {
  const col = (name: string) => db.collection<MongoRow>(name);
  const children = await col('referral_relationships')
    .find(
      { upline_staff_id: actorId, is_active: true },
      { session, projection: { subject_staff_id: 1 } },
    )
    .toArray();
  if (children.some((row) => row.subject_staff_id === candidateId)) return true;
  return !!(await col('referral_relationships').findOne(
    {
      upline_staff_id: { $in: children.map((row) => String(row.subject_staff_id)) },
      subject_staff_id: candidateId,
      is_active: true,
    },
    { session },
  ));
}

export async function purchaseSellerFor(
  db: MongoDb,
  actorId: string,
  candidateId: string | null,
  session?: ClientSession,
): Promise<string> {
  if (!candidateId || candidateId === actorId) {
    const status = await getStaffStatus(db, actorId, session);
    if (status !== 'active') throw new Error('SELLER_INACTIVE');
    const role = await getStaffRoleSlug(db, actorId, session);
    if (
      !role ||
      ![
        'ost',
        'sales_manager',
        'senior_sales_manager',
        'vice_director',
        'admin',
        'super_admin',
      ].includes(role)
    ) {
      throw new Error('SELLER_ROLE_NOT_A_SELLER');
    }
    return actorId;
  }
  const status = await getStaffStatus(db, candidateId, session);
  if (status !== 'active') throw new Error('SELLER_INACTIVE');
  const role = await getStaffRoleSlug(db, candidateId, session);
  if (
    !role ||
    ![
      'ost',
      'sales_manager',
      'senior_sales_manager',
      'vice_director',
      'admin',
      'super_admin',
    ].includes(role)
  ) {
    throw new Error('SELLER_ROLE_NOT_A_SELLER');
  }
  if (
    (await getStaffRoleSlug(db, actorId, session)) !== 'super_admin' &&
    !(await isActiveDownline(db, actorId, candidateId, session))
  ) {
    throw new Error('SELLER_NOT_IN_YOUR_DOWNLINE');
  }
  return candidateId;
}
