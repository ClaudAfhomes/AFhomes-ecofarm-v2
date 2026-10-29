import { purchaseSellerFor, purchaseTermsForApplication, type PurchaseTerms } from './purchase-terms.mongo.js';
import { applicationPlanSnapshot, mirrorApplicationCustomer, applicationHolderRow, insertMongoApplication } from './application-records.mongo.js';
import { createMongoImportSourceRecords } from './import-source.mongo.js';
import { createMongoImportContinuationHandlers } from './import-continuation.mongo.js';
import { createMongoPurchaseRecords, allocatePurchaseId } from './purchase-records.mongo.js';
import { CustomerActivationError } from './customer-activation.mongo.js';
import { companyId, ensureMongoCustomerVipNumber } from './customers.mongo.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientSession, Db as MongoDb, MongoClient } from 'mongodb';
import { z } from 'zod';
import { addMoney, compareMoney } from '@afhomes/shared';
import { governmentIdTypeSchema } from '@afhomes/contracts';
import {
  AF_ID_ALPHABET,
  canTransitionReservationAgreement,
  createCustomerApplicationSchema,
  importContinuationRequestSchema,
  registerCustomerApplicationSchema,
  createReservationAgreementSchema,
  customerApplicationDecisionSchema,
  normalizeAddressField,
  normalizePersonName,
  normalizePostalCode,
  officialFormListQuerySchema,
  purchaseReservationCreateSchema,
  purchaseReservationUpdateSchema,
  recordPurchasePaymentSchema,
  verifyPurchasePaymentSchema,
  finalizeReservationPurchaseSchema,
  purchaseTermsProposalSchema,
  reservationAgreementDecisionSchema,
  reviewPurchaseTermsSchema,
  submitPurchaseApplicationSchema,
  type ReservationAgreementStatus,
  paymentSchemeSchema,
  vipTierSchema,
} from '@afhomes/contracts';
import { authorizeAfHomes } from './afhomes-access.js';
import { addressProvider } from './address-source.js';
import { verifyAddressHierarchy } from './address-provider.js';
import { resolvePostalCode } from './postal-reference.js';
import { toErrorEnvelope } from './envelope.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  method,
  route,
  subPath,
  mapMongoError,
  type Db,
  type MongoRow,
} from './handler-kit.mongo.js';
import {
  customerApplicationXlsx,
  customerImportTemplate,
  istImportTemplate,
  officialFormPdf,
  parseFormXlsx,
  reservationAgreementXlsx,
  validateFormImport,
} from './official-forms.js';
import {
  purchaseDocumentFilename,
  purchaseDocumentPdf,
  type PurchaseDocumentEvidence,
  type PurchaseDocumentKind,
} from './purchase-documents.js';
import type { VercelRequest, VercelResponse } from './http.js';
import {
  productSaleRejection,
  resolveSeller,
  snapshotSaleTerms,
  snapshotSchemeTerms,
  summarizePayments,
} from './commerce.js';

const importSchema = z.object({
  kind: z.enum(['customer_application', 'reservation_agreement']),
  contentBase64: z.string().min(1).max(8_000_000),
});
const pdfSchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(['customer_application', 'reservation_agreement']).optional(),
  fields: z.record(z.string(), z.string()),
});
const sendFile = (res: VercelResponse, filename: string, mime: string, bytes: Uint8Array) =>
  res.status(200).json({ filename, mime, content: Buffer.from(bytes).toString('base64') });
const rpcId = (data: unknown) => String(Array.isArray(data) ? data[0] : data);

export async function setupMongoOfficialForms(db: MongoDb) {
  await db
    .collection('customer_application_purchase_terms')
    .createIndex({ application_id: 1, version: 1 }, { unique: true });
  await db
    .collection('purchase_document_evidence')
    .createIndex({ kind: 1, source_id: 1, revision: 1 }, { unique: true });
  await db
    .collection('purchase_document_evidence')
    .createIndex({ reservation_id: 1 }, { sparse: true });
  await db
    .collection('purchase_document_evidence')
    .createIndex({ payment_id: 1 }, { sparse: true });
  await db.collection('purchase_document_evidence').createIndex({ sale_id: 1 }, { sparse: true });
  await db
    .collection('purchase_document_evidence')
    .createIndex({ membership_id: 1 }, { sparse: true });
  await db
    .collection('mutation_requests')
    .createIndex({ actor_id: 1, operation: 1, request_id: 1 }, { unique: true });
  await db.collection('payments').createIndex(
    { reservation_id: 1, reference: 1 },
    {
      unique: true,
      partialFilterExpression: {
        reservation_id: { $type: 'string' },
        reference: { $type: 'string' },
        origin: 'reservation',
      },
    },
  );
  await db.collection('payments').createIndex(
    { reservation_id: 1, status: 1 },
    {
      name: 'payments_reservation_status_idx',
      partialFilterExpression: { origin: 'reservation' },
    },
  );
  await db.collection('card_sales').createIndex({ sale_number: 1 }, { unique: true });
  await db.collection('card_sales').createIndex(
    { customer_id: 1, plan_id: 1 },
    {
      unique: true,
      partialFilterExpression: {
        status: {
          $in: [
            'draft',
            'submitted',
            'payment_pending',
            'payment_in_progress',
            'payment_verified',
            'activation_pending',
          ],
        },
      },
    },
  );
}

type OptionalTextHolder = {
  middleName?: string;
  suffix?: string;
  postalCode?: string;
  occupationBusinessName?: string;
  employedPosition?: string;
};

const normalizeHolderOptionals = <T extends OptionalTextHolder>(holder: T): T => ({
  ...holder,
  ...(holder.middleName ? { middleName: normalizePersonName(holder.middleName) } : {}),
  ...(holder.suffix ? { suffix: normalizePersonName(holder.suffix) } : {}),
  ...(holder.postalCode ? { postalCode: normalizePostalCode(holder.postalCode) } : {}),
  ...(holder.occupationBusinessName
    ? { occupationBusinessName: normalizeAddressField(holder.occupationBusinessName) }
    : {}),
  ...(holder.employedPosition
    ? { employedPosition: normalizeAddressField(holder.employedPosition) }
    : {}),
});

const normalizeApplicationHeader = <
  T extends {
    salesManagerName?: string;
    svdName?: string;
    ssmName?: string;
    vipRecommenderName?: string;
    vipReferrer?: string;
  },
>(
  header: T,
): T => ({
  ...header,
  ...(header.salesManagerName
    ? { salesManagerName: normalizePersonName(header.salesManagerName) }
    : {}),
  ...(header.svdName ? { svdName: normalizePersonName(header.svdName) } : {}),
  ...(header.ssmName ? { ssmName: normalizePersonName(header.ssmName) } : {}),
  ...(header.vipRecommenderName
    ? { vipRecommenderName: normalizePersonName(header.vipRecommenderName) }
    : {}),
  ...(header.vipReferrer ? { vipReferrer: normalizePersonName(header.vipReferrer) } : {}),
});

type HolderLocation = {
  province?: string;
  cityMunicipality?: string;
  barangay?: string;
  provinceCode?: string;
  cityMunicipalityCode?: string;
  barangayCode?: string;
};

type LocationRefusal = { status: number; message: string };
type LocationResult =
  { ok: true; holder: Record<string, unknown> } | { ok: false; refusal: LocationRefusal };

async function resolveHolderLocation(
  holder: HolderLocation,
  db: MongoDb,
  session?: ClientSession,
): Promise<LocationResult> {
  const { provinceCode, cityMunicipalityCode, barangayCode } = holder;
  const present = [provinceCode, cityMunicipalityCode, barangayCode].filter(Boolean).length;

  if (present === 0) return { ok: true, holder };
  if (present !== 3)
    return {
      ok: false,
      refusal: {
        status: 400,
        message: 'Choose the province, city or municipality and barangay from the list.',
      },
    };

  const check = await verifyAddressHierarchy(addressProvider(), {
    provinceCode: provinceCode!,
    localityCode: cityMunicipalityCode!,
    barangayCode: barangayCode!,
  });

  if (check.valid) {
    const postal = resolvePostalCode(
      check.hierarchy.province.name,
      check.hierarchy.locality.name,
      check.hierarchy.barangay.name,
    );
    if (postal.status !== 'matched')
      return {
        ok: false,
        refusal: {
          status: 400,
          message:
            'Postal reference requires review for this location. No unverified ZIP was saved.',
        },
      };
    return {
      ok: true,
      holder: {
        ...holder,
        province: check.hierarchy.province.name,
        cityMunicipality: check.hierarchy.locality.name,
        barangay: check.hierarchy.barangay.name,
        provinceCode: check.hierarchy.province.code,
        cityMunicipalityCode: check.hierarchy.locality.code,
        barangayCode: check.hierarchy.barangay.code,
        postalCode: postal.postalCode,
      },
    };
  }

  switch (check.reason) {
    case 'PROVIDER_UNAVAILABLE':
      return {
        ok: false,
        refusal: {
          status: 503,
          message: 'The address list is temporarily unavailable. Try again shortly.',
        },
      };
    case 'PROVIDER_BAD_RESPONSE':
      return {
        ok: false,
        refusal: { status: 502, message: 'The address list returned an unusable response.' },
      };
    default:
      return {
        ok: false,
        refusal: {
          status: 400,
          message:
            'That province, city or municipality and barangay do not form a valid location. Choose them again from the list.',
        },
      };
  }
}

async function resolveHolderLocations(
  primary: HolderLocation,
  secondary: HolderLocation | undefined,
  db: MongoDb,
  session?: ClientSession,
): Promise<
  | { ok: true; primary: Record<string, unknown>; secondary: Record<string, unknown> | null }
  | LocationRefusal
> {
  const resolvedPrimary = await resolveHolderLocation(primary, db, session);
  if (!resolvedPrimary.ok) return resolvedPrimary.refusal;
  if (!secondary) return { ok: true, primary: resolvedPrimary.holder, secondary: null };
  const resolvedSecondary = await resolveHolderLocation(secondary, db, session);
  if (!resolvedSecondary.ok) return resolvedSecondary.refusal;
  return { ok: true, primary: resolvedPrimary.holder, secondary: resolvedSecondary.holder };
}

const shapeApplicationHolder = (row: MongoRow) => ({
  holderType: row.holder_type,
  lastName: row.last_name,
  firstName: row.first_name,
  middleName: row.middle_name ?? undefined,
  suffix: row.suffix ?? undefined,
  birthDate: row.birth_date,
  sex: row.sex ?? undefined,
  citizenship: row.citizenship ?? undefined,
  civilStatus: row.civil_status ?? undefined,
  permanentAddressLine1: row.permanent_address_line_1,
  permanentAddressLine2: row.permanent_address_line_2 ?? undefined,
  cityMunicipality: row.city_municipality,
  province: row.province,
  barangay: row.barangay ?? undefined,
  provinceCode: row.province_code ?? undefined,
  cityMunicipalityCode: row.city_municipality_code ?? undefined,
  barangayCode: row.barangay_code ?? undefined,
  postalCode: row.postal_code ?? undefined,
  landline: row.landline ?? undefined,
  mobile: row.mobile,
  email: row.email,
  tinNumber: row.tin_number ?? undefined,
  occupationBusinessName: row.occupation_business_name ?? undefined,
  officeBusinessAddress: row.office_business_address ?? undefined,
  businessIndustry: row.business_industry ?? undefined,
  employedPosition: row.employed_position ?? undefined,
  printedName: row.printed_name,
});

async function getApplication(db: MongoDb, id: string, session?: ClientSession) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const app = await col('customer_applications').findOne({ _id: id }, { session });
  if (!app) return null;
  const holders = await col('customer_application_holders')
    .find({ application_id: id }, { session })
    .sort({ holder_type: 1 })
    .toArray();
  const primary = holders.find((h: MongoRow) => h.holder_type === 'PRIMARY');
  const secondary = holders.find((h: MongoRow) => h.holder_type === 'SECONDARY');
  return {
    id: app._id,
    applicationNumber: app.application_number,
    purchaseTermsId: app.purchase_terms_id ?? null,
    customerId: app.customer_id,
    saleId: app.sale_id,
    planId: app.plan_id,
    tier: app.tier_snapshot,
    paymentScheme: app.payment_scheme_snapshot,
    vipAmount: app.vip_amount_snapshot,
    discountPercent: app.discount_percent_snapshot,
    validityYears: app.validity_years_snapshot,
    yearlyPoints: app.yearly_points_snapshot,
    annualPointsTranches: app.annual_points_tranches_snapshot,
    holderLimit: app.holder_limit_snapshot,
    primary: primary ? shapeApplicationHolder(primary) : null,
    secondary: secondary ? shapeApplicationHolder(secondary) : undefined,
    salesManagerName: app.sales_manager_name ?? undefined,
    svdStaffId: app.svd_staff_id ?? undefined,
    ssmStaffId: app.ssm_staff_id ?? undefined,
    smStaffId: app.sm_staff_id ?? undefined,
    referrerStaffId: app.referrer_staff_id ?? undefined,
    svdName: app.svd_name ?? undefined,
    ssmName: app.ssm_name ?? undefined,
    vipRecommenderName: app.vip_recommender_name ?? undefined,
    recommenderContact: app.recommender_contact ?? undefined,
    recommenderEmail: app.recommender_email ?? undefined,
    vipReferrer: app.vip_referrer ?? undefined,
    acquisitionChannels: app.acquisition_channels ?? [],
    consentAcknowledged: app.consent_acknowledged === true,
    acknowledgedAt: isoOrNull(app.acknowledged_at) ?? '',
    primarySignatureStatus: app.primary_signature_status ?? 'received',
    secondarySignatureStatus: app.secondary_signature_status ?? undefined,
    validIdReceived: app.valid_id_received === true,
    reservationPaymentProofReceived: app.reservation_payment_proof_received === true,
    status: app.status,
    createdBy: app.created_by,
    createdAt: isoOrNull(app.created_at) ?? '',
    updatedAt: isoOrNull(app.updated_at) ?? '',
    submittedAt: isoOrNull(app.submitted_at),
    approvedAt: isoOrNull(app.approved_at),
    rejectedAt: isoOrNull(app.rejected_at),
  };
}

function applicationFields(app: NonNullable<Awaited<ReturnType<typeof getApplication>>>) {
  const p = app.primary as Record<string, unknown>;
  const s = app.secondary as Record<string, unknown> | undefined;
  const out: Record<string, string> = {
    primary_last_name: String(p.lastName ?? ''),
    primary_first_name: String(p.firstName ?? ''),
    primary_middle_name: String(p.middleName ?? ''),
    primary_suffix: String(p.suffix ?? ''),
    primary_birth_date: String(p.birthDate ?? ''),
    primary_sex: String(p.sex ?? ''),
    primary_citizenship: String(p.citizenship ?? ''),
    primary_civil_status: String(p.civilStatus ?? ''),
    primary_address_line_1: String(p.permanentAddressLine1 ?? ''),
    primary_address_line_2: String(p.permanentAddressLine2 ?? ''),
    primary_city_municipality: String(p.cityMunicipality ?? ''),
    primary_province: String(p.province ?? ''),
    primary_barangay: String(p.barangay ?? ''),
    primary_postal_code: String(p.postalCode ?? ''),
    primary_landline: String(p.landline ?? ''),
    primary_mobile: String(p.mobile ?? ''),
    primary_email: String(p.email ?? ''),
    primary_tin: String(p.tinNumber ?? ''),
    primary_occupation_business: String(p.occupationBusinessName ?? ''),
    primary_office_business_address: String(p.officeBusinessAddress ?? ''),
    primary_business_industry: String(p.businessIndustry ?? ''),
    primary_employed_position: String(p.employedPosition ?? ''),
    secondary_enabled: String(Boolean(s)),
    card_tier: String(app.tier),
    payment_scheme: String(app.paymentScheme),
    sales_manager: String(app.salesManagerName ?? ''),
    vip_recommender: String(app.vipRecommenderName ?? ''),
    recommender_contact: String(app.recommenderContact ?? ''),
    recommender_email: String(app.recommenderEmail ?? ''),
    vip_referrer: String(app.vipReferrer ?? ''),
    acquisition_channels: (app.acquisitionChannels as string[]).join('|'),
    consent_acknowledged: String(app.consentAcknowledged),
    acknowledgement_date: app.acknowledgedAt == null ? '' : String(app.acknowledgedAt),
    primary_signature_status: String(app.primarySignatureStatus ?? 'received'),
    secondary_signature_status: String(app.secondarySignatureStatus ?? ''),
    valid_id_received: String(app.validIdReceived),
    reservation_payment_proof_received: String(app.reservationPaymentProofReceived),
  };
  if (s)
    for (const [from, to] of [
      ['lastName', 'last_name'],
      ['firstName', 'first_name'],
      ['middleName', 'middle_name'],
      ['suffix', 'suffix'],
      ['birthDate', 'birth_date'],
      ['sex', 'sex'],
      ['citizenship', 'citizenship'],
      ['civilStatus', 'civil_status'],
      ['permanentAddressLine1', 'address_line_1'],
      ['permanentAddressLine2', 'address_line_2'],
      ['cityMunicipality', 'city_municipality'],
      ['province', 'province'],
      ['barangay', 'barangay'],
      ['postalCode', 'postal_code'],
      ['landline', 'landline'],
      ['mobile', 'mobile'],
      ['email', 'email'],
      ['tinNumber', 'tin'],
      ['occupationBusinessName', 'occupation_business'],
      ['officeBusinessAddress', 'office_business_address'],
      ['businessIndustry', 'business_industry'],
      ['employedPosition', 'employed_position'],
    ] as const)
      out[`secondary_${to}`] = String(s[from] ?? '');
  return out;
}

async function getAgreement(db: MongoDb, id: string, session?: ClientSession) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const agreement = await col('reservation_agreements').findOne({ _id: id }, { session });
  if (!agreement) return null;
  const holders = await col('reservation_agreement_holders')
    .find({ agreement_id: id }, { session })
    .sort({ holder_type: 1 })
    .toArray();
  const schedule = await col('reservation_agreement_schedule')
    .find({ agreement_id: id }, { session })
    .sort({ line_number: 1 })
    .toArray();
  const row = agreement;
  const holdersMapped = holders.map((h: MongoRow) => ({
    holderType: h.holder_type,
    name: h.name,
    address: h.address,
    contactNumber: h.contact_number,
    email: h.email,
    tinNumber: h.tin_number ?? undefined,
  }));
  return {
    id: row._id,
    reservationNumber: row.reservation_number,
    revisionNumber: row.revision_number ?? undefined,
    reservationDate: row.reservation_date,
    agreementDate: row.agreement_date,
    origin: (row.origin as string | undefined) ?? 'sale',
    saleId: row.sale_id,
    customerApplicationId: row.customer_application_id ?? undefined,
    customerId: row.customer_id ?? undefined,
    sellerStaffId: row.seller_staff_id ?? undefined,
    purchaseTermsId: row.purchase_terms_id ?? null,
    planId: row.plan_id,
    tier: row.tier_snapshot,
    inclusions: row.inclusions_snapshot,
    totalPrice: row.total_price_snapshot,
    reservationFee: row.reservation_fee_snapshot,
    downPayment: row.down_payment_snapshot,
    totalPaymentReceived: row.total_payment_received_snapshot,
    balance: row.balance_snapshot,
    monthlyAmortization: row.monthly_amortization_snapshot ?? null,
    installmentMonths: row.installment_months_snapshot ?? null,
    paymentScheme: row.payment_scheme_snapshot,
    discountPercent: row.discount_percent_snapshot,
    validityYears: row.validity_years_snapshot,
    yearlyPoints: row.yearly_points_snapshot,
    annualPointsTranches: row.annual_points_tranches_snapshot,
    holderLimit: row.holder_limit_snapshot,
    monthlyAmortizationStart: row.monthly_amortization_start ?? undefined,
    monthlyAmortizationEnd: row.monthly_amortization_end ?? undefined,
    paymentDueDay: row.payment_due_day ?? undefined,
    primary:
      holdersMapped.find((h: (typeof holdersMapped)[0]) => h.holderType === 'PRIMARY') ?? null,
    secondary: holdersMapped.find((h: (typeof holdersMapped)[0]) => h.holderType === 'SECONDARY'),
    schedule: schedule.map((line: MongoRow) => ({
      lineNumber: line.line_number,
      particular: line.particular,
      amount: line.amount_snapshot,
      paymentDate: line.payment_date ?? undefined,
    })),
    status: row.status,
    createdBy: row.created_by,
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
    submittedAt: isoOrNull(row.submitted_at),
    executedAt: isoOrNull(row.executed_at),
    finalizedAt: isoOrNull(row.finalized_at),
    spotCashStartedAt: isoOrNull(row.spot_cash_started_at),
    spotCashDeadline: isoOrNull(row.spot_cash_deadline),
  };
}

async function progressedApplicationIds(db: MongoDb, session?: ClientSession): Promise<string[]> {
  const col = (name: string) => db.collection<MongoRow>(name);
  const agreements = await col('reservation_agreements')
    .find(
      { origin: 'application', status: { $ne: 'cancelled' } },
      { projection: { customer_application_id: 1 }, session },
    )
    .toArray();
  return [
    ...new Set(
      agreements.map((a: MongoRow) => String(a.customer_application_id ?? '')).filter(Boolean),
    ),
  ];
}

async function listRows(
  req: VercelRequest,
  res: VercelResponse,
  db: MongoDb,
  table: 'customer_applications' | 'reservation_agreements',
  session?: ClientSession,
) {
  const parsed = officialFormListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
  const q = parsed.data;
  const col = (name: string) => db.collection<MongoRow>(name);

  let filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.saleId) filter.sale_id = q.saleId;
  if (q.customerId && table === 'customer_applications') filter.customer_id = q.customerId;
  if (q.tier) filter.tier_snapshot = q.tier;
  if (q.seller) filter.created_by = q.seller;
  if (q.from) filter.created_at = { $gte: q.from };
  if (q.to) filter.created_at = { $lte: `${q.to}T23:59:59.999Z` };
  if (q.search) {
    const field = table === 'customer_applications' ? 'application_number' : 'reservation_number';
    filter[field] = { $regex: q.search.replace(/[%_,]/g, ''), $options: 'i' };
  }
  if (table === 'reservation_agreements' && q.application)
    filter.customer_application_id = q.application;
  if (table === 'reservation_agreements' && q.queue === 'reservation_work' && !q.status)
    filter.status = { $ne: 'executed' };
  if (table === 'customer_applications' && q.queue === 'application_work' && !q.status) {
    const progressed = await progressedApplicationIds(db, session);
    if (progressed.length) filter._id = { $nin: progressed };
  }

  const cursor = col(table)
    .find(filter, { session })
    .sort({ created_at: -1 })
    .skip(q.offset)
    .limit(q.limit);
  const rows = await cursor.toArray();
  const total = await col(table).countDocuments(filter, { session });

  if (table === 'customer_applications' && rows.length) {
    const ids = rows.map((row) => String(row._id));
    const holders = await col('customer_application_holders')
      .find({ application_id: { $in: ids }, holder_type: 'PRIMARY' }, { session })
      .toArray();
    const names = new Map(
      holders.map((holder: MongoRow) => [
        String(holder.application_id),
        `${String(holder.first_name ?? '')} ${String(holder.last_name ?? '')}`.trim(),
      ]),
    );
    const termsIds = rows.flatMap((row) =>
      row.purchase_terms_id ? [String(row.purchase_terms_id)] : [],
    );
    const sellersByTerms = new Map<string, string>();
    if (termsIds.length) {
      const terms = await col('customer_application_purchase_terms')
        .find({ _id: { $in: termsIds } }, { projection: { seller_staff_id: 1 }, session })
        .toArray();
      for (const term of terms) sellersByTerms.set(String(term._id), String(term.seller_staff_id));
    }
    const sellerId = (row: MongoRow) =>
      sellersByTerms.get(String(row.purchase_terms_id)) ?? String(row.created_by ?? '');
    const sellerIds = [...new Set(rows.map(sellerId).filter(Boolean))];
    const sellerNames = new Map<string, string>();
    if (sellerIds.length) {
      const staff = await col('staff_users')
        .find({ _id: { $in: sellerIds } }, { projection: { full_name: 1 }, session })
        .toArray();
      for (const seller of staff)
        sellerNames.set(String(seller._id), String(seller.full_name ?? ''));
    }
    for (const row of rows) {
      row.applicant_name = names.get(String(row._id)) ?? null;
      row.seller_name = sellerNames.get(sellerId(row)) ?? null;
    }
  }
  if (table === 'reservation_agreements' && rows.length) {
    const ids = rows.map((row: MongoRow) => String(row._id));
    const holders = await col('reservation_agreement_holders')
      .find({ agreement_id: { $in: ids } }, { session })
      .toArray();
    const names = new Map<string, string>();
    const secondaryAgreements = new Set<string>();
    for (const holder of holders) {
      if (String(holder.holder_type) === 'PRIMARY')
        names.set(String(holder.agreement_id), String(holder.name ?? ''));
      else if (String(holder.holder_type) === 'SECONDARY')
        secondaryAgreements.add(String(holder.agreement_id));
    }
    const paymentIds = rows.map((row) => String(row._id));
    const verifiedTotal = new Map<string, string>();
    const anyPayment = new Set<string>();
    const verified = new Set<string>();
    if (paymentIds.length) {
      const payments = await col('payments')
        .find({ reservation_id: { $in: paymentIds } }, { session })
        .toArray();
      for (const p of payments) {
        const rid = String(p.reservation_id ?? '');
        if (!rid) continue;
        anyPayment.add(rid);
        if (String(p.status ?? '') === 'verified') {
          verified.add(rid);
          const amount = String(p.amount ?? '0.00');
          verifiedTotal.set(rid, addMoney(verifiedTotal.get(rid) ?? '0.00', amount));
        }
      }
    }
    for (const row of rows) {
      const rid = String(row._id);
      const vTotal = verifiedTotal.get(rid) ?? '0.00';
      const total = String(row.total_price_snapshot ?? '0.00');
      row.payment_status = verified.has(rid) ? 'paid' : anyPayment.has(rid) ? 'pending' : null;
      row.verified_total = vTotal;
      let fullyPaid = false;
      try {
        fullyPaid = compareMoney(total, '0.00') > 0 && compareMoney(vTotal, total) >= 0;
      } catch {
        fullyPaid = false;
      }
      row.fully_paid = fullyPaid;
      row.applicant_name = names.get(rid) ?? null;
      row.has_secondary_holder = secondaryAgreements.has(rid);
    }
  }
  return res.status(200).json({
    data: rows.map((row) => ({
      id: row._id, tier_snapshot: row.tier_snapshot, applicant_name: row.applicant_name ?? null,
      created_by: row.created_by ?? null, created_at: isoOrNull(row.created_at) ?? '',
      submitted_at: isoOrNull(row.submitted_at), status: row.status,
      ...(table === 'customer_applications'
        ? { application_number: row.application_number, seller_name: row.seller_name ?? null }
        : { reservation_number: row.reservation_number, sale_id: row.sale_id ?? null,
            payment_scheme_snapshot: row.payment_scheme_snapshot, total_price_snapshot: row.total_price_snapshot,
            has_secondary_holder: row.has_secondary_holder === true, payment_status: row.payment_status ?? null,
            verified_total: row.verified_total, fully_paid: row.fully_paid === true }),
    })),
    meta: { total, limit: q.limit, offset: q.offset },
  });
}

const APPLICABLE_DECISION_AUDIT: Record<string, string> = {
  executed: 'RESERVATION_AGREEMENT_EXECUTED',
};

function documentModule(kind: PurchaseDocumentKind): Parameters<typeof authorizeAfHomes>[1] {
  return kind === 'membership_activated'
    ? 'finance.card_activation'
    : kind === 'reservation'
      ? 'sales.card_sales'
      : 'finance.payment_verification';
}

function shapePayment(row: MongoRow) {
  return {
    origin: (row.origin as string | undefined) ?? 'sale',
    id: row._id,
    paymentNumber: (row.payment_number as string | null | undefined) ?? null,
    saleId: (row.sale_id as string | null | undefined) ?? null,
    reservationId: (row.reservation_id as string | null | undefined) ?? null,
    customerId: isoOrNull(row.customer_id),
    amount: row.amount,
    paymentType: row.payment_type,
    method: row.method,
    reference: isoOrNull(row.reference),
    notes: isoOrNull(row.notes),
    status: row.status,
    rejectionReason: isoOrNull(row.rejection_reason),
    recordedBy: row.recorded_by,
    verifiedBy: isoOrNull(row.verified_by),
    recordedAt: isoOrNull(row.recorded_at) ?? '',
    verifiedAt: isoOrNull(row.verified_at),
  };
}

async function agreementFinanceSummary(db: MongoDb, id: string, session?: ClientSession) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const state = await createMongoPurchaseRecords(db).finance(id, session);
  const summary = state.reservation;
  const application = await col('customer_applications').findOne(
    { _id: String(summary.customer_application_id) },
    { projection: { application_number: 1, status: 1 }, session },
  );
  const customer = await col('customers').findOne(
    { _id: String(summary.customer_id) },
    { projection: { first_name: 1, middle_name: 1, last_name: 1, suffix: 1 }, session },
  );
  const seller = await col('staff_users').findOne(
    { _id: String(summary.seller_staff_id) },
    { projection: { full_name: 1 }, session },
  );
  const payments = state.payments;
  const sale = summary.sale_id
    ? await col('card_sales').findOne(
        { _id: String(summary.sale_id) },
        { projection: { sale_number: 1 }, session },
      )
    : null;

  const membership = summary.sale_id
    ? await col('memberships').findOne(
        { sale_id: String(summary.sale_id) },
        { projection: { _id: 1, membership_number: 1, status: 1 }, session },
      )
    : null;

  let pointsBalance = 0;
  if (membership) {
    const account = await col('points_accounts').findOne(
      { membership_id: membership._id },
      { projection: { balance: 1 }, session },
    );
    pointsBalance = Number(account?.balance ?? 0);
  }

  const name = (customer ?? {}) as Record<string, unknown>;
  const applicationRow = (application ?? {}) as Record<string, unknown>;
  const sellerRow = (seller ?? {}) as Record<string, unknown>;

  return {
    reservationId: summary._id,
    reservationNumber: summary.reservation_number,
    customerApplicationId: summary.customer_application_id,
    applicationNumber: String(applicationRow.application_number ?? ''),
    applicationStatus: applicationRow.status ?? 'approved',
    purchaseTermsId: summary.purchase_terms_id,
    sellerStaffId: summary.seller_staff_id,
    sellerName: String(sellerRow.full_name ?? ''),
    tier: summary.tier_snapshot,
    customerId: summary.customer_id,
    customerName:
      [name.first_name, name.middle_name, name.last_name, name.suffix]
        .filter((part) => typeof part === 'string' && part)
        .join(' ') || 'Unknown customer',
    productName: `VIP ${String(summary.tier_snapshot)}`,
    status: summary.status,
    paymentScheme: summary.payment_scheme_snapshot,
    totalPrice: summary.total_price_snapshot,
    reservationFee: summary.reservation_fee_snapshot,
    requiredInitial: summary.required_initial_snapshot,
    installmentMonths: summary.installment_months_snapshot,
    monthlyAmount: summary.monthly_amortization_snapshot,
    validityMonths: summary.validity_months_snapshot,
    verifiedTotal: state.verifiedTotal,
    remainingBalance: state.remainingBalance,
    overpaidAmount: state.overpaidAmount,
    fullyPaid: state.fullyPaid,
    recordedPaymentCount: state.recordedPaymentCount,
    firstVerifiedPayment: isoOrNull(summary.spot_cash_started_at),
    spotCashDeadline: isoOrNull(summary.spot_cash_deadline),
    saleId: summary.sale_id,
    saleNumber: sale?.sale_number ?? null,
    membership: membership
      ? {
          id: membership._id,
          membershipNumber: membership.membership_number,
          status: membership.status,
          pointsBalance,
        }
      : null,
    payments: payments.map((row: MongoRow) => shapePayment(row)),
  };
}

function purchaseRequestId(req: VercelRequest): string {
  const body = jsonBody(req) as { requestId?: unknown } | undefined;
  return typeof body?.requestId === 'string' && z.string().uuid().safeParse(body.requestId).success
    ? body.requestId
    : randomUUID();
}

function sellerCandidateQuery(
  req: VercelRequest,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const raw = req.query.sellerCandidateId;
  if (raw === undefined || raw === '') return { ok: true, value: null };
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: 'sellerCandidateId must be a single UUID' };
}

function termsProposal(terms: PurchaseTerms) {
  const { version: _version, reason: _reason, ...economics } = terms;
  const payload = {
    applicationId: terms.applicationId,
    offerKind:
      terms.captureKind === 'review' ? ('newly_confirmed_offer' as const) : ('submission' as const),
    terms: economics,
  };
  return {
    ...payload,
    expectedProposalHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    asOf: new Date().toISOString(),
  };
}

async function mutationResult(
  db: MongoDb,
  actorId: string,
  operation: string,
  requestId: string,
  payload: unknown,
  session?: ClientSession,
): Promise<string | null> {
  const col = (name: string) => db.collection<MongoRow>(name);
  const existing = await col('mutation_requests').findOne(
    { actor_id: actorId, operation, request_id: requestId },
    { session },
  );
  if (existing) {
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (existing.payload_hash !== payloadHash) throw new Error('MUTATION_REQUEST_CONFLICT');
    return String(existing.result_id);
  }
  return null;
}

async function completePurchaseMutation(
  db: MongoDb,
  actorId: string,
  operation: string,
  requestId: string,
  payload: unknown,
  resultId: string,
  receipt: Record<string, unknown>,
  session?: ClientSession,
): Promise<void> {
  const col = (name: string) => db.collection<MongoRow>(name);
  await col('mutation_requests').insertOne(
    {
      _id: randomUUID(),
      actor_id: actorId,
      operation,
      request_id: requestId,
      payload_hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      result_id: resultId,
      result_receipt: receipt,
      created_at: new Date().toISOString(),
    },
    { session },
  );
}

async function transitionAgreementStatus(
  db: MongoDb,
  authUserId: string,
  id: string,
  to: ReservationAgreementStatus,
  session: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const agreement = await col('reservation_agreements').findOne({ _id: id }, { session });
  if (!agreement) return null;
  if (!canTransitionReservationAgreement(agreement.status as ReservationAgreementStatus, to)) {
    const conflict = new Error(
      `INVALID_AGREEMENT_TRANSITION: cannot move from ${agreement.status} to ${to}`,
    );
    (conflict as { code?: string }).code = 'INVALID_AGREEMENT_TRANSITION';
    throw conflict;
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, updated_at: now };
  if (to === 'executed') {
    patch.submitted_at = agreement.submitted_at ?? now;
    patch.executed_at = now;
  }
  await col('reservation_agreements').updateOne({ _id: id }, { $set: patch }, { session });
  await audit(
    db,
    authUserId,
    to === 'draft'
      ? 'RESERVATION_AGREEMENT_REOPENED'
      : (APPLICABLE_DECISION_AUDIT[to] ?? 'RESERVATION_AGREEMENT_UPDATED'),
    'reservation_agreement',
    id,
    { status: agreement.status },
    { status: to },
    undefined,
    session,
  );
  return true;
}

async function authorizeAgreementMutation(
  req: VercelRequest,
  res: VercelResponse,
  db: MongoDb,
  agreement: { createdBy?: unknown } | null,
  authorize: typeof authorizeAfHomes,
  session?: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const creator = await authorize(req, 'sales.card_sales', 'create');
  if ('error' in creator) {
    deny(res, creator);
    return null;
  }
  if (agreement) {
    const cardUpdate = await authorize(req, 'sales.card_sales', 'update');
    if (!('error' in cardUpdate)) return cardUpdate;
    if (agreement.createdBy && String(agreement.createdBy) === creator.userId) return creator;
    deny(res, {
      error: toErrorEnvelope(
        'FORBIDDEN',
        'Only the owning seller or an authorized reviewer may change this agreement',
        403,
      ),
    });
    return null;
  }
  return creator;
}

async function tierConflictForSale(
  db: MongoDb,
  saleId: string,
  vipTier: string,
  session?: ClientSession,
): Promise<string | null> {
  const col = (name: string) => db.collection<MongoRow>(name);
  const sale = await col('card_sales').findOne(
    { _id: saleId },
    { projection: { plan_id: 1 }, session },
  );
  if (!sale) return null;
  const plan = await col('card_plans').findOne(
    { _id: String(sale.plan_id) },
    { projection: { code: 1 }, session },
  );
  if (!plan) return null;
  const actual = String(plan.code).toUpperCase();
  return actual === vipTier.toUpperCase()
    ? null
    : `Imported tier ${vipTier.toUpperCase()} does not match the selected sale (${actual})`;
}

async function authorizeAgreementSale(
  req: VercelRequest,
  res: VercelResponse,
  db: MongoDb,
  saleId: string,
  authorize: typeof authorizeAfHomes,
  session?: ClientSession,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const auth = await authorize(req, 'sales.card_sales', 'create');
  if ('error' in auth) {
    deny(res, auth);
    return false;
  }
  const oversight = await authorize(req, 'sales.card_sales', 'update');
  if (!('error' in oversight)) return true;
  const sale = await col('card_sales').findOne(
    { _id: saleId },
    { projection: { seller_staff_id: 1, seller_ost_id: 1 }, session },
  );
  if (sale && (sale.seller_staff_id === auth.userId || sale.seller_ost_id === auth.userId))
    return true;
  fail(
    res,
    'FORBIDDEN',
    'Only the sale seller or an authorized reviewer may create or edit this agreement',
    403,
  );
  return false;
}


/** Shared draft writer; caller owns authorization, replay and the transaction. */
export function createMongoOfficialFormsHandler(
  db: MongoDb,
  client: MongoClient,
  authorizeStaff: typeof authorizeAfHomes,
) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const purchase = createMongoPurchaseRecords(db);
  const importSources = createMongoImportSourceRecords(
    db,
    authorizeStaff,
    createMongoImportContinuationHandlers(db, client, authorizeStaff),
  );

  const handler = async (req: VercelRequest, res: VercelResponse) => {
    let gate: Parameters<typeof authorizeAfHomes> | undefined;
    const authorize: typeof authorizeAfHomes = async (...args) => {
      const result = await authorizeStaff(...args);
      if (!('error' in result)) gate ??= args;
      return result;
    };
    const serialize = async (session: ClientSession) => {
      if (method(req) === 'GET') return;
      if (
        subPath(req) === 'customer-applications' &&
        (jsonBody(req) as Record<string, unknown>)?.importContext
      )
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
      await db
        .collection<{ _id: string; seq: number }>('counters')
        .updateOne({ _id: 'sales-write' }, { $inc: { seq: 1 } }, { session, upsert: true });
      if (gate) {
        const fresh = await authorizeStaff(...gate);
        if ('error' in fresh) deny(res, fresh);
      }
    };

    res.setHeader('Cache-Control', 'no-store');
    try {
      const path = subPath(req);

      const importPrefill = route(req, 'GET', /^customer-import-prefill\/([0-9a-f-]+)$/);
      if (importPrefill) {
        const auth = await authorize(req, 'sales.customers', 'create');
        if ('error' in auth) return deny(res, auth);
        const importAccess = await authorize(req, 'governance.customer_import');
        if ('error' in importAccess) return deny(res, importAccess);
        const id = z.string().uuid().safeParse(importPrefill[1]!);
        if (!id.success) return fail(res, 'VALIDATION_ERROR', 'Invalid customer', 400);
        const imported = await col('customer_import_rows')
          .find({
            customer_id: id.data,
            committed_at: { $ne: null },
            'raw_data.workbook_format': 'company_v1',
          })
          .sort({ committed_at: -1 })
          .limit(20)
          .toArray();
        const found = imported.find(
          (r) =>
            r.committed_at &&
            (r.raw_data as Record<string, unknown>)?.workbook_format === 'company_v1',
        );
        if (!found)
          return fail(
            res,
            'NOT_FOUND',
            'No committed company workbook details for this customer',
            404,
          );
        return res.status(200).json(found.raw_data);
      }
      if (method(req) === 'GET' && path === 'customer/template') {
        const auth = await authorize(req, 'sales.customers', 'create');
        if ('error' in auth) return deny(res, auth);
        return sendFile(
          res,
          'afhomes-customer-application-template.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          customerImportTemplate(),
        );
      }
      if (method(req) === 'GET' && path === 'ist/template') {
        const auth = await authorize(req, 'sales.card_sales', 'create');
        if ('error' in auth) return deny(res, auth);
        return sendFile(
          res,
          'afhomes-ist-agreement-template.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          istImportTemplate(),
        );
      }
      if (method(req) === 'POST' && path === 'import') {
        const auth = await authorize(req, 'sales.customers', 'create');
        if ('error' in auth) return deny(res, auth);
        const parsed = importSchema.safeParse(jsonBody(req));
        if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid form import', 400);
        const fields = parseFormXlsx(
          new Uint8Array(Buffer.from(parsed.data.contentBase64, 'base64')),
        );
        return res.status(200).json(validateFormImport(parsed.data.kind, fields));
      }
      if (method(req) === 'POST' && path === 'pdf') {
        const auth = await authorize(req, 'sales.customers');
        if ('error' in auth) return deny(res, auth);
        const parsed = pdfSchema.safeParse(jsonBody(req));
        if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid form PDF request', 400);
        return sendFile(
          res,
          `${parsed.data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
          'application/pdf',
          officialFormPdf(parsed.data.title, parsed.data.fields, parsed.data.kind),
        );
      }
      if (path === 'customer-applications' && method(req) === 'GET') {
        const auth = await authorize(req, 'sales.customers');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            await listRows(req, res, db, 'customer_applications', session);
          });
        } finally {
          await session.endSession();
        }
      }
      if (path === 'customer-applications' && method(req) === 'POST') {
        const auth = await authorize(req, 'sales.customers', 'create');
        if ('error' in auth) return deny(res, auth);
        const incoming = jsonBody(req) as Record<string, unknown>;
        if (incoming?.registerNewCustomer && incoming?.importContext)
          return fail(
            res,
            'VALIDATION_ERROR',
            'An imported purchase must use its existing linked customer',
            400,
          );

        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const newRegistration = registerCustomerApplicationSchema
              .safeExtend({ requestId: z.string().uuid() })
              .safeParse(jsonBody(req));
            if (newRegistration.success) {
              const {
                primary,
                secondary,
                requestId,
                registerNewCustomer: _mode,
                ...header
              } = newRegistration.data;
              const locations = await resolveHolderLocations(primary, secondary, db, session);
              if ('status' in locations)
                return fail(res, 'VALIDATION_ERROR', locations.message, locations.status);
              const payload = { header, primary, secondary, registerNewCustomer: true };
              const prior = await purchase.replay(
                auth.userId,
                'application.create',
                requestId,
                payload,
                session,
              );
              if (prior)
                return res
                  .status(201)
                  .json(await getApplication(db, String(prior.result_id), session));
              const snapshots = await applicationPlanSnapshot(db, header, secondary, session);
              const customerId = randomUUID();
              const appId = randomUUID();
              const now = new Date().toISOString();

              // Create customer first
              await col('customers').insertOne(
                {
                  _id: customerId,
                  customer_number: await allocatePurchaseId(
                    db,
                    'AF-CUS',
                    'customers',
                    'customer_number',
                    session,
                  ),
                  customer_code: await allocatePurchaseId(
                    db,
                    'AF-CC',
                    'customers',
                    'customer_code',
                    session,
                    8,
                  ),
                  ra_number: await companyId(db, header.raNumber, session, true),
                  first_name: primary.firstName.toUpperCase(),
                  middle_name: primary.middleName?.toUpperCase() ?? null,
                  last_name: primary.lastName.toUpperCase(),
                  suffix: primary.suffix?.toUpperCase() ?? null,
                  email: primary.email.toLowerCase(),
                  phone: primary.mobile,
                  birth_date: primary.birthDate,
                  address: {
                    line1: primary.permanentAddressLine1,
                    line2: primary.permanentAddressLine2,
                    city: primary.cityMunicipality,
                    province: primary.province,
                    barangay: primary.barangay,
                  },
                  status: 'prospect',
                  gender: primary.sex?.toLowerCase() ?? null,
                  landline: primary.landline ?? null,
                  auth_user_id: null,
                  created_at: now,
                  updated_at: now,
                  created_by: auth.userId,
                },
                { session },
              );

              await ensureMongoCustomerVipNumber(db,customerId,header.tier,header.paymentScheme,session);
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
                  customer_id: customerId,
                  plan_id: header.planId,

                  payment_scheme_snapshot: header.paymentScheme,

                  ...snapshots,
                  sales_manager_name:
                    snapshots.sales_manager_name ?? header.salesManagerName ?? null,
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
                  reservation_payment_proof_received:
                    header.reservationPaymentProofReceived ?? false,
                  status: 'draft',
                  created_by: auth.userId,
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
                auth.userId,
                'CUSTOMER_APPLICATION_CREATED',
                'customer_application',
                appId,
                null,
                { customerId },
                undefined,
                session,
              );
              await mirrorApplicationCustomer(
                db,
                customerId,
                header,
                primary,
                secondary,
                snapshots,
                session,
              );
              await purchase.complete(
                auth.userId,
                'application.create',
                requestId,
                payload,
                appId,
                session,
              );
              return res.status(201).json(await getApplication(db, appId, session));
            }

            const parsed = createCustomerApplicationSchema
              .safeExtend({
                requestId: z.string().uuid(),
                importContext: importContinuationRequestSchema
                  .extend({
                    rowId: z.string().uuid(),
                    purchaseReference: z.string().trim().min(1).max(200).optional(),
                  })
                  .optional(),
              })
              .safeParse(jsonBody(req));
            if (!parsed.success)
              return fail(res, 'VALIDATION_ERROR', 'Invalid customer application', 400);

            const { primary, secondary, requestId, importContext, ...header } = parsed.data;
            const locations = await resolveHolderLocations(primary, secondary, db, session);
            if ('status' in locations)
              return fail(res, 'VALIDATION_ERROR', locations.message, locations.status);

            if (importContext) {
              const result = await importSources.commit(
                req,
                importContext.rowId,
                importContext,
                session,
                {
                  data: {
                    header: { ...header, importPurchaseReference: importContext.purchaseReference },
                    primary: locations.primary,
                    secondary: locations.secondary,
                  },
                  create: async () => {
                    const id = await insertMongoApplication(
                      db,
                      auth.userId,
                      header,
                      primary,
                      secondary,
                      locations,
                      session,
                    );
                    const seller = await purchaseSellerFor(
                      db,
                      auth.userId,
                      header.referrerStaffId ?? null,
                      session,
                    );
                    return {
                      id,
                      terms: await purchaseTermsForApplication(
                        db,
                        id,
                        seller,
                        'submission',
                        session,
                      ),
                    };
                  },
                },
              );
              return res.status(201).json(await getApplication(db, result.applicationId!, session));
            }
            const payload = { header, primary, secondary };
            const prior = await purchase.replay(
              auth.userId,
              'application.create',
              requestId,
              payload,
              session,
            );
            if (prior)
              return res
                .status(201)
                .json(await getApplication(db, String(prior.result_id), session));
            const appId = await insertMongoApplication(
              db,
              auth.userId,
              header,
              primary,
              secondary,
              locations,
              session,
            );
            await purchase.complete(
              auth.userId,
              'application.create',
              requestId,
              payload,
              appId,
              session,
            );
            return res.status(201).json(await getApplication(db, appId, session));
          });
        } finally {
          await session.endSession();
        }
      }

      const appGet = route(req, 'GET', /^customer-applications\/([0-9a-fA-F-]+)$/);
      if (appGet) {
        const auth = await authorize(req, 'sales.customers');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const found = await getApplication(db, appGet[1]!.toLowerCase(), session);
            return found
              ? res.status(200).json(found)
              : fail(res, 'NOT_FOUND', 'Customer application not found', 404);
          });
        } finally {
          await session.endSession();
        }
      }
      const appPatch = route(req, 'PATCH', /^customer-applications\/([0-9a-f-]+)$/);
      if (appPatch) {
        const auth = await authorize(req, 'sales.customers', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = createCustomerApplicationSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid customer application', 400);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const before = await getApplication(db, appPatch[1]!, session);
            if (!before) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
            if (before.status !== 'draft')
              return fail(res, 'CONFLICT', 'Only a draft application can be edited', 409);
            const { primary, secondary, requestId: _requestId, ...header } = parsed.data;
            const locations = await resolveHolderLocations(primary, secondary, db, session);
            if ('status' in locations)
              return fail(res, 'VALIDATION_ERROR', locations.message, locations.status);

            const snapshots = await applicationPlanSnapshot(db, header, secondary, session);
            await col('customer_applications').updateOne(
              { _id: appPatch[1] },
              {
                $set: {
                  ...normalizeApplicationHeader(header),

                  payment_scheme_snapshot: header.paymentScheme,

                  ...snapshots,
                  sales_manager_name:
                    snapshots.sales_manager_name ?? header.salesManagerName ?? null,
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
                  reservation_payment_proof_received:
                    header.reservationPaymentProofReceived ?? false,
                  updated_at: new Date().toISOString(),
                },
              },
              { session },
            );

            // Update holders - simplified for brevity
            if (primary) {
              await col('customer_application_holders').updateOne(
                { application_id: appPatch[1], holder_type: 'PRIMARY' },
                {
                  $set: {
                    ...applicationHolderRow(locations.primary),
                    tin_number: primary.tinNumber ?? null,
                  },
                },
                { session, upsert: true },
              );
            }
            if (secondary) {
              await col('customer_application_holders').updateOne(
                { application_id: appPatch[1], holder_type: 'SECONDARY' },
                {
                  $set: {
                    ...applicationHolderRow(locations.secondary ?? {}),
                    tin_number: secondary.tinNumber ?? null,
                  },
                },
                { session, upsert: true },
              );
            } else {
              await col('customer_application_holders').deleteOne(
                { application_id: appPatch[1], holder_type: 'SECONDARY' },
                { session },
              );
            }

            await mirrorApplicationCustomer(
              db,
              header.customerId,
              header,
              primary,
              secondary,
              snapshots,
              session,
            );
            const after = await getApplication(db, appPatch[1]!, session);
            await audit(
              db,
              auth.userId,
              'CUSTOMER_APPLICATION_UPDATED',
              'customer_application',
              appPatch[1]!,
              { status: before.status },
              { status: after?.status },
              undefined,
              session,
            );
            return res.status(200).json(after);
          });
        } finally {
          await session.endSession();
        }
      }

      const appProposal = route(
        req,
        'GET',
        /^customer-applications\/([0-9a-f-]+)\/purchase-terms\/proposal$/,
      );
      if (appProposal) {
        const auth = await authorize(req, 'sales.customers');
        if ('error' in auth) return deny(res, auth);
        const candidate = sellerCandidateQuery(req);
        if (!candidate.ok) return fail(res, 'VALIDATION_ERROR', candidate.message, 400);

        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const app = await col('customer_applications').findOne(
              { _id: appProposal[1] },
              { session },
            );
            if (!app) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
            if (app.created_by !== auth.userId) {
              const updateAuth = await authorize(req, 'sales.customers', 'update');
              if ('error' in updateAuth) return deny(res, updateAuth);
            }
            const sellerId = await purchaseSellerFor(db, auth.userId, candidate.value, session);
            const terms = await purchaseTermsForApplication(
              db,
              appProposal[1],
              sellerId,
              app.status === 'approved' ? 'review' : 'submission',
              session,
            );

            const seller = await col('staff_users').findOne(
              { _id: sellerId },
              { session, projection: { full_name: 1 } },
            );
            return res.status(200).json(
              purchaseTermsProposalSchema.parse({
                ...termsProposal(terms),
                sellerName: seller?.full_name ?? null,
              }),
            );
          });
        } finally {
          await session.endSession();
        }
      }
      const appReview = route(
        req,
        'POST',
        /^customer-applications\/([0-9a-f-]+)\/purchase-terms\/review$/,
      );
      if (appReview) {
        const auth = await authorize(req, 'sales.customers', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = reviewPurchaseTermsSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid purchase terms review', 400);

        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const app = await col('customer_applications').findOne(
              { _id: appReview[1] },
              { session },
            );
            if (!app) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
            const reason = parsed.data.reason?.trim() || null;

            const existing = await mutationResult(
              db,
              auth.userId,
              'purchase_terms.review',
              parsed.data.requestId,
              {
                applicationId: appReview[1],
                expectedProposalHash: parsed.data.expectedProposalHash,
                reason,
                sellerCandidateId: parsed.data.sellerCandidateId ?? null,
              },
              session,
            );
            if (existing)
              return res.status(200).json(await getApplication(db, appReview[1]!, session));

            if (app.status !== 'approved')
              return fail(res, 'CONFLICT', 'Application must be approved', 409);

            const existingReservation = await col('reservation_agreements').findOne(
              { customer_application_id: appReview[1], status: { $ne: 'cancelled' } },
              { session },
            );
            if (existingReservation)
              return fail(res, 'CONFLICT', 'Reservation already exists', 409);

            const sellerId = await purchaseSellerFor(
              db,
              auth.userId,
              parsed.data.sellerCandidateId ?? null,
              session,
            );
            const terms = await purchaseTermsForApplication(
              db,
              appReview[1],
              sellerId,
              'review',
              session,
            );

            const payload = {
              applicationId: appReview[1],
              expectedProposalHash: parsed.data.expectedProposalHash,
              reason,
              sellerCandidateId: parsed.data.sellerCandidateId ?? null,
            };
            const expectedProposalHash = termsProposal(terms).expectedProposalHash;
            if (expectedProposalHash !== parsed.data.expectedProposalHash) {
              return fail(res, 'CONFLICT', 'Purchase proposal changed', 409);
            }

            const termsId = randomUUID();
            const now = new Date().toISOString();
            await col('customer_application_purchase_terms').insertOne(
              {
                _id: termsId,
                application_id: appReview[1],
                customer_id: app.customer_id,
                plan_id: app.plan_id,
                seller_staff_id: sellerId,
                version: terms.version,
                capture_kind: 'review',
                reason,
                captured_by: auth.userId,
                captured_at: now,
                tier: terms.tier,
                payment_scheme: terms.paymentScheme,
                total_price: terms.totalPrice,
                reservation_fee: terms.reservationFee,
                minimum_down_payment: terms.minimumDownPayment,
                required_initial: terms.requiredInitial,
                installment_months: terms.installmentMonths,
                monthly_amount: terms.monthlyAmount,
                spot_cash_days: terms.spotCashDays,
                validity_months: terms.validityMonths,
                discount_percent: terms.discountPercent,
                yearly_points: terms.yearlyPoints,
                annual_points_tranches: terms.annualPointsTranches,
                holder_limit: terms.holderLimit,
                inclusions: terms.inclusions,
                commission_rule_id: terms.commissionRuleId,
                commission_rate: terms.commissionRate,
                commission_base: terms.commissionBase,
                expected_commission: terms.expectedCommission,
              },
              { session },
            );

            await col('customer_applications').updateOne(
              { _id: appReview[1] },
              { $set: { purchase_terms_id: termsId, updated_at: now } },
              { session },
            );

            await audit(
              db,
              auth.userId,
              'PURCHASE_TERMS_REVIEWED',
              'customer_application',
              appReview[1]!,
              reason,
              {
                captureKind: 'review',
                purchaseTermsId: termsId,
                termsVersion: terms.version,
                sellerStaffId: sellerId,
                paymentScheme: terms.paymentScheme,
                totalPrice: terms.totalPrice,
                offerKind: 'newly_confirmed_offer',
              },
              undefined,
              session,
            );

            await completePurchaseMutation(
              db,
              auth.userId,
              'purchase_terms.review',
              parsed.data.requestId,
              payload,
              termsId,
              {
                resultId: termsId,
                status: 'approved',
                purchaseTermsId: termsId,
                termsVersion: terms.version,
              },
              session,
            );

            return res.status(200).json(await getApplication(db, appReview[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const appSubmit = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/submit$/);
      if (appSubmit) {
        const auth = await authorize(req, 'sales.customers', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = submitPurchaseApplicationSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(
            res,
            'VALIDATION_ERROR',
            'A request id and the proposal hash you were shown are required',
            400,
          );

        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const app = await col('customer_applications').findOne(
              { _id: appSubmit[1] },
              { session },
            );
            if (!app) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);

            const existing = await mutationResult(
              db,
              auth.userId,
              'application.submit',
              parsed.data.requestId,
              {
                applicationId: appSubmit[1],
                expectedProposalHash: parsed.data.expectedProposalHash,
                sellerCandidateId: parsed.data.sellerCandidateId ?? null,
              },
              session,
            );
            if (existing) return res.status(200).json(await getApplication(db, existing, session));
            if (app.status !== 'draft')
              return fail(res, 'CONFLICT', 'Invalid application transition', 409);
            if (app.consent_acknowledged !== true || app.primary_signature_status !== 'received')
              return fail(res, 'CONFLICT', 'Application review is incomplete', 409);
            if (
              (await col('customer_application_holders').countDocuments(
                { application_id: app._id, holder_type: 'PRIMARY' },
                { session },
              )) !== 1
            )
              return fail(res, 'CONFLICT', 'Primary holder required', 409);

            const sellerId = await purchaseSellerFor(
              db,
              auth.userId,
              parsed.data.sellerCandidateId ?? null,
              session,
            );
            const terms = await purchaseTermsForApplication(
              db,
              appSubmit[1],
              sellerId,
              'submission',
              session,
            );

            const payload = {
              applicationId: appSubmit[1],
              expectedProposalHash: parsed.data.expectedProposalHash,
              sellerCandidateId: parsed.data.sellerCandidateId ?? null,
            };
            const expectedProposalHash = termsProposal(terms).expectedProposalHash;
            if (expectedProposalHash !== parsed.data.expectedProposalHash) {
              return fail(res, 'CONFLICT', 'Purchase proposal changed', 409);
            }

            const termsId = randomUUID();
            const now = new Date().toISOString();
            await col('customer_application_purchase_terms').insertOne(
              {
                _id: termsId,
                application_id: appSubmit[1],
                customer_id: app.customer_id,
                plan_id: app.plan_id,
                seller_staff_id: sellerId,
                version: terms.version,
                capture_kind: 'submission',
                reason: null,
                captured_by: auth.userId,
                captured_at: now,
                tier: terms.tier,
                payment_scheme: terms.paymentScheme,
                total_price: terms.totalPrice,
                reservation_fee: terms.reservationFee,
                minimum_down_payment: terms.minimumDownPayment,
                required_initial: terms.requiredInitial,
                installment_months: terms.installmentMonths,
                monthly_amount: terms.monthlyAmount,
                spot_cash_days: terms.spotCashDays,
                validity_months: terms.validityMonths,
                discount_percent: terms.discountPercent,
                yearly_points: terms.yearlyPoints,
                annual_points_tranches: terms.annualPointsTranches,
                holder_limit: terms.holderLimit,
                inclusions: terms.inclusions,
                commission_rule_id: terms.commissionRuleId,
                commission_rate: terms.commissionRate,
                commission_base: terms.commissionBase,
                expected_commission: terms.expectedCommission,
              },
              { session },
            );

            await col('customer_applications').updateOne(
              { _id: appSubmit[1] },
              { $set: { purchase_terms_id: termsId } },
              { session },
            );

            // Submit the application (change status to submitted)
            await col('customer_applications').updateOne(
              { _id: appSubmit[1], status: 'draft' },
              { $set: { status: 'submitted', submitted_at: now, updated_at: now } },
              { session },
            );

            await audit(
              db,
              auth.userId,
              'CUSTOMER_APPLICATION_SUBMITTED',
              'customer_application',
              appSubmit[1]!,
              { status: 'draft' },
              {
                status: 'submitted',
                captureKind: 'submission',
                purchaseTermsId: termsId,
                termsVersion: terms.version,
              },
              undefined,
              session,
            );

            await completePurchaseMutation(
              db,
              auth.userId,
              'application.submit',
              parsed.data.requestId,
              payload,
              appSubmit[1]!,
              {
                resultId: appSubmit[1]!,
                status: 'submitted',
                purchaseTermsId: termsId,
                termsVersion: terms.version,
              },
              session,
            );

            return res.status(200).json(await getApplication(db, appSubmit[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const appDecision = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/decision$/);
      if (appDecision) {
        const auth = await authorize(req, 'sales.customers', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = customerApplicationDecisionSchema
          .safeExtend({ requestId: z.string().uuid() })
          .safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid application decision', 400);

        // Approval also creates/executes the reservation, deposit, evidence and audits.
        const session = client.startSession({ defaultTimeoutMS: 45_000 });
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const app = await col('customer_applications').findOne(
              { _id: appDecision[1] },
              { session },
            );
            if (!app) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);

            const { decision } = parsed.data;
            const existing = await mutationResult(
              db,
              auth.userId,
              'application.decide',
              parsed.data.requestId,
              {
                applicationId: appDecision[1],
                decision,
              },
              session,
            );
            if (existing) return res.status(200).json(await getApplication(db, existing, session));
            const allowed = (() => {
              switch (app.status) {
                case 'draft':
                  return decision === 'cancelled';
                case 'submitted':
                  return ['approved', 'rejected', 'cancelled', 'draft'].includes(decision);
                case 'approved':
                  return decision === 'cancelled';
                case 'rejected':
                  return ['draft', 'cancelled'].includes(decision);
                default:
                  return false;
              }
            })();
            if (!allowed) return fail(res, 'CONFLICT', 'Invalid application transition', 409);

            if (decision === 'approved' && !app.purchase_terms_id) {
              return fail(res, 'CONFLICT', 'Purchase terms review required', 409);
            }

            if (decision === 'cancelled') {
              const existingReservation = await col('reservation_agreements').findOne(
                { customer_application_id: appDecision[1], status: { $ne: 'cancelled' } },
                { session },
              );
              if (existingReservation)
                return fail(res, 'CONFLICT', 'Reservation already exists', 409);
            }

            const now = new Date().toISOString();
            const update: Record<string, unknown> = { status: decision, updated_at: now };
            if (['approved', 'rejected'].includes(decision))
              update.submitted_at = app.submitted_at ?? now;
            if (decision === 'approved') update.approved_at = now;
            if (decision === 'rejected') update.rejected_at = now;

            await col('customer_applications').updateOne(
              { _id: appDecision[1] },
              { $set: update },
              { session },
            );

            if (decision === 'approved') {
              const day = now.slice(0, 10),
                reservationId = await purchase.reserve(
                  appDecision[1]!,
                  String(app.purchase_terms_id),
                  auth.userId,
                  { reservationDate: day, agreementDate: day, scheduleNotes: [] },
                  session,
                );
              await purchase.transition(reservationId, 'submit', auth.userId, {}, session);
              await purchase.transition(reservationId, 'execute', auth.userId, {}, session);
              const reservation = await purchase.required(
                'reservation_agreements',
                reservationId,
                session,
              );
              await purchase.record(
                reservationId,
                auth.userId,
                parsed.data.requestId,
                {
                  amount: '10000.00',
                  paymentType: 'down_payment',
                  method: 'cash',
                  reference: `RES-FEE-${reservation.reservation_number}`,
                  notes: 'Automatic reservation fee on application approval',
                },
                session,
              );
            }
            const actionMap: Record<string, string> = {
              draft: 'CUSTOMER_APPLICATION_REOPENED',
              approved: 'CUSTOMER_APPLICATION_APPROVED',
              rejected: 'CUSTOMER_APPLICATION_REJECTED',
              cancelled: 'CUSTOMER_APPLICATION_CANCELLED',
            };
            await audit(
              db,
              auth.userId,
              actionMap[decision],
              'customer_application',
              appDecision[1]!,
              { status: app.status },
              {
                status: decision,
                purchaseTermsId: app.purchase_terms_id,
              },
              undefined,
              session,
            );

            await completePurchaseMutation(
              db,
              auth.userId,
              'application.decide',
              parsed.data.requestId,
              {
                applicationId: appDecision[1],
                decision,
              },
              appDecision[1]!,
              {
                resultId: appDecision[1]!,
                status: decision,
                purchaseTermsId: app.purchase_terms_id,
              },
              session,
            );

            return res.status(200).json(await getApplication(db, appDecision[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const appReopen = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/reopen$/);
      if (appReopen) {
        const auth = await authorize(req, 'sales.customers', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = z.object({ requestId: z.string().uuid() }).safeParse(jsonBody(req));
        if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'A request id is required', 400);

        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const app = await col('customer_applications').findOne(
              { _id: appReopen[1] },
              { session },
            );
            if (!app) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
            if (app.status !== 'submitted')
              return fail(res, 'CONFLICT', 'Only submitted applications can be reopened', 409);

            const existing = await mutationResult(
              db,
              auth.userId,
              'application.decide',
              parsed.data.requestId,
              {
                applicationId: appReopen[1],
                decision: 'draft',
              },
              session,
            );
            if (existing) return res.status(200).json(await getApplication(db, existing, session));

            const now = new Date().toISOString();
            await col('customer_applications').updateOne(
              { _id: appReopen[1] },
              { $set: { status: 'draft', updated_at: now } },
              { session },
            );

            await audit(
              db,
              auth.userId,
              'CUSTOMER_APPLICATION_REOPENED',
              'customer_application',
              appReopen[1]!,
              { status: app.status },
              { status: 'draft' },
              undefined,
              session,
            );

            await completePurchaseMutation(
              db,
              auth.userId,
              'application.decide',
              parsed.data.requestId,
              {
                applicationId: appReopen[1],
                decision: 'draft',
              },
              appReopen[1]!,
              {
                resultId: appReopen[1]!,
                status: 'draft',
                purchaseTermsId: app.purchase_terms_id,
              },
              session,
            );

            return res.status(200).json(await getApplication(db, appReopen[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const appExport = route(
        req,
        'GET',
        /^customer-applications\/([0-9a-f-]+)\/export\/(xlsx|pdf)$/,
      );
      if (appExport) {
        const auth = await authorize(req, 'sales.customers');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const app = await getApplication(db, appExport[1]!, session);
            if (!app) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
            const fields = applicationFields(app);
            return appExport[2] === 'xlsx'
              ? sendFile(
                  res,
                  `${app.applicationNumber}.xlsx`,
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  customerApplicationXlsx(fields),
                )
              : sendFile(
                  res,
                  `${app.applicationNumber}.pdf`,
                  'application/pdf',
                  officialFormPdf(
                    'VIP PRIVILEGE CARD APPLICATION FORM',
                    fields,
                    'customer_application',
                  ),
                );
          });
        } finally {
          await session.endSession();
        }
      }

      if (path === 'reservations' && method(req) === 'GET') {
        const auth = await authorize(req, 'sales.card_sales');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            await listRows(req, res, db, 'reservation_agreements', session);
          });
        } finally {
          await session.endSession();
        }
      }
      if (path === 'reservations' && method(req) === 'POST') {
        const auth = await authorize(req, 'sales.card_sales', 'create');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const applicationOrigin = purchaseReservationCreateSchema.safeParse(jsonBody(req));
            if (applicationOrigin.success && applicationOrigin.data.origin === 'application') {
              const { requestId, customerApplicationId, purchaseTermsId, ...input } =
                applicationOrigin.data;
              const payload = { applicationId: customerApplicationId, purchaseTermsId, input };
              const prior = await purchase.replay(
                auth.userId,
                'reservation.create',
                requestId,
                payload,
                session,
              );
              if (prior)
                return res
                  .status(201)
                  .json(await getAgreement(db, String(prior.result_id), session));
              const app = await purchase.required(
                'customer_applications',
                customerApplicationId,
                session,
              );
              if (app.created_by !== auth.userId) {
                const oversight = await authorize(req, 'sales.card_sales', 'update');
                if ('error' in oversight) return deny(res, oversight);
              }
              await purchaseSellerFor(
                db,
                auth.userId,
                String(
                  (
                    await purchase.required(
                      'customer_application_purchase_terms',
                      purchaseTermsId,
                      session,
                    )
                  ).seller_staff_id,
                ),
                session,
              );
              const id = await purchase.reserve(
                customerApplicationId,
                purchaseTermsId,
                auth.userId,
                input,
                session,
              );
              await purchase.complete(
                auth.userId,
                'reservation.create',
                requestId,
                payload,
                id,
                session,
              );
              return res.status(201).json(await getAgreement(db, id, session));
            }
            const legacy = createReservationAgreementSchema.safeParse(jsonBody(req));
            if (!legacy.success || !legacy.data.saleId)
              return fail(
                res,
                'VALIDATION_ERROR',
                'A valid sale-origin reservation is required',
                400,
              );
            if (
              !(await authorizeAgreementSale(req, res, db, legacy.data.saleId, authorize, session))
            )
              return;
            const { requestId, ...input } = legacy.data,
              payload = { input };
            const key = requestId ?? purchaseRequestId(req);
            const prior = await purchase.replay(
              auth.userId,
              'reservation.sale.create',
              key,
              payload,
              session,
            );
            const id = prior
              ? String(prior.result_id)
              : await purchase.saveSaleAgreement(null, auth.userId, input, session);
            if (!prior)
              await purchase.complete(
                auth.userId,
                'reservation.sale.create',
                key,
                payload,
                id,
                session,
              );
            return res.status(201).json(await getAgreement(db, id, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementGet = route(req, 'GET', /^reservations\/([0-9a-f-]+)$/);
      if (agreementGet) {
        const auth = await authorize(req, 'sales.card_sales');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const found = await getAgreement(db, agreementGet[1]!, session);
            return found
              ? res.status(200).json(found)
              : fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementPatch = route(req, 'PATCH', /^reservations\/([0-9a-f-]+)$/);
      if (agreementPatch) {
        const auth = await authorize(req, 'sales.card_sales');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const before = await getAgreement(db, agreementPatch[1]!, session);
            if (!before) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
            const authorized = await authorizeAgreementMutation(
              req,
              res,
              db,
              before,
              authorize,
              session,
            );
            if (!authorized) return;

            if (before.origin === 'application') {
              // Application-origin: use transition_purchase_reservation_once with action 'save'
              const parsed = purchaseReservationUpdateSchema.safeParse(jsonBody(req));
              if (!parsed.success)
                return fail(res, 'VALIDATION_ERROR', 'Invalid reservation agreement update', 400);
              const { requestId, ...input } = parsed.data;
              const payload = { reservationId: agreementPatch[1], action: 'save', input };
              if (
                !(await purchase.replay(
                  auth.userId,
                  'reservation.transition',
                  requestId,
                  payload,
                  session,
                ))
              ) {
                await purchase.transition(agreementPatch[1]!, 'save', auth.userId, input, session);
                await purchase.complete(
                  auth.userId,
                  'reservation.transition',
                  requestId,
                  payload,
                  agreementPatch[1]!,
                  session,
                );
              }
              return res.status(200).json(await getAgreement(db, agreementPatch[1]!, session));
            } else {
              // Legacy sale-origin: use save_reservation_agreement
              const parsed = createReservationAgreementSchema.safeParse(jsonBody(req));
              if (!parsed.success || !parsed.data.saleId)
                return fail(
                  res,
                  'VALIDATION_ERROR',
                  'A valid sale-origin reservation is required',
                  400,
                );
              if (
                !(await authorizeAgreementSale(
                  req,
                  res,
                  db,
                  parsed.data.saleId,
                  authorize,
                  session,
                ))
              )
                return;
              await purchase.saveSaleAgreement(
                agreementPatch[1]!,
                auth.userId,
                parsed.data,
                session,
              );
              return res.status(200).json(await getAgreement(db, agreementPatch[1]!, session));
            }
          });
        } finally {
          await session.endSession();
        }
      }

      const agreementSubmit = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/submit$/);
      if (agreementSubmit) {
        const auth = await authorize(req, 'sales.card_sales', 'create');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const before = await getAgreement(db, agreementSubmit[1]!, session);
            if (!before) return fail(res, 'NOT_FOUND', 'Reservation not found', 404);
            if (!(await authorizeAgreementMutation(req, res, db, before, authorize, session)))
              return;
            const action = 'submit',
              requestId = purchaseRequestId(req),
              payload = { reservationId: agreementSubmit[1], action, input: {} };
            if (
              !(await purchase.replay(
                auth.userId,
                'reservation.transition',
                requestId,
                payload,
                session,
              ))
            ) {
              await purchase.transition(agreementSubmit[1]!, action, auth.userId, {}, session);
              await purchase.complete(
                auth.userId,
                'reservation.transition',
                requestId,
                payload,
                agreementSubmit[1]!,
                session,
              );
            }
            return res.status(200).json(await getAgreement(db, agreementSubmit[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementDecision = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/decision$/);
      if (agreementDecision) {
        const auth = await authorize(req, 'sales.card_sales', 'create');
        if ('error' in auth) return deny(res, auth);
        const parsed = reservationAgreementDecisionSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid agreement decision', 400);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const before = await getAgreement(db, agreementDecision[1]!, session);
            if (!before) return fail(res, 'NOT_FOUND', 'Reservation not found', 404);
            if (!(await authorizeAgreementMutation(req, res, db, before, authorize, session)))
              return;
            const action = parsed.data.decision === 'executed' ? 'execute' : 'cancel',
              requestId = purchaseRequestId(req),
              payload = { reservationId: agreementDecision[1], action, input: {} };
            if (
              !(await purchase.replay(
                auth.userId,
                'reservation.transition',
                requestId,
                payload,
                session,
              ))
            ) {
              await purchase.transition(agreementDecision[1]!, action, auth.userId, {}, session);
              await purchase.complete(
                auth.userId,
                'reservation.transition',
                requestId,
                payload,
                agreementDecision[1]!,
                session,
              );
            }
            return res.status(200).json(await getAgreement(db, agreementDecision[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementReopen = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/reopen$/);
      if (agreementReopen) {
        const auth = await authorize(req, 'sales.card_sales', 'create');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const before = await getAgreement(db, agreementReopen[1]!, session);
            if (!before) return fail(res, 'NOT_FOUND', 'Reservation not found', 404);
            if (!(await authorizeAgreementMutation(req, res, db, before, authorize, session)))
              return;
            const action = 'reopen',
              requestId = purchaseRequestId(req),
              payload = { reservationId: agreementReopen[1], action, input: {} };
            if (
              !(await purchase.replay(
                auth.userId,
                'reservation.transition',
                requestId,
                payload,
                session,
              ))
            ) {
              await purchase.transition(agreementReopen[1]!, action, auth.userId, {}, session);
              await purchase.complete(
                auth.userId,
                'reservation.transition',
                requestId,
                payload,
                agreementReopen[1]!,
                session,
              );
            }
            return res.status(200).json(await getAgreement(db, agreementReopen[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementPayments = route(req, 'GET', /^reservations\/([0-9a-f-]+)\/payments$/);
      if (agreementPayments) {
        const auth = await authorize(req, 'finance.payment_verification');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const agreement = await getAgreement(db, agreementPayments[1]!, session);
            if (!agreement) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
            if (agreement.origin !== 'application')
              return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
            const col = (name: string) => db.collection<MongoRow>(name);
            const payments = await col('payments')
              .find({ reservation_id: agreementPayments[1]! }, { session })
              .sort({ recorded_at: -1 })
              .toArray();
            return list(
              res,
              payments.map((p) => shapePayment(p)),
            );
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementRecordPayment = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/payments$/);
      if (agreementRecordPayment) {
        const auth = await authorize(req, 'finance.payment_verification', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = recordPurchasePaymentSchema.safeParse(jsonBody(req));
        if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid payment', 400);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const { requestId, ...input } = parsed.data;
            await purchase.record(
              agreementRecordPayment[1]!,
              auth.userId,
              requestId,
              input,
              session,
            );
            return res
              .status(201)
              .json(await agreementFinanceSummary(db, agreementRecordPayment[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const paymentVerify = route(
        req,
        'POST',
        /^reservations\/([0-9a-f-]+)\/payments\/([0-9a-f-]+)\/verify$/,
      );
      if (paymentVerify) {
        const auth = await authorize(req, 'finance.payment_verification', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = verifyPurchasePaymentSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid verification decision', 400);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            await purchase.verify(
              paymentVerify[1]!,
              paymentVerify[2]!,
              auth.userId,
              parsed.data.requestId,
              parsed.data.decision,
              parsed.data.reason,
              session,
            );
            return res
              .status(200)
              .json(await agreementFinanceSummary(db, paymentVerify[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementFinalize = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/finalize$/);
      if (agreementFinalize) {
        const auth = await authorize(req, 'finance.payment_verification', 'update');
        if ('error' in auth) return deny(res, auth);
        const parsed = finalizeReservationPurchaseSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid finalization request', 400);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const saleId = await purchase.finalize(
              agreementFinalize[1]!,
              auth.userId,
              parsed.data.requestId,
              session,
            );
            return res
              .status(200)
              .json({ saleId, reservationId: agreementFinalize[1], activationRequired: true });
          });
        } finally {
          await session.endSession();
        }
      }
      const agreementFinance = route(req, 'GET', /^reservations\/([0-9a-f-]+)\/finance$/);
      if (agreementFinance) {
        const auth = await authorize(req, 'finance.payment_verification');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const agreement = await getAgreement(db, agreementFinance[1]!, session);
            if (!agreement) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
            if (agreement.origin !== 'application')
              return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
            return res
              .status(200)
              .json(await agreementFinanceSummary(db, agreementFinance[1]!, session));
          });
        } finally {
          await session.endSession();
        }
      }
      const documentExport = route(
        req,
        'GET',
        /^reservations\/([0-9a-f-]+)\/documents\/(reservation|payment_recorded|payment_verified|purchase_finalized|membership_activated)\/(\d+|latest)$/,
      );
      if (documentExport) {
        const kind = documentExport[2]! as PurchaseDocumentKind;
        const auth = await authorize(req, documentModule(kind));
        if ('error' in auth) return deny(res, auth);
        const revision = documentExport[3] === 'latest' ? null : Number(documentExport[3]);

        const evidence = await col('purchase_document_evidence').findOne(
          { kind, source_id: documentExport[1], ...(revision !== null ? { revision } : {}) },
          { sort: { revision: -1 } },
        );
        const envelope: PurchaseDocumentEvidence = evidence
          ? {
              kind,
              sourceId: documentExport[1]!,
              evidenceAvailable: true,
              revision: Number(evidence.revision),
              schemaVersion: Number(evidence.schema_version),
              actor: String(evidence.actor_id),
              capturedAt: String(evidence.captured_at),
              fields: evidence.fields as Record<string, unknown>,
            }
          : {
              kind,
              sourceId: documentExport[1]!,
              evidenceAvailable: false,
              revision,
              unavailableReason: 'LEGACY_RECORD_WITHOUT_CAPTURED_EVIDENCE',
            };
        const bytes = purchaseDocumentPdf(envelope);
        res.setHeader('Cache-Control', 'no-store');
        return sendFile(res, purchaseDocumentFilename(kind), 'application/pdf', bytes);
      }
      const agreementExport = route(req, 'GET', /^reservations\/([0-9a-f-]+)\/export\/(xlsx|pdf)$/);
      if (agreementExport) {
        const auth = await authorize(req, 'sales.card_sales');
        if ('error' in auth) return deny(res, auth);
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            await serialize(session);
            const agreement = await getAgreement(db, agreementExport[1]!, session);
            if (!agreement) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
            const first = agreement.schedule[0] as
              { particular?: string; amount?: string; paymentDate?: string } | undefined;
            const primary = (agreement.primary ?? {}) as Record<string, string>;
            const secondary = (agreement.secondary ?? null) as Record<string, string> | null;
            const fields: Record<string, string> = {
              sale_id: String(agreement.saleId),
              customer_application_id: String(agreement.customerApplicationId ?? ''),
              vip_tier: String(agreement.tier),
              reservation_date: String(agreement.reservationDate),
              agreement_date: String(agreement.agreementDate),
              revision_number: String(agreement.revisionNumber ?? ''),
              monthly_amortization_start: String(agreement.monthlyAmortizationStart ?? ''),
              monthly_amortization_end: String(agreement.monthlyAmortizationEnd ?? ''),
              payment_due_day: String(agreement.paymentDueDay ?? ''),
              primary_name: String(primary.name ?? ''),
              primary_address: String(primary.address ?? ''),
              primary_contact_number: String(primary.contactNumber ?? ''),
              primary_email: String(primary.email ?? ''),
              primary_tin: String(primary.tinNumber ?? ''),
              secondary_enabled: String(Boolean(secondary)),
              secondary_name: String(secondary?.name ?? ''),
              secondary_address: String(secondary?.address ?? ''),
              secondary_contact_number: String(secondary?.contactNumber ?? ''),
              secondary_email: String(secondary?.email ?? ''),
              secondary_tin: String(secondary?.tinNumber ?? ''),
              schedule_particular: String(first?.particular ?? ''),
              schedule_amount: String(first?.amount ?? ''),
              schedule_payment_date: String(first?.paymentDate ?? ''),
              payment_dates: agreement.schedule
                .map((line) => String(line.paymentDate ?? ''))
                .join('|'),
            };
            return agreementExport[2] === 'xlsx'
              ? sendFile(
                  res,
                  `${agreement.reservationNumber}.xlsx`,
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  reservationAgreementXlsx(fields),
                )
              : sendFile(
                  res,
                  `${agreement.reservationNumber}.pdf`,
                  'application/pdf',
                  officialFormPdf(
                    `${agreement.tier} VIP PRIVILEGE CARD RESERVATION AGREEMENT`,
                    {
                      ...fields,
                      tier: String(agreement.tier),
                      total_price: String(agreement.totalPrice),
                      reservation_fee: String(agreement.reservationFee),
                      verified_payments: String(agreement.totalPaymentReceived),
                      balance: String(agreement.balance),
                      official_inclusions: JSON.stringify(agreement.inclusions),
                    },
                    'reservation_agreement',
                  ),
                );
          });
        } finally {
          await session.endSession();
        }
      }
      return fail(res, 'NOT_FOUND', 'Official form endpoint not found', 404);
    } catch (error) {
      if (error instanceof FormRefusal) throw error;
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 404 ? 'NOT_FOUND' : 'CONFLICT',
          error.message,
          error.status,
        );
      if (
        error instanceof Error &&
        error.constructor === Error &&
        /^[A-Z][A-Z0-9_]+$/.test(error.message)
      )
        return fail(res, 'CONFLICT', error.message.replace(/_/g, ' '), 409);

      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        return mapMongoError(
          res,
          error as { message?: string; code?: number; keyValue?: Record<string, unknown> },
        );
      return fail(res, 'INTERNAL', 'Service is unavailable', 503);
    }
  };
  return async (req: VercelRequest, response: VercelResponse) => {
    let status = 200,
      body: unknown,
      hasBody = false;
    const headers = new Map<string, string | string[]>();
    const buffered: VercelResponse = {
      setHeader: (name, value) => {
        headers.set(name, value);
      },
      status: (value) => {
        status = value;
        return buffered;
      },
      json: (value) => {
        if (status >= 400) throw new FormRefusal(status, value);
        body = value;
        hasBody = true;
      },
      end: () => {},
    };
    try {
      await handler(req, buffered);
    } catch (error) {
      if (!(error instanceof FormRefusal)) throw error;
      status = error.status;
      body = error.body;
      hasBody = true;
    }
    for (const [name, value] of headers) response.setHeader(name, value);
    response.status(status);
    if (hasBody) response.json(body);
    else response.end();
  };
}
class FormRefusal extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super('Official form request refused');
  }
}
