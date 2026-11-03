import {
  acquisitionChannelSchema,
  customerApplicationStatusSchema,
  reservationAgreementStatusSchema,
  holderTypeSchema,
  paymentSchemeSchema,
  signatureStatusSchema,
  vipTierSchema,
  purchaseTermsSchema,
  purchaseDocumentEvidenceSchema,
} from '@afhomes/contracts';
import type { MigrationTable } from './migration-mapping.js';
import { reviewedFormsMigrationTables } from './migration-forms-tables.js';
export { reviewedFormsMigrationTables } from './migration-forms-tables.js';

const camelRow = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
const sourceForKind: Record<string, string> = {
  reservation: 'reservation_id',
  payment_recorded: 'payment_id',
  payment_verified: 'payment_id',
  purchase_finalized: 'sale_id',
  membership_activated: 'membership_id',
};
const formTargets = new Map(
  reviewedFormsMigrationTables().map((table) => [table.source, table.target]),
);

export function migrationFormsIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  if (formTargets.get(table.source) !== table.target) return issues;
  const fail = (column: string) => issues.push({ column, code: 'INVALID_FORMS_HISTORY' });
  for (const column of table.money ?? [])
    if (
      row[column] !== null &&
      (typeof row[column] !== 'string' ||
        !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(row[column] as string))
    )
      fail(column);
  for (const column of ['tier_snapshot', 'payment_scheme_snapshot']) {
    if (!table.columns.includes(column)) continue;
    const schema = column === 'tier_snapshot' ? vipTierSchema : paymentSchemeSchema;
    if (!schema.safeParse(row[column]).success) fail(column);
  }
  for (const [column, min, max] of [
    ['discount_percent_snapshot', 0, 100],
    ['holder_limit_snapshot', 1, 2],
    ['validity_years_snapshot', 1, 2147483647],
    ['annual_points_tranches_snapshot', 1, 2147483647],
    ['yearly_points_snapshot', 0, 2147483647],
    ['installment_months_snapshot', 1, 2147483647],
    ['payment_due_day', 1, 31],
    ['line_number', 1, 2147483647],
  ] as const)
    if (
      table.columns.includes(column) &&
      row[column] !== null &&
      (typeof row[column] !== 'number' ||
        (row[column] as number) < min ||
        (row[column] as number) > max)
    )
      fail(column);
  if (table.target === 'customer_applications') {
    if (!customerApplicationStatusSchema.safeParse(row.status).success) fail('status');
    if (
      !Array.isArray(row.acquisition_channels) ||
      !row.acquisition_channels.every(
        (channel) => acquisitionChannelSchema.safeParse(channel).success,
      )
    )
      fail('acquisition_channels');
    for (const column of ['primary_signature_status', 'secondary_signature_status'])
      if (row[column] !== null && !signatureStatusSchema.safeParse(row[column]).success)
        fail(column);
    if (
      ['submitted', 'approved', 'rejected'].includes(String(row.status)) &&
      row.submitted_at === null
    )
      fail('submitted_at');
    if (row.status === 'approved' && row.approved_at === null) fail('approved_at');
    if (row.status === 'rejected' && row.rejected_at === null) fail('rejected_at');
  }
  if (
    table.target === 'customer_application_purchase_terms' &&
    !purchaseTermsSchema.safeParse(camelRow(row)).success
  )
    fail('purchase_terms');
  if (
    ['customer_application_holders', 'reservation_agreement_holders'].includes(table.target) &&
    !holderTypeSchema.safeParse(row.holder_type).success
  )
    fail('holder_type');
  if (table.target === 'customer_application_holders') {
    const codes = ['province_code', 'city_municipality_code', 'barangay_code'].map(
      (column) => row[column],
    );
    if (
      ![0, 3].includes(codes.filter((value) => value !== null).length) ||
      codes.some(
        (value) => value !== null && (typeof value !== 'string' || !/^\d{10}$/.test(value)),
      )
    )
      fail('province_code');
    if (row.barangay !== null && row.city_municipality_code === null) fail('barangay');
  }
  if (table.target === 'reservation_agreements') {
    if (!reservationAgreementStatusSchema.safeParse(row.status).success) fail('status');
    if (
      !row.inclusions_snapshot ||
      typeof row.inclusions_snapshot !== 'object' ||
      Array.isArray(row.inclusions_snapshot)
    )
      fail('inclusions_snapshot');
    if (['submitted', 'executed'].includes(String(row.status)) && row.submitted_at === null)
      fail('submitted_at');
    if (row.status === 'executed' && row.executed_at === null) fail('executed_at');
    const required = [
      'customer_application_id',
      'customer_id',
      'seller_staff_id',
      'purchase_terms_id',
      'minimum_down_payment_snapshot',
      'required_initial_snapshot',
      'spot_cash_days_snapshot',
      'validity_months_snapshot',
      'commission_rate_snapshot',
      'commission_base_snapshot',
      'expected_commission_snapshot',
    ];
    if (!(
      (row.origin === 'sale' && row.sale_id !== null && row.purchase_terms_id === null) ||
      (row.origin === 'application' && required.every((column) => row[column] !== null))
    ))
      fail('origin');
    if (
      row.origin !== 'sale' &&
      !(
        (row.sale_id === null && row.finalized_by === null && row.finalized_at === null) ||
        (row.sale_id !== null &&
          row.finalized_by !== null &&
          row.finalized_at !== null &&
          row.status === 'executed')
      )
    )
      fail('finalized_at');
  }
  if (table.target === 'purchase_document_evidence') {
    const pointer = sourceForKind[String(row.kind)];
    const present = ['reservation_id', 'payment_id', 'sale_id', 'membership_id'].filter(
      (column) => row[column] !== null,
    );
    if (
      !pointer ||
      present.length !== 1 ||
      present[0] !== pointer ||
      row.source_id !== row[pointer]
    )
      fail('source_id');
    const document = purchaseDocumentEvidenceSchema.safeParse({
      id: row.id,
      kind: row.kind,
      sourceId: row.source_id,
      revision: row.revision,
      schemaVersion: row.schema_version,
      actorId: row.actor_id,
      capturedAt: row.captured_at,
      fields: row.fields,
    });
    if (!document.success) {
      for (const problem of document.error.issues) {
        const path = problem.path.join('.');
        issues.push({
          column: path || 'fields',
          code: `DOCUMENT_SCHEMA_${problem.code.toUpperCase()}`,
        });
      }
    }
  }
  return issues;
}

export function reconcileSourceForms(source: Record<string, Record<string, unknown>[]>) {
  const issues: { table: string; row: number | null; column?: string; code: string }[] = [];
  const fail = (table: string, row: number | null, code: string, column?: string) =>
    issues.push({ table, row, code, ...(column ? { column } : {}) });
  for (const table of reviewedFormsMigrationTables()) {
    if (!Array.isArray(source[table.source])) {
      fail(table.source, null, 'SOURCE_TABLE_REQUIRED');
      continue;
    }
    source[table.source]!.forEach((row, index) => {
      for (const problem of migrationFormsIssues(table, row))
        fail(table.source, index, problem.code, problem.column);
    });
  }
  if (issues.length) return { ready: false, issues };
  const applications = new Map(source['public.customer_applications']!.map((row) => [row.id, row]));
  const terms = new Map(
    source['public.customer_application_purchase_terms']!.map((row) => [row.id, row]),
  );
  const reservations = new Map(
    source['public.reservation_agreements']!.map((row) => [row.id, row]),
  );
  source['public.customer_applications']!.forEach((app, index) => {
    if (app.purchase_terms_id === null) return;
    const current = terms.get(app.purchase_terms_id);
    if (!current || current.application_id !== app.id)
      fail('public.customer_applications', index, 'APPLICATION_TERMS_LINK_MISMATCH');
  });
  source['public.customer_application_purchase_terms']!.forEach((row, index) => {
    if (!applications.has(row.application_id))
      fail('public.customer_application_purchase_terms', index, 'APPLICATION_REFERENCE_MISSING');
  });
  source['public.reservation_agreements']!.forEach((reservation, index) => {
    if (reservation.origin !== 'application') return;
    const chosen = terms.get(reservation.purchase_terms_id);
    if (
      !chosen ||
      chosen.application_id !== reservation.customer_application_id ||
      chosen.customer_id !== reservation.customer_id ||
      chosen.plan_id !== reservation.plan_id ||
      chosen.seller_staff_id !== reservation.seller_staff_id
    )
      fail('public.reservation_agreements', index, 'RESERVATION_TERMS_LINK_MISMATCH');
  });
  for (const table of [
    'customer_application_holders',
    'reservation_agreement_holders',
    'reservation_agreement_schedule',
  ])
    source[`public.${table}`]!.forEach((row, index) => {
      const valid =
        table === 'customer_application_holders'
          ? applications.has(row.application_id)
          : reservations.has(row.agreement_id);
      if (!valid) fail(`public.${table}`, index, 'FORM_PARENT_REFERENCE_MISSING');
    });
  const documentTargets: Record<string, string> = {
    reservation_id: 'public.reservation_agreements',
    payment_id: 'public.payments',
    sale_id: 'public.card_sales',
    membership_id: 'public.memberships',
  };
  source['private.purchase_document_evidence']!.forEach((row, index) => {
    const column = sourceForKind[String(row.kind)],
      parents = source[documentTargets[column]!];
    if (!parents?.some((parent) => parent.id === row[column]))
      fail('private.purchase_document_evidence', index, 'DOCUMENT_SOURCE_REFERENCE_MISSING');
  });
  return { ready: issues.length === 0, issues };
}
