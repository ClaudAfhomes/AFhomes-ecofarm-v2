import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { createCustomerApplicationSchema } from '@afhomes/contracts';
import { ensureMongoCustomerVipNumber } from './customers.mongo.js';
import { createMongoPurchaseRecords, allocatePurchaseId } from './purchase-records.mongo.js';
import { audit } from './handler-kit.mongo.js';
import type { ClientSession, Db } from 'mongodb';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { PLAN_BENEFIT_DEFAULTS } from './catalog-model.js';

/** Current save_customer_application rules, before commercial terms are frozen. */
export async function applicationPlanSnapshot(
  db: Db,
  header: Record<string, unknown>,
  secondary: unknown,
  session: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const storedPlan = await col('card_plans').findOne(
    { _id: String(header.planId), is_active: true },
    { session },
  );
  if (!storedPlan) throw new CustomerActivationError(409, 'PLAN_NOT_FOUND');
  const plan: MongoRow = { ...PLAN_BENEFIT_DEFAULTS, ...storedPlan };
  const tier = String(plan.code).toUpperCase();
  if (!['BRONZE', 'SILVER', 'GOLD'].includes(tier))
    throw new CustomerActivationError(409, 'INVALID_TIER');
  if (secondary && tier !== 'GOLD')
    throw new CustomerActivationError(409, 'SECONDARY_HOLDER_GOLD_ONLY');
  const resolved: { id: string; field: string; name: string }[] = [];
  for (const [field, role, name] of [
    ['svdStaffId', 'vice_director', 'svd_name'],
    ['ssmStaffId', 'senior_sales_manager', 'ssm_name'],
    ['smStaffId', 'sales_manager', 'sales_manager_name'],
    ['referrerStaffId', 'ost', 'vip_referrer'],
  ]) {
    if (!header[field!]) continue;
    const id = String(header[field!]),
      staff = await col('staff_users').findOne({ _id: id, status: 'active' }, { session });
    const assignment = await col('staff_role_assignments').findOne({ staff_id: id }, { session });
    const assigned =
      assignment &&
      (await col('roles').findOne({ _id: String(assignment.role_id), slug: role }, { session }));
    if (!staff || !assigned) throw new CustomerActivationError(409, 'SELLER_ROLE_NOT_A_SELLER');
    resolved.push({ id, field: name!, name: String(staff.full_name) });
  }
  for (let lower = 1; lower < resolved.length; lower++) {
    const ancestors = new Set<string>();
    let current = resolved[lower]!.id;
    for (let depth = 0; depth < 8; depth++) {
      const edge = await col('referral_relationships').findOne(
        { subject_staff_id: current, is_active: true },
        { session },
      );
      if (!edge || ancestors.has(String(edge.upline_staff_id))) break;
      current = String(edge.upline_staff_id);
      ancestors.add(current);
    }
    if (resolved.slice(0, lower).some((higher) => !ancestors.has(higher.id)))
      throw new CustomerActivationError(409, 'INVALID_HIERARCHY');
  }
  const names = Object.fromEntries(resolved.map((staff) => [staff.field, staff.name]));
  return {
    tier_snapshot: tier,
    vip_amount_snapshot: plan.cash_price,
    discount_percent_snapshot: Number(plan.discount_percent),
    validity_years_snapshot: Number(plan.validity_years),
    yearly_points_snapshot: Number(plan.yearly_points),
    annual_points_tranches_snapshot: Number(plan.annual_points_tranches),
    holder_limit_snapshot: Number(plan.cardholder_limit),
    sales_manager_name: names.sales_manager_name,
    svd_name: names.svd_name,
    ssm_name: names.ssm_name,
    vip_referrer: names.vip_referrer,
  };
}

/** Company-stated fields are copied only; they never drive commercial calculations. */
export async function mirrorApplicationCustomer(
  db: Db,
  customerId: string,
  header: Record<string, unknown>,
  primary: Record<string, unknown>,
  secondary: Record<string, unknown> | undefined,
  snapshots: Record<string, unknown>,
  session: ClientSession,
) {
  const customers = db.collection<MongoRow>('customers');
  const customer = await customers.findOne({ _id: customerId }, { session });
  if (!customer) throw new CustomerActivationError(404, 'Customer not found');
  const patch: Record<string, unknown> = {};
  const copy = (source: Record<string, unknown>, pairs: Record<string, string>) => {
    for (const [from, to] of Object.entries(pairs))
      if (source[from] !== undefined && source[from] !== null && source[from] !== '')
        patch[to] = source[from];
  };
  copy(primary, {
    citizenship: 'citizenship',
    civilStatus: 'civil_status',
    tinNumber: 'tin_number',
    occupationBusinessName: 'occupation_business_name',
    officeBusinessAddress: 'office_business_address',
    employedPosition: 'employed_position',
  });
  copy(header, {
    raNumber: 'ra_number',
    companyStatus: 'company_status',
    statedVipPackage: 'stated_vip_package',
    statedPaymentTerms: 'stated_payment_terms',
    statedRegularPrice: 'stated_regular_price',
    statedDiscount: 'stated_discount',
    statedTotalAmount: 'stated_total_amount',
    statedRf: 'stated_rf',
    statedPaymentType: 'stated_payment_type',
    statedRefNo: 'stated_ref_no',
    statedPaymentDate: 'stated_payment_date',
    svdName: 'svd_name',
    ssmName: 'ssm_name',
    salesManagerName: 'sm_name',
    vipReferrer: 'referrer_name',
    vipRecommenderName: 'vip_recommender_name',
    recommenderContact: 'related_contact_no',
    recommenderEmail: 'related_email',
  });
  for (const [from, to] of Object.entries({
    svd_name: 'svd_name',
    ssm_name: 'ssm_name',
    sales_manager_name: 'sm_name',
    vip_referrer: 'referrer_name',
  }))
    if (snapshots[from]) patch[to] = snapshots[from];
  if (secondary) {
    copy(secondary, {
      birthDate: 'supplementary_birthday',
      citizenship: 'supplementary_citizenship',
      civilStatus: 'supplementary_civil_status',
      tinNumber: 'supplementary_tin_number',
      mobile: 'supplementary_mobile',
      email: 'supplementary_email',
      landline: 'supplementary_landline',
      occupationBusinessName: 'supplementary_occupation_business_name',
      officeBusinessAddress: 'supplementary_office_address',
      employedPosition: 'supplementary_position',
    });
    const name = [secondary.firstName, secondary.lastName].filter(Boolean).join(' ');
    const address = [
      secondary.permanentAddressLine1,
      secondary.cityMunicipality,
      secondary.province,
    ]
      .filter(Boolean)
      .join(', ');
    if (name) patch.supplementary_full_name = name;
    if (address) patch.supplementary_address = address;
    if (secondary.sex) patch.supplementary_gender = String(secondary.sex).toLowerCase();
  }
  if (
    !customer.government_id_number &&
    header.governmentIdNumber &&
    !(await customers.findOne(
      { _id: { $ne: customerId }, government_id_number: header.governmentIdNumber },
      { session },
    ))
  )
    patch.government_id_number = header.governmentIdNumber;
  await customers.updateOne({ _id: customerId }, { $set: patch }, { session });
}

export function applicationHolderRow(input: Record<string, unknown>) {
  const fields = {
    holderType: 'holder_type',
    lastName: 'last_name',
    firstName: 'first_name',
    middleName: 'middle_name',
    suffix: 'suffix',
    birthDate: 'birth_date',
    sex: 'sex',
    citizenship: 'citizenship',
    civilStatus: 'civil_status',
    permanentAddressLine1: 'permanent_address_line_1',
    permanentAddressLine2: 'permanent_address_line_2',
    cityMunicipality: 'city_municipality',
    province: 'province',
    barangay: 'barangay',
    provinceCode: 'province_code',
    cityMunicipalityCode: 'city_municipality_code',
    barangayCode: 'barangay_code',
    postalCode: 'postal_code',
    landline: 'landline',
    mobile: 'mobile',
    email: 'email',
    tinNumber: 'tin_number',
    occupationBusinessName: 'occupation_business_name',
    officeBusinessAddress: 'office_business_address',
    businessIndustry: 'business_industry',
    employedPosition: 'employed_position',
    printedName: 'printed_name',
  };
  return Object.fromEntries(Object.entries(fields).map(([from, to]) => [to, input[from] ?? null]));
}

export async function insertMongoApplication(
  db: Db,
  actorId: string,
  header: Omit<
    z.infer<typeof createCustomerApplicationSchema>,
    'primary' | 'secondary' | 'acknowledgedAt'
  > & { acknowledgedAt: string | null },
  primary: Record<string, unknown>,
  secondary: Record<string, unknown> | undefined,
  locations: { primary: Record<string, unknown>; secondary: Record<string, unknown> | null },
  session: ClientSession,
) {
  const col = (table: string) => db.collection<MongoRow>(table),
    purchase = createMongoPurchaseRecords(db),
    appId = randomUUID(),
    now = new Date().toISOString();
  const snapshots = await applicationPlanSnapshot(db, header, secondary, session);
  await ensureMongoCustomerVipNumber(
    db,
    header.customerId,
    header.tier,
    header.paymentScheme,
    session,
  );
  await purchase.required('customers', header.customerId, session);
  await col('customer_applications').insertOne(
    {
      _id: appId,
      application_number: await allocatePurchaseId(
        db,
        'AF-APP',
        'customer_applications',
        'application_number',
        session,
      ),
      customer_id: header.customerId,
      plan_id: header.planId,

      payment_scheme_snapshot: header.paymentScheme,

      ...snapshots,
      sales_manager_name: snapshots.sales_manager_name ?? header.salesManagerName ?? null,
      svd_staff_id: header.svdStaffId ?? null,
      ssm_staff_id: header.ssmStaffId ?? null,
      sm_staff_id: header.smStaffId ?? null,
      referrer_staff_id: header.referrerStaffId ?? null,
      svd_name: snapshots.svd_name ?? header.svdName ?? null,
      ssm_name: snapshots.ssm_name ?? header.ssmName ?? null,
      vip_recommender_name: header.vipRecommenderName ?? null,
      recommender_contact: header.recommenderContact ?? null,
      recommender_email: header.recommenderEmail ?? null,
      vip_referrer: snapshots.vip_referrer ?? header.vipReferrer ?? null,
      acquisition_channels: header.acquisitionChannels ?? [],
      consent_acknowledged: header.consentAcknowledged,
      acknowledged_at: header.acknowledgedAt,
      primary_signature_status: header.primarySignatureStatus ?? 'received',
      secondary_signature_status: header.secondarySignatureStatus ?? null,
      valid_id_received: header.validIdReceived ?? false,
      reservation_payment_proof_received: header.reservationPaymentProofReceived ?? false,
      status: 'draft',
      created_by: actorId,
      created_at: now,
      updated_at: now,
    },
    { session },
  );

  await col('customer_application_holders').insertOne(
    {
      _id: randomUUID(),
      application_id: appId,
      holder_type: 'PRIMARY',
      ...applicationHolderRow(locations.primary),
      tin_number: primary.tinNumber ?? null,
      created_at: now,
    },
    { session },
  );

  if (secondary) {
    await col('customer_application_holders').insertOne(
      {
        _id: randomUUID(),
        application_id: appId,
        holder_type: 'SECONDARY',
        ...applicationHolderRow(locations.secondary ?? {}),
        tin_number: secondary.tinNumber ?? null,
        created_at: now,
      },
      { session },
    );
  }

  await audit(
    db,
    actorId,
    'CUSTOMER_APPLICATION_CREATED',
    'customer_application',
    appId,
    null,
    { customerId: header.customerId },
    undefined,
    session,
  );
  await mirrorApplicationCustomer(
    db,
    header.customerId,
    header,
    primary,
    secondary,
    snapshots,
    session,
  );

  return appId;
}
