import { z } from 'zod';
import {
  canTransitionCustomerApplication,
  canTransitionReservationAgreement,
  createCustomerApplicationSchema,
  createReservationAgreementSchema,
  customerApplicationDecisionSchema,
  officialFormListQuerySchema,
  reservationAgreementDecisionSchema,
  type CustomerApplicationStatus,
  type ReservationAgreementStatus,
} from '@jad/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
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
    saleId: row.sale_id,
    customerApplicationId: row.customer_application_id ?? undefined,
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
    const { data: holders } = await db
      .from('customer_application_holders')
      .select('application_id,first_name,last_name')
      .in('application_id', ids);
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
    const { data: holders } = await db
      .from('reservation_agreement_holders')
      .select('agreement_id,name,holder_type')
      .in('agreement_id', ids);
    const names = new Map<string, string>();
    for (const holder of (holders ?? []) as Record<string, unknown>[])
      if (String(holder.holder_type) === 'PRIMARY')
        names.set(String(holder.agreement_id), String(holder.name ?? ''));
    for (const row of rows) row.applicant_name = names.get(String(row.id)) ?? null;
  }
  return res
    .status(200)
    .json({
      data: rows,
      meta: { total: count ?? rows.length, limit: q.limit, offset: q.offset },
    });
}

const APPLICABLE_DECISION_AUDIT: Record<string, string> = {
  approved: 'CUSTOMER_APPLICATION_APPROVED',
  rejected: 'CUSTOMER_APPLICATION_REJECTED',
  cancelled: 'CUSTOMER_APPLICATION_CANCELLED',
  executed: 'RESERVATION_AGREEMENT_EXECUTED',
};

async function transitionApplicationStatus(
  db: Db,
  authUserId: string,
  id: string,
  to: CustomerApplicationStatus,
) {
  const { data, error } = await db
    .from('customer_applications')
    .select('id,status,submitted_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { status: CustomerApplicationStatus; submitted_at: string | null };
  if (!canTransitionCustomerApplication(row.status, to)) {
    const conflict = new Error(
      `INVALID_APPLICATION_TRANSITION: cannot move from ${row.status} to ${to}`,
    );
    (conflict as { code?: string }).code = 'INVALID_APPLICATION_TRANSITION';
    throw conflict;
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, updated_at: now };
  if (to === 'approved') {
    patch.submitted_at = row.submitted_at ?? now;
    patch.approved_at = now;
  }
  if (to === 'rejected') {
    patch.submitted_at = row.submitted_at ?? now;
    patch.rejected_at = now;
  }
  if (to === 'cancelled') patch.updated_at = now;
  if (to === 'draft') patch.updated_at = now;
  const { error: writeError } = await db.from('customer_applications').update(patch).eq('id', id);
  if (writeError) throw writeError;
  await audit(
    db,
    authUserId,
    to === 'draft' ? 'CUSTOMER_APPLICATION_REOPENED' : (APPLICABLE_DECISION_AUDIT[to] ?? 'CUSTOMER_APPLICATION_UPDATED'),
    'customer_application',
    id,
    { status: row.status },
    { status: to },
  );
  return true;
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
    to === 'draft' ? 'RESERVATION_AGREEMENT_REOPENED' : (APPLICABLE_DECISION_AUDIT[to] ?? 'RESERVATION_AGREEMENT_UPDATED'),
    'reservation_agreement',
    id,
    { status: row.status },
    { status: to },
  );
  return true;
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
      const parsed = createCustomerApplicationSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid customer application', 400);
      const { primary, secondary, ...header } = parsed.data;
      const { data, error } = await db.rpc('save_customer_application', {
        p_application_id: null,
        p_actor_id: auth.userId,
        p_header: header,
        p_primary: primary,
        p_secondary: secondary ?? null,
      });
      if (error) throw error;
      const id = rpcId(data);
      await audit(
        db,
        auth.userId,
        'CUSTOMER_APPLICATION_CREATED',
        'customer_application',
        id,
        null,
        { status: 'draft' },
      );
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
      const { primary, secondary, ...header } = parsed.data;
      const { error } = await db.rpc('save_customer_application', {
        p_application_id: appPatch[1],
        p_actor_id: auth.userId,
        p_header: header,
        p_primary: primary,
        p_secondary: secondary ?? null,
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
    const appSubmit = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/submit$/);
    if (appSubmit) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const before = await getApplication(db, appSubmit[1]!);
      if (!before) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
      const { error } = await db.rpc('submit_customer_application', {
        p_application_id: appSubmit[1],
        p_actor_id: auth.userId,
      });
      if (error) throw error;
      await audit(
        db,
        auth.userId,
        'CUSTOMER_APPLICATION_SUBMITTED',
        'customer_application',
        appSubmit[1]!,
        { status: before.status },
        { status: 'submitted' },
      );
      return res.status(200).json(await getApplication(db, appSubmit[1]!));
    }
    const appDecision = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/decision$/);
    if (appDecision) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = customerApplicationDecisionSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid application decision', 400);
      const ok = await transitionApplicationStatus(
        db,
        auth.userId,
        appDecision[1]!,
        parsed.data.decision,
      );
      if (!ok) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
      return res.status(200).json(await getApplication(db, appDecision[1]!));
    }
    const appReopen = route(req, 'POST', /^customer-applications\/([0-9a-f-]+)\/reopen$/);
    if (appReopen) {
      const auth = await authorizeAfHomes(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      const ok = await transitionApplicationStatus(db, auth.userId, appReopen[1]!, 'draft');
      if (!ok) return fail(res, 'NOT_FOUND', 'Customer application not found', 404);
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
      const parsed = createReservationAgreementSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid reservation agreement', 400);
      const { primary, secondary, scheduleNotes, ...input } = parsed.data;
      const { data, error } = await db.rpc('save_reservation_agreement', {
        p_agreement_id: null,
        p_actor_id: auth.userId,
        p_input: input,
        p_primary: primary,
        p_secondary: secondary ?? null,
        p_schedule: scheduleNotes,
      });
      if (error) throw error;
      const id = rpcId(data);
      await audit(
        db,
        auth.userId,
        'RESERVATION_AGREEMENT_CREATED',
        'reservation_agreement',
        id,
        null,
        { status: 'draft' },
      );
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
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = createReservationAgreementSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid reservation agreement', 400);
      const before = await getAgreement(db, agreementPatch[1]!);
      if (!before) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      const { primary, secondary, scheduleNotes, ...input } = parsed.data;
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
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'update');
      if ('error' in auth) return deny(res, auth);
      const before = await getAgreement(db, agreementSubmit[1]!);
      if (!before) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
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
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'update');
      if ('error' in auth) return deny(res, auth);
      const parsed = reservationAgreementDecisionSchema.safeParse(jsonBody(req));
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Invalid agreement decision', 400);
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
      const auth = await authorizeAfHomes(req, 'sales.card_sales', 'update');
      if ('error' in auth) return deny(res, auth);
      const ok = await transitionAgreementStatus(db, auth.userId, agreementReopen[1]!, 'draft');
      if (!ok) return fail(res, 'NOT_FOUND', 'Reservation agreement not found', 404);
      return res.status(200).json(await getAgreement(db, agreementReopen[1]!));
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
