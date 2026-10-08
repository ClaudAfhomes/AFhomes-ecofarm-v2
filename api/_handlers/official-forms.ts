import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { currentIdForSubject } from './documents.js';
import { governmentIdTypeSchema } from '@afhomes/contracts';
import {
  canTransitionReservationAgreement,
  createCustomerApplicationSchema,
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
} from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import { toErrorEnvelope } from '../_lib/envelope.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  list,
  mapRpcError,
  method,
  route,
  subPath,
  type Db,
} from '../_lib/handler-kit.js';
import {
  customerApplicationXlsx,
  customerImportTemplate,
  istImportTemplate,
  officialFormPdf,
  parseFormXlsx,
  reservationAgreementXlsx,
  validateFormImport,
} from '../_lib/official-forms.js';
import {
  purchaseDocumentFilename,
  purchaseDocumentPdf,
  type PurchaseDocumentEvidence,
  type PurchaseDocumentKind,
} from '../_lib/purchase-documents.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

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

/**
 * Normalize the optional holder/header text the schemas validate but leave
 * untransformed (required fields are already normalized by the schemas).
 * Spreads preserve key presence exactly: null/undefined/blank pass through.
 */
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
  ...(header.vipRecommenderName
    ? { vipRecommenderName: normalizePersonName(header.vipRecommenderName) }
    : {}),
  ...(header.vipReferrer ? { vipReferrer: normalizePersonName(header.vipReferrer) } : {}),
});

const shapeApplicationHolder = (row: Record<string, unknown>) => ({
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

async function getApplication(db: Db, id: string) {
  const { data, error } = await db
    .from('customer_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: holders, error: holderError } = await db
    .from('customer_application_holders')
    .select('*')
    .eq('application_id', id)
    .order('holder_type');
  if (holderError) throw holderError;
  const row = data as Record<string, unknown>;
  const rows = (holders ?? []) as Record<string, unknown>[];
  const primary = rows.find((value) => value.holder_type === 'PRIMARY');
  const secondary = rows.find((value) => value.holder_type === 'SECONDARY');
  return {
    id: row.id,
    applicationNumber: row.application_number,
    // Which frozen terms record this application points at. Null is the honest
    // "review required" state the UI keys off.
    purchaseTermsId: row.purchase_terms_id ?? null,
    customerId: row.customer_id,
    saleId: row.sale_id ?? undefined,
    planId: row.plan_id,
    tier: row.tier_snapshot,
    paymentScheme: row.payment_scheme_snapshot,
    vipAmount: row.vip_amount_snapshot,
    discountPercent: row.discount_percent_snapshot,
    validityYears: row.validity_years_snapshot,
    yearlyPoints: row.yearly_points_snapshot,
    annualPointsTranches: row.annual_points_tranches_snapshot,
    holderLimit: row.holder_limit_snapshot,
    primary: primary ? shapeApplicationHolder(primary) : null,
    secondary: secondary ? shapeApplicationHolder(secondary) : undefined,
    salesManagerName: row.sales_manager_name ?? undefined,
    vipRecommenderName: row.vip_recommender_name ?? undefined,
    recommenderContact: row.recommender_contact ?? undefined,
    recommenderEmail: row.recommender_email ?? undefined,
    vipReferrer: row.vip_referrer ?? undefined,
    acquisitionChannels: row.acquisition_channels ?? [],
    consentAcknowledged: row.consent_acknowledged === true,
    acknowledgedAt: row.acknowledged_at,
    primarySignatureStatus: row.primary_signature_status,
    secondarySignatureStatus: row.secondary_signature_status ?? undefined,
    validIdReceived: row.valid_id_received === true,
    reservationPaymentProofReceived: row.reservation_payment_proof_received === true,
    status: row.status,
    createdBy: row.created_by,
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
    submittedAt: isoOrNull(row.submitted_at),
    approvedAt: isoOrNull(row.approved_at),
    rejectedAt: isoOrNull(row.rejected_at),
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
    acknowledgement_date: String(app.acknowledgedAt),
    primary_signature_status: String(app.primarySignatureStatus),
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

async function getAgreement(db: Db, id: string) {
  const { data, error } = await db
    .from('reservation_agreements')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const holderResult = await db
    .from('reservation_agreement_holders')
    .select('*')
    .eq('agreement_id', id)
    .order('holder_type');
  const scheduleResult = await db
    .from('reservation_agreement_schedule')
    .select('*')
    .eq('agreement_id', id)
    .order('line_number');
  if (holderResult.error) throw holderResult.error;
  if (scheduleResult.error) throw scheduleResult.error;
  const row = data as Record<string, unknown>;
  const holders = ((holderResult.data ?? []) as Record<string, unknown>[]).map((h) => ({
    holderType: h.holder_type,
    name: h.name,
    address: h.address,
    contactNumber: h.contact_number,
    email: h.email,
    tinNumber: h.tin_number ?? undefined,
  }));
  return {
    id: row.id,
    reservationNumber: row.reservation_number,
    revisionNumber: row.revision_number ?? undefined,
    reservationDate: row.reservation_date,
    agreementDate: row.agreement_date,
    // `origin` is the discriminator the purchase-flow contracts key on. Legacy
    // sale-origin rows carry the column default, so both modes read the same.
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
    primarySignatureStatus: row.primary_signature_status,
    secondarySignatureStatus: row.secondary_signature_status ?? undefined,
    primary: holders.find((h) => h.holderType === 'PRIMARY') ?? null,
    secondary: holders.find((h) => h.holderType === 'SECONDARY'),
    schedule: ((scheduleResult.data ?? []) as Record<string, unknown>[]).map((line) => ({
      lineNumber: line.line_number,
      particular: line.particular,
      amount: line.amount_snapshot,
      paymentDate: line.payment_date ?? undefined,
      remarks: line.remarks ?? undefined,
    })),
    status: row.status,
    createdBy: row.created_by,
    createdAt: isoOrNull(row.created_at) ?? '',
    updatedAt: isoOrNull(row.updated_at) ?? '',
    submittedAt: isoOrNull(row.submitted_at),
    executedAt: isoOrNull(row.executed_at),
  };
}

async function listRows(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  table: 'customer_applications' | 'reservation_agreements',
) {
  const parsed = officialFormListQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid list query', 400);
  const q = parsed.data;
  let query = db.from(table).select('*', { count: 'exact' });
  if (q.status) query = query.eq('status', q.status);
  if (q.tier) query = query.eq('tier_snapshot', q.tier);
  if (q.seller) query = query.eq('created_by', q.seller);
  if (q.from) query = query.gte('created_at', q.from);
  if (q.to) query = query.lte('created_at', `${q.to}T23:59:59.999Z`);
  if (q.search)
    query = query.ilike(
      table === 'customer_applications' ? 'application_number' : 'reservation_number',
      `%${q.search.replace(/[%_,]/g, '')}%`,
    );
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  // Attach the primary holder display name so list screens can show the
  // applicant without a second round-trip. Detail rows remain authoritative.
  if (table === 'customer_applications' && rows.length) {
    const ids = rows.map((row) => String(row.id));
    const { data: holders, error: holderError } = await db
      .from('customer_application_holders')
      .select('application_id,first_name,last_name')
      .in('application_id', ids)
      .eq('holder_type', 'PRIMARY');
    if (holderError) throw holderError;
    const names = new Map(
      ((holders ?? []) as Record<string, unknown>[]).map((holder) => [
        String(holder.application_id),
        `${String(holder.first_name ?? '')} ${String(holder.last_name ?? '')}`.trim(),
      ]),
    );
    for (const row of rows) row.applicant_name = names.get(String(row.id)) ?? null;
  }
  if (table === 'reservation_agreements' && rows.length) {
    const ids = rows.map((row) => String(row.id));
    const { data: holders, error: holderError } = await db
      .from('reservation_agreement_holders')
      .select('agreement_id,name,holder_type')
      .in('agreement_id', ids);
    if (holderError) throw holderError;
    const names = new Map<string, string>();
    const secondaryAgreements = new Set<string>();
    for (const holder of (holders ?? []) as Record<string, unknown>[])
      if (String(holder.holder_type) === 'PRIMARY')
        names.set(String(holder.agreement_id), String(holder.name ?? ''));
      else if (String(holder.holder_type) === 'SECONDARY')
        secondaryAgreements.add(String(holder.agreement_id));
    for (const row of rows) {
      row.applicant_name = names.get(String(row.id)) ?? null;
      row.has_secondary_holder = secondaryAgreements.has(String(row.id));
    }
  }
  return res.status(200).json({
    data: rows,
    meta: { total: count ?? rows.length, limit: q.limit, offset: q.offset },
  });
}

const APPLICABLE_DECISION_AUDIT: Record<string, string> = {
  executed: 'RESERVATION_AGREEMENT_EXECUTED',
};

/**
 * Optional `sellerCandidateId` query parameter.
 *
 * It is a REQUEST for who the operator wants to sell for, never an assertion:
 * the RPC re-resolves the seller against the actor's downline and the target's
 * role/status. A present-but-malformed value is refused rather than ignored,
 * so a typo can never silently fall back to "me".
 */
/**
 * The module that authorizes a document kind.
 *
 * Payment and purchase documents follow the money; the activation confirmation
 * follows the card. Each is mapped once, so a new kind cannot inherit the wrong
 * permission by being added next to an existing route.
 */
function documentModule(kind: PurchaseDocumentKind): Parameters<typeof authorizeAfHomes>[1] {
  return kind === 'membership_activated'
    ? 'finance.card_activation'
    : kind === 'reservation'
      ? 'sales.card_sales'
      : 'finance.payment_verification';
}

/** One payments row in API field names, for either source. */
function shapePayment(row: Record<string, unknown>) {
  return {
    origin: (row.origin as string | undefined) ?? 'sale',
    id: row.id,
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

/**
 * Server-authoritative money state for a reservation-origin purchase.
 *
 * Every figure comes from the `purchase_financial_summary` RPC, which reads the
 * FROZEN terms and the payment rows. No total is computed here, and nothing on
 * the browser can influence one: the only request fields are a request id and the
 * amount being recorded.
 */
async function agreementFinanceSummary(db: Db, id: string) {
  const { data, error } = await db.rpc('purchase_financial_summary', { p_source_id: id });
  if (error) throw error;
  const summary = data as Record<string, unknown> | null;
  if (!summary) throw new Error('RESERVATION_FINANCE_SUMMARY_MISSING');
  const [application, customer, seller, payments] = await Promise.all([
    db
      .from('customer_applications')
      .select('application_number, status')
      .eq('id', String(summary.customerApplicationId))
      .maybeSingle(),
    db
      .from('customers')
      .select('first_name, middle_name, last_name, suffix')
      .eq('id', String(summary.customerId))
      .maybeSingle(),

    db
      .from('staff_users')
      .select('full_name')
      .eq('id', String(summary.sellerStaffId))
      .maybeSingle(),
    db
      .from('payments')
      .select('*')
      .eq('reservation_id', id)
      .order('recorded_at', { ascending: false }),
  ]);
  for (const result of [application, customer, seller, payments]) {
    if (result.error) throw result.error;
  }
  const name = (customer.data ?? {}) as Record<string, unknown>;
  const applicationRow = (application.data ?? {}) as Record<string, unknown>;
  return {
    reservationId: summary.reservationId,
    reservationNumber: summary.reservationNumber,
    customerApplicationId: summary.customerApplicationId,
    applicationNumber: String(applicationRow.application_number ?? ''),
    applicationStatus: applicationRow.status ?? 'approved',
    purchaseTermsId: summary.purchaseTermsId,
    sellerStaffId: summary.sellerStaffId,
    sellerName: String((seller.data as Record<string, unknown> | null)?.full_name ?? ''),
    tier: summary.tier,
    customerId: summary.customerId,
    customerName:
      [name.first_name, name.middle_name, name.last_name, name.suffix]
        .filter((part) => typeof part === 'string' && part)
        .join(' ') || 'Unknown customer',
    productName: `VIP ${String(summary.tier)}`,
    status: summary.status,
    paymentScheme: summary.paymentScheme,
    totalPrice: summary.totalPrice,
    reservationFee: summary.reservationFee,
    requiredInitial: summary.requiredInitial,
    installmentMonths: summary.installmentMonths,
    monthlyAmount: summary.monthlyAmount,
    validityMonths: summary.validityMonths,

    verifiedTotal: summary.verifiedTotal,

    remainingBalance: summary.remainingBalance,
    overpaidAmount: summary.overpaidAmount,
    fullyPaid: summary.fullyPaid,
    recordedPaymentCount: summary.recordedPaymentCount,
    firstVerifiedPayment: isoOrNull(summary.firstVerifiedPayment),
    spotCashDeadline: isoOrNull(summary.spotCashDeadline),
    saleId: summary.saleId,
    payments: (payments.data ?? []).map((row: Record<string, unknown>) => shapePayment(row)),
  };
}
/**
 * The request identity for an application-origin reservation transition.
 *
 * A caller that sends one gets exact retry semantics; a caller that sends none
 * still gets a stable id for the length of this request, so the legacy bodies
 * (which predate request identities) keep working without inventing a new field
 * they cannot satisfy. The domain guards in SQL remain authoritative either way.
 */
function purchaseRequestId(req: VercelRequest): string {
  const body = jsonBody(req) as { requestId?: unknown } | undefined;
  return typeof body?.requestId === 'string' && z.string().uuid().safeParse(body.requestId).success
    ? body.requestId
    : randomUUID();
}

function sellerCandidateQuery(req: VercelRequest):
  | { ok: true; value: string | null }
  | {
      ok: false;
      message: string;
    } {
  const raw = req.query.sellerCandidateId;
  if (raw === undefined || raw === '') return { ok: true, value: null };
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, message: 'sellerCandidateId must be a single UUID' };
}

async function transitionAgreementStatus(
  db: Db,
  authUserId: string,
  id: string,
  to: ReservationAgreementStatus,
) {
  const { data, error } = await db
    .from('reservation_agreements')
    .select('id,status,submitted_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { status: ReservationAgreementStatus; submitted_at: string | null };
  if (!canTransitionReservationAgreement(row.status, to)) {
    const conflict = new Error(
      `INVALID_AGREEMENT_TRANSITION: cannot move from ${row.status} to ${to}`,
    );
    (conflict as { code?: string }).code = 'INVALID_AGREEMENT_TRANSITION';
    throw conflict;
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, updated_at: now };
  if (to === 'executed') {
    patch.submitted_at = row.submitted_at ?? now;
    patch.executed_at = now;
  }
  const { error: writeError } = await db.from('reservation_agreements').update(patch).eq('id', id);
  if (writeError) throw writeError;
  await audit(
    db,
    authUserId,
    to === 'draft'
      ? 'RESERVATION_AGREEMENT_REOPENED'
      : (APPLICABLE_DECISION_AUDIT[to] ?? 'RESERVATION_AGREEMENT_UPDATED'),
    'reservation_agreement',
    id,
    { status: row.status },
    { status: to },
  );
  return true;
}

/**
 * D2 seller-scoped mutation gate for reservation agreements.
 *
 * Baseline reality: selling roles (VD/SSM/SM/OST) hold `sales.card_sales`
 * view+create but NOT update, so gating draft edits, submit, execute, cancel
 * and reopen on `update` made the whole seller IST workflow impossible (only
 * super_admin could complete one). EXECUTE here means the seller finalizes the
 * reservation contract (terminal status, signatures collected) - it moves no
 * money and grants no financial approval, so the owning seller may perform it.
 *
 * Rule (narrowest existing vocabulary, no new modules):
 * - the caller must hold `sales.card_sales` create (employees and anonymous
 *   callers are refused here, before any row is read);
 * - then either the caller owns the agreement (`created_by`), or the caller
 *   holds `sales.card_sales` update for cross-cutting oversight (today only
 *   super_admin, implicitly; a future role can be granted update without a
 *   code change). No other permission confers access, so one seller can never
 *   touch another seller's agreement through a side permission.
 * Returns the principal on allow, otherwise writes the denial and returns null.
 */
async function authorizeAgreementMutation(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  agreement: { createdBy?: unknown } | null,
) {
  const creator = await authorizeAfHomes(req, 'sales.card_sales', 'create');
  if ('error' in creator) {
    deny(res, creator);
    return null;
  }
  if (agreement) {
    const cardUpdate = await authorizeAfHomes(req, 'sales.card_sales', 'update');
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

/**
 * D3 tier-mismatch guard. The imported `vipTier` is validation context only:
 * the sale's plan tier stays authoritative for every snapshot. A declared tier
 * that contradicts the selected sale is rejected instead of silently kept.
 */
async function tierConflictForSale(
  db: Db,
  saleId: string,
  vipTier: string,
): Promise<string | null> {
  const { data: sale, error: saleError } = await db
    .from('card_sales')
    .select('plan_id')
    .eq('id', saleId)
    .maybeSingle();
  if (saleError) throw saleError;
  if (!sale) return null;
  const { data: plan, error: planError } = await db
    .from('card_plans')
    .select('code')
    .eq('id', (sale as { plan_id: string }).plan_id)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) return null;
  const actual = String((plan as { code: string }).code).toUpperCase();
  return actual === vipTier.toUpperCase()
    ? null
    : `Imported tier ${vipTier.toUpperCase()} does not match the selected sale (${actual})`;
}

async function authorizeAgreementSale(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
  saleId: string,
) {
  const auth = await authorizeAfHomes(req, 'sales.card_sales', 'create');
  if ('error' in auth) {
    deny(res, auth);
    return false;
  }
  const oversight = await authorizeAfHomes(req, 'sales.card_sales', 'update');
  if (!('error' in oversight)) return true;
  const { data, error } = await db
    .from('card_sales')
    .select('seller_staff_id,seller_ost_id')
    .eq('id', saleId)
    .maybeSingle();
  if (error) throw error;
  const sale = data as { seller_staff_id?: string; seller_ost_id?: string } | null;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  try {
    const path = subPath(req);
    if (method(req) === 'GET' && path === 'customer/template') {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'create');
      if ('error' in auth) return deny(res, auth);
      return sendFile(
        res,
        'afhomes-customer-application-template.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        customerImportTemplate(),
      );
    }
    if (method(req) === 'GET' && path === 'ist/template') {
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'create');
      if ('error' in auth) return deny(res, auth);
      return sendFile(
        res,
        'afhomes-ist-agreement-template.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        istImportTemplate(),
      );
    }
    if (method(req) === 'POST' && path === 'import') {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = importSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid form import', 400);
      const fields = parseFormXlsx(
        new Uint8Array(Buffer.from(parsed.data.contentBase64, 'base64')),
      );
      return res.status(200).json(validateFormImport(parsed.data.kind, fields));
    }
    if (method(req) === 'POST' && path === 'pdf') {
      const auth = await authorizeAfHomes(req, 'sales.customers');
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
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);
      return listRows(req, res, db, 'customer_applications');
    }
    if (path === 'customer-applications' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'create');
      if ('error' in auth) return deny(res, auth);
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
        const { data, error } = await db.rpc('register_customer_application_once', {
          p_request_id: requestId,
          p_actor_id: auth.userId,
          p_header: normalizeApplicationHeader(header),
          p_primary: normalizeHolderOptionals(primary),
          p_secondary: secondary ? normalizeHolderOptionals(secondary) : null,
        });
        if (error) throw error;
        return res.status(201).json(await getApplication(db, rpcId(data)));
      }
      const parsed = createCustomerApplicationSchema
        .safeExtend({ requestId: z.string().uuid() })
        .safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid customer application', 400);
      const { primary, secondary, requestId, ...header } = parsed.data;
      const { data, error } = await db.rpc('create_customer_application_once', {
        p_request_id: requestId,
        p_actor_id: auth.userId,
        p_header: normalizeApplicationHeader(header),
        p_primary: normalizeHolderOptionals(primary),
        p_secondary: secondary ? normalizeHolderOptionals(secondary) : null,
      });
      if (error) throw error;
      const id = rpcId(data);
      // Creation and audit are atomic in the idempotent RPC.
      return res.status(201).json(await getApplication(db, id));
    }
    const appGet = route(req, 'GET', /^customer-applications\/([0-9a-f-]+)$/);
    if (appGet) {
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);
      const found = await getApplication(db, appGet[1]!);
      return found
        ? res.status(200).json(found)
        : fail(res, 'NOT_FOUND', 'Customer application not found', 404);
    }
    const appPatch = route(req, 'PATCH', /^customer-applications\/([0-9a-f-]+)$/);
    if (appPatch) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = createCustomerApplicationSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid customer application', 400);
      const before = await getApplication(db, appPatch[1]!);
      if (!before) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
      const { primary, secondary, requestId: _requestId, ...header } = parsed.data;
      const { error } = await db.rpc('save_customer_application', {
        p_application_id: appPatch[1],
        p_actor_id: auth.userId,
        p_header: normalizeApplicationHeader(header),
        p_primary: normalizeHolderOptionals(primary),
        p_secondary: secondary ? normalizeHolderOptionals(secondary) : null,
      });
      if (error) throw error;
      const after = await getApplication(db, appPatch[1]!);
      await audit(
        db,
        auth.userId,
        'CUSTOMER_APPLICATION_UPDATED',
        'customer_application',
        appPatch[1]!,
        { status: before.status },
        { status: after?.status },
      );
      return res.status(200).json(after);
    }
    const appProposal = route(
      req,
      'GET',
      /^customer-applications\/([0-9a-f-]+)\/purchase-terms\/proposal$/,
    );
    if (appProposal) {
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);
      // The candidate is a REQUEST for who to sell for, never an assertion: the
      // RPC re-validates role, active status and downline scope.
      const candidate = sellerCandidateQuery(req);
      if (!candidate.ok) return fail(res, 'VALIDATION_ERROR', candidate.message, 400);
      const { data, error } = await db.rpc('purchase_terms_proposal', {
        p_application_id: appProposal[1],
        p_actor_id: auth.userId,
        p_seller_candidate: candidate.value,
      });
      if (error) return mapRpcError(res, error);
      const proposal = purchaseTermsProposalSchema.safeParse(data);
      if (!proposal.success)
        return fail(res, 'INTERNAL', 'Purchase terms proposal is unavailable', 500);
      return res.status(200).json(proposal.data);
    }
    const appReview = route(
      req,
      'POST',
      /^customer-applications\/([0-9a-f-]+)\/purchase-terms\/review$/,
    );
    if (appReview) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = reviewPurchaseTermsSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid purchase terms review', 400);
      const { error } = await db.rpc('review_application_purchase_terms_once', {
        p_request_id: parsed.data.requestId,
        p_actor_id: auth.userId,
        p_application_id: appReview[1],
        p_expected_hash: parsed.data.expectedProposalHash,
        p_reason: parsed.data.reason,
        p_seller_candidate: parsed.data.sellerCandidateId ?? null,
      });
      if (error) return mapRpcError(res, error);
      return res.status(200).json(await getApplication(db, appReview[1]!));
    }
    const appSubmit = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/submit$/);
    if (appSubmit) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = submitPurchaseApplicationSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(
          res,
          'VALIDATION_ERROR',
          'A request id and the proposal hash you were shown are required',
          400,
        );
      const before = await getApplication(db, appSubmit[1]!);
      if (!before) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
      if (typeof before.customerId !== 'string')
        return fail(res, 'VALIDATION_ERROR', 'Application customer is missing', 400);
      const currentId = await currentIdForSubject(db, auth, 'customer', before.customerId);
      const { data: current } = currentId
        ? await db
            .from('identity_documents')
            .select('reviewed_data')
            .eq('id', currentId)
            .maybeSingle()
        : { data: null };
      const reviewed = current?.reviewed_data as { fields?: { idType?: unknown } } | undefined;
      if (!currentId || !governmentIdTypeSchema.safeParse(reviewed?.fields?.idType).success)
        return fail(
          res,
          'VALIDATION_ERROR',
          'A persisted current ID with its type is required before submission',
          400,
        );
      // Terms capture, the state change and the audit are one transaction in the
      // RPC. A request id replay returns the original application.
      const { error } = await db.rpc('submit_purchase_application_once', {
        p_request_id: parsed.data.requestId,
        p_actor_id: auth.userId,
        p_application_id: appSubmit[1],
        p_expected_hash: parsed.data.expectedProposalHash,
        p_seller_candidate: parsed.data.sellerCandidateId ?? null,
      });
      if (error) return mapRpcError(res, error);
      return res.status(200).json(await getApplication(db, appSubmit[1]!));
    }
    const appDecision = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/decision$/);
    if (appDecision) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = customerApplicationDecisionSchema
        .safeExtend({ requestId: z.string().uuid() })
        .safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid application decision', 400);
      const { error } = await db.rpc('decide_purchase_application_once', {
        p_request_id: parsed.data.requestId,
        p_actor_id: auth.userId,
        p_application_id: appDecision[1],
        p_decision: parsed.data.decision,
      });
      if (error) return mapRpcError(res, error);
      return res.status(200).json(await getApplication(db, appDecision[1]!));
    }
    const appReopen = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/reopen$/);
    if (appReopen) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = z.object({ requestId: z.string().uuid() }).safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'A request id is required', 400);
      const { error } = await db.rpc('decide_purchase_application_once', {
        p_request_id: parsed.data.requestId,
        p_actor_id: auth.userId,
        p_application_id: appReopen[1],
        p_decision: 'draft',
      });
      if (error) return mapRpcError(res, error);
      return res.status(200).json(await getApplication(db, appReopen[1]!));
    }
    const appExport = route(
      req,
      'GET',
      /^customer-applications\/([0-9a-f-]+)\/export\/(xlsx|pdf)$/,
    );
    if (appExport) {
      const auth = await authorizeAfHomes(req, 'sales.customers');
      if ('error' in auth) return deny(res, auth);
      const app = await getApplication(db, appExport[1]!);
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
            officialFormPdf('VIP PRIVILEGE CARD APPLICATION FORM', fields, 'customer_application'),
          );
    }
    if (path === 'reservations' && method(req) === 'GET') {
      const auth = await authorizeAfHomes(req, 'sales.card_sales');
      if ('error' in auth) return deny(res, auth);
      return listRows(req, res, db, 'reservation_agreements');
    }
    if (path === 'reservations' && method(req) === 'POST') {
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'create');
      if ('error' in auth) return deny(res, auth);
      // First-time purchase: an approved application and its EXACT frozen terms
      // create the AF-RES with no card sale at all. The legacy sale-origin mode
      // below is unchanged.
      const applicationOrigin = purchaseReservationCreateSchema.safeParse(jsonBody(req));
      if (applicationOrigin.success && applicationOrigin.data.origin === 'application') {
        const { requestId, customerApplicationId, purchaseTermsId, scheduleNotes, ...input } =
          applicationOrigin.data;
        const { data, error } = await db.rpc('reserve_application_purchase_once', {
          p_request_id: requestId,
          p_actor_id: auth.userId,
          p_application_id: customerApplicationId,
          p_terms_id: purchaseTermsId ?? null,
          p_input: { ...input, scheduleNotes },
        });
        if (error) return mapRpcError(res, error);
        return res.status(201).json(await getAgreement(db, rpcId(data)));
      }
      // A request that declared the application origin but failed the contract is
      // a rejected body, never a silent fall-through to the sale-origin path.
      if ((jsonBody(req) as { origin?: unknown } | undefined)?.origin === 'application')
        return fail(res, 'VALIDATION_ERROR', 'Invalid application reservation request', 400);
      const parsed = createReservationAgreementSchema
        .safeExtend({ requestId: z.string().uuid() })
        .safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid reservation agreement', 400);
      const { primary, secondary, scheduleNotes, vipTier, requestId, ...input } = parsed.data;
      if (!input.customerApplicationId)
        return fail(
          res,
          'VALIDATION_ERROR',
          'Choose an eligible Customer Application before creating a reservation.',
          400,
        );
      // The legacy sale-origin form still REQUIRES a sale. The contract made the field
      // optional so the application-origin shape can omit it entirely; this guard
      // is where the legacy path states the requirement again.
      if (!input.saleId)
        return fail(res, 'VALIDATION_ERROR', 'Select a sale for this reservation.', 400);
      if (!(await authorizeAgreementSale(req, res, db, input.saleId))) return;
      if (vipTier) {
        const conflict = await tierConflictForSale(db, input.saleId, vipTier);
        if (conflict) return fail(res, 'CONFLICT', conflict, 409);
      }
      const { data, error } = await db.rpc('reserve_from_customer_application_once', {
        p_request_id: requestId,
        p_actor_id: auth.userId,
        p_input: { ...input, ...(vipTier ? { vipTier } : {}) },
        p_primary: primary,
        p_secondary: secondary ?? null,
        p_schedule: scheduleNotes,
      });
      if (error) throw error;
      const id = rpcId(data);
      // Creation and audit are atomic in the idempotent RPC.
      return res.status(201).json(await getAgreement(db, id));
    }
    const agreementGet = route(req, 'GET', /^reservations\/([0-9a-f-]+)$/);
    if (agreementGet) {
      const auth = await authorizeAfHomes(req, 'sales.card_sales');
      if ('error' in auth) return deny(res, auth);
      const found = await getAgreement(db, agreementGet[1]!);
      return found
        ? res.status(200).json(found)
        : fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
    }
    const agreementPatch = route(req, 'PATCH', /^reservations\/([0-9a-f-]+)$/);
    if (agreementPatch) {
      const before = await getAgreement(db, agreementPatch[1]!);
      if (!before) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      const auth = await authorizeAgreementMutation(req, res, db, before);
      if (!auth) return;
      // An application-origin agreement has no sale and no editable commercial
      // source: only agreement fields move, through the strict update contract.
      if (before.origin === 'application') {
        const parsed = purchaseReservationUpdateSchema.safeParse(jsonBody(req));
        if (!parsed.success)
          return fail(res, 'VALIDATION_ERROR', 'Invalid reservation agreement update', 400);
        const { requestId, ...input } = parsed.data;
        const { error } = await db.rpc('transition_purchase_reservation_once', {
          p_request_id: requestId,
          p_actor_id: auth.userId,
          p_reservation_id: agreementPatch[1],
          p_action: 'save',
          p_input: input,
        });
        if (error) return mapRpcError(res, error);
        return res.status(200).json(await getAgreement(db, agreementPatch[1]!));
      }
      const parsed = createReservationAgreementSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid reservation agreement', 400);
      const {
        primary,
        secondary,
        scheduleNotes,
        vipTier,
        requestId: _requestId,
        ...input
      } = parsed.data;
      // The legacy sale-origin PATCH still requires a sale; see the create guard.
      if (!input.saleId)
        return fail(res, 'VALIDATION_ERROR', 'Select a sale for this reservation.', 400);
      if (!(await authorizeAgreementSale(req, res, db, input.saleId))) return;
      if (vipTier) {
        const conflict = await tierConflictForSale(db, input.saleId, vipTier);
        if (conflict) return fail(res, 'CONFLICT', conflict, 409);
      }
      const { error } = await db.rpc('save_reservation_agreement', {
        p_agreement_id: agreementPatch[1],
        p_actor_id: auth.userId,
        p_input: input,
        p_primary: primary,
        p_secondary: secondary ?? null,
        p_schedule: scheduleNotes,
      });
      if (error) throw error;
      const after = await getAgreement(db, agreementPatch[1]!);
      await audit(
        db,
        auth.userId,
        'RESERVATION_AGREEMENT_UPDATED',
        'reservation_agreement',
        agreementPatch[1]!,
        { status: before.status },
        { status: after?.status },
      );
      return res.status(200).json(after);
    }
    const agreementSubmit = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/submit$/);
    if (agreementSubmit) {
      const before = await getAgreement(db, agreementSubmit[1]!);
      if (!before) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      const auth = await authorizeAgreementMutation(req, res, db, before);
      if (!auth) return;
      if (before.origin === 'application') {
        const { error } = await db.rpc('transition_purchase_reservation_once', {
          p_request_id: purchaseRequestId(req),
          p_actor_id: auth.userId,
          p_reservation_id: agreementSubmit[1],
          p_action: 'submit',
          p_input: {},
        });
        if (error) return mapRpcError(res, error);
        return res.status(200).json(await getAgreement(db, agreementSubmit[1]!));
      }
      const { error } = await db.rpc('submit_reservation_agreement', {
        p_agreement_id: agreementSubmit[1],
        p_actor_id: auth.userId,
      });
      if (error) throw error;
      await audit(
        db,
        auth.userId,
        'RESERVATION_AGREEMENT_SUBMITTED',
        'reservation_agreement',
        agreementSubmit[1]!,
        { status: before.status },
        { status: 'submitted' },
      );
      return res.status(200).json(await getAgreement(db, agreementSubmit[1]!));
    }
    const agreementDecision = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/decision$/);
    if (agreementDecision) {
      const parsed = reservationAgreementDecisionSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid agreement decision', 400);
      const current = await getAgreement(db, agreementDecision[1]!);
      if (!current) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      const auth = await authorizeAgreementMutation(req, res, db, current);
      if (!auth) return;
      if (current.origin === 'application') {
        const { error } = await db.rpc('transition_purchase_reservation_once', {
          p_request_id: purchaseRequestId(req),
          p_actor_id: auth.userId,
          p_reservation_id: agreementDecision[1],
          p_action: parsed.data.decision === 'executed' ? 'execute' : 'cancel',
          p_input: {},
        });
        if (error) return mapRpcError(res, error);
        return res.status(200).json(await getAgreement(db, agreementDecision[1]!));
      }
      const ok = await transitionAgreementStatus(
        db,
        auth.userId,
        agreementDecision[1]!,
        parsed.data.decision,
      );
      if (!ok) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      return res.status(200).json(await getAgreement(db, agreementDecision[1]!));
    }
    const agreementReopen = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/reopen$/);
    if (agreementReopen) {
      const current = await getAgreement(db, agreementReopen[1]!);
      if (!current) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      const auth = await authorizeAgreementMutation(req, res, db, current);
      if (!auth) return;
      if (current.origin === 'application') {
        const { error } = await db.rpc('transition_purchase_reservation_once', {
          p_request_id: purchaseRequestId(req),
          p_actor_id: auth.userId,
          p_reservation_id: agreementReopen[1],
          p_action: 'reopen',
          p_input: {},
        });
        if (error) return mapRpcError(res, error);
        return res.status(200).json(await getAgreement(db, agreementReopen[1]!));
      }
      const ok = await transitionAgreementStatus(db, auth.userId, agreementReopen[1]!, 'draft');
      if (!ok) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      return res.status(200).json(await getAgreement(db, agreementReopen[1]!));
    }
    const agreementPayments = route(req, 'GET', /^reservations\/([0-9a-f-]+)\/payments$/);
    if (agreementPayments) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification');
      if ('error' in auth) return deny(res, auth);
      const current = await getAgreement(db, agreementPayments[1]!);
      if (!current) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      if (current.origin !== 'application')
        return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      // One ledger. The rows are the SAME payments the queue and the report read,
      // selected by reservation until finalization links them to the sale.
      const { data, error } = await db
        .from('payments')
        .select('*')
        .eq('reservation_id', agreementPayments[1]!)
        .order('recorded_at', { ascending: false });
      if (error) throw error;
      return list(
        res,
        (data ?? []).map((row: Record<string, unknown>) => shapePayment(row)),
      );
    }
    const agreementRecordPayment = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/payments$/);
    if (agreementRecordPayment) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = recordPurchasePaymentSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid payment', 400);
      const current = await getAgreement(db, agreementRecordPayment[1]!);
      if (!current) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      if (current.origin !== 'application')
        return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      const { requestId, amount, paymentType, method, reference, notes, receiptStoragePath } =
        parsed.data;
      const { error } = await db.rpc('record_reservation_payment_once', {
        p_request_id: requestId,
        p_reservation_id: agreementRecordPayment[1],
        p_actor_id: auth.userId,
        p_input: {
          amount,
          paymentType,
          method,
          reference: reference ?? null,
          notes: notes ?? null,
          receiptStoragePath: receiptStoragePath ?? null,
        },
      });
      if (error) return mapRpcError(res, error);
      return res.status(201).json(await agreementFinanceSummary(db, agreementRecordPayment[1]!));
    }
    const paymentVerify = route(
      req,
      'POST',
      /^reservations\/([0-9a-f-]+)\/payments\/([0-9a-f-]+)\/verify$/,
    );
    if (paymentVerify) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = verifyPurchasePaymentSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid verification decision', 400);
      const { data: payment, error: readError } = await db
        .from('payments')
        .select('id')
        .eq('id', paymentVerify[2]!)
        .eq('reservation_id', paymentVerify[1]!)
        .maybeSingle();
      if (readError) throw readError;
      if (!payment) return fail(res, 'NOT_FOUND', 'Payment not found', 404);
      const { error } = await db.rpc('verify_purchase_payment_once', {
        p_request_id: parsed.data.requestId,
        p_payment_id: paymentVerify[2],
        p_decision: parsed.data.decision,
        p_reason: parsed.data.reason ?? null,
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
      return res.status(200).json(await agreementFinanceSummary(db, paymentVerify[1]!));
    }
    const agreementFinalize = route(req, 'POST', /^reservations\/([0-9a-f-]+)\/finalize$/);
    if (agreementFinalize) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = finalizeReservationPurchaseSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid finalization request', 400);
      const current = await getAgreement(db, agreementFinalize[1]!);
      if (!current) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      if (current.origin !== 'application')
        return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      // The browser sends a request id and nothing else. Every precondition -
      // executed, approved, zero undecided payments, verified total, seller,
      // hierarchy, exactly-one-sale - is re-derived in SQL.
      const { data, error } = await db.rpc('finalize_reservation_purchase_once', {
        p_request_id: parsed.data.requestId,
        p_reservation_id: agreementFinalize[1],
        p_actor_id: auth.userId,
      });
      if (error) return mapRpcError(res, error);
      return res.status(200).json({
        saleId: rpcId(data),
        reservationId: agreementFinalize[1],
        // Activation is a SEPARATE action with its own permission. Nothing here
        // activates a membership, so nothing here may imply one.
        activationRequired: true,
      });
    }
    const agreementFinance = route(req, 'GET', /^reservations\/([0-9a-f-]+)\/finance$/);
    if (agreementFinance) {
      const auth = await authorizeAfHomes(req, 'finance.payment_verification');
      if ('error' in auth) return deny(res, auth);
      const current = await getAgreement(db, agreementFinance[1]!);
      if (!current) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      if (current.origin !== 'application')
        return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      return res.status(200).json(await agreementFinanceSummary(db, agreementFinance[1]!));
    }
    const documentExport = route(
      req,
      'GET',
      /^reservations\/([0-9a-f-]+)\/documents\/(reservation|payment_recorded|payment_verified|purchase_finalized|membership_activated)\/(\d+|latest)$/,
    );
    if (documentExport) {
      const kind = documentExport[2]! as PurchaseDocumentKind;
      const auth = await authorizeAfHomes(req, documentModule(kind));
      if ('error' in auth) return deny(res, auth);
      const revision = documentExport[3] === 'latest' ? null : Number(documentExport[3]);
      // FRESH authorization happens inside the RPC against the live role graph.
      // The handler check above is UX, not the boundary.
      const { data, error } = await db.rpc('purchase_document', {
        p_kind: kind,
        p_source_id: documentExport[1],
        p_actor_id: auth.userId,
        p_revision: revision,
      });
      if (error) return mapRpcError(res, error);
      const evidence = data as PurchaseDocumentEvidence;
      const bytes = purchaseDocumentPdf(evidence);
      // No-store on the envelope: a reprint is a historical artefact, not a
      // cacheable page that could outlive the permission that produced it.
      res.setHeader('Cache-Control', 'no-store');
      return sendFile(res, purchaseDocumentFilename(kind), 'application/pdf', bytes);
    }
    const agreementExport = route(req, 'GET', /^reservations\/([0-9a-f-]+)\/export\/(xlsx|pdf)$/);
    if (agreementExport) {
      const auth = await authorizeAfHomes(req, 'sales.card_sales');
      if ('error' in auth) return deny(res, auth);
      const agreement = await getAgreement(db, agreementExport[1]!);
      if (!agreement) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      const first = agreement.schedule[0] as
        | { particular?: string; amount?: string; paymentDate?: string; remarks?: string }
        | undefined;
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
        primary_signature_status: String(agreement.primarySignatureStatus),
        secondary_signature_status: String(agreement.secondarySignatureStatus ?? ''),
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
        schedule_remarks: String(first?.remarks ?? ''),
        payment_dates: agreement.schedule.map((line) => String(line.paymentDate ?? '')).join('|'),
        payment_remarks: agreement.schedule.map((line) => String(line.remarks ?? '')).join('|'),
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
    }
    return fail(res, 'NOT_FOUND', 'Official form endpoint not found', 404);
  } catch (error) {
    console.error('[api] official forms:', error instanceof Error ? error.message : error);
    return mapRpcError(res, error as { message?: string });
  }
}
