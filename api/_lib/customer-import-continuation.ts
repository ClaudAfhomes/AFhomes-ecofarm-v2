import { validateImportRow } from './customer-import.js';
import { workbookApplicationPrefill } from './customer-workbook.js';
import {
  WORKBOOK_PAYMENT_SCHEMES,
  WORKBOOK_PAYMENT_METHODS,
  workbookPaymentClaimSchema,
  type WorkbookPaymentClaim,
} from '@afhomes/contracts';
import { addMoney } from '@afhomes/shared';
import type { Db } from './handler-kit.js';

export type ImportedCustomerFacts = {
  person: Record<string, unknown>;
  company: Record<string, unknown>;
  primary: Record<string, unknown>;
  secondary: Record<string, unknown> | null;
  paymentClaims?: WorkbookPaymentClaim[];
};

/** A contract fee alone is not proof that money was paid. */
export function legacyPaymentClaims(fields: Record<string, string>): WorkbookPaymentClaim[] {
  if (
    fields.stated_status !== 'Reservation Paid' ||
    !fields.stated_reference?.trim() ||
    !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(fields.stated_rf ?? '')
  )
    return [];
  const claim = workbookPaymentClaimSchema.safeParse({
    customerKey: fields.customer_key || 'Legacy source',
    paymentKey: fields.stated_reference,
    purpose: 'reservation',
    amount: addMoney(fields.stated_rf!, '0.00'),
    date: fields.stated_date,
    method: WORKBOOK_PAYMENT_METHODS[fields.stated_payment_method ?? ''],
    reference: fields.stated_reference,
    notes: 'Reservation payment stated in the original workbook; Finance reconciliation required.',
  });
  return claim.success && claim.data.amount !== '0.00' ? [claim.data] : [];
}

/** Adapt company keys once; normalized Pending is not the company's stated status. */
export function buildImportedCustomerFacts(fields: Record<string, string>): ImportedCustomerFacts {
  const adapted: Record<string, string> = { ...fields, source_status: 'Pending' };
  const aliases: Record<string, string> = {
    tin: 'tin_number',
    occupation: 'occupation_business_name',
    business_address: 'office_business_address',
    position: 'employed_position',
    vd_name: 'svd_name',
    recommender_name: 'vip_recommender_name',
    recommender_contact: 'related_contact_no',
    recommender_email: 'related_email',
    stated_total: 'stated_total_amount',
    stated_payment_scheme: 'payment_scheme',
    stated_payment_method: 'payment_method',
    stated_reference: 'payment_reference',
    stated_date: 'payment_date',
  };
  for (const [source, destination] of Object.entries(aliases))
    if (fields[source] !== undefined) adapted[destination] = fields[source]!;
  adapted.payment_scheme =
    WORKBOOK_PAYMENT_SCHEMES[fields.stated_payment_scheme ?? ''] ??
    fields.stated_payment_scheme_code ??
    '';
  adapted.payment_method = WORKBOOK_PAYMENT_METHODS[fields.stated_payment_method ?? ''] ?? '';
  const secondary: Record<string, string> = {
    birth_date: 'birthday',
    sex: 'gender',
    citizenship: 'citizenship',
    civil_status: 'civil_status',
    tin: 'tin_number',
    mobile: 'mobile',
    email: 'email',
    landline: 'landline',
    occupation: 'occupation_business_name',
    business_address: 'office_address',
    position: 'position',
  };
  for (const [source, destination] of Object.entries(secondary))
    if (fields['secondary_' + source] !== undefined)
      adapted['supplementary_' + destination] = fields['secondary_' + source]!;
  adapted.supplementary_full_name = ['first_name', 'middle_name', 'last_name', 'suffix']
    .map((k) => fields['secondary_' + k])
    .filter((v) => v && v !== 'N/A')
    .join(' ');
  adapted.supplementary_address = [
    'address_line_1',
    'address_line_2',
    'barangay',
    'city',
    'province',
    'postal_code',
  ]
    .map((k) => fields['secondary_' + k])
    .filter(Boolean)
    .join(', ');
  const row = validateImportRow(
    2,
    adapted,
    {
      plansByTier: new Map(),
      customerByNumber: new Map(),
      customerByEmail: new Map(),
      membershipByNumber: new Map(),
      referralStaffByCode: new Map(),
      seenMembershipNumbers: new Map(),
    },
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()),
  );
  if (!row.normalized)
    throw new Error(
      'Imported customer facts are invalid: ' +
        row.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
    );
  const prefill = workbookApplicationPrefill(fields);
  const person = { ...row.normalized.person };
  delete person.age;
  const address: Record<string, string> = { countryCode: 'PH' };
  for (const [source, target] of Object.entries({
    address_line_1: 'line1',
    address_line_2: 'line2',
    province: 'province',
    city: 'city',
    barangay: 'barangay',
    verified_postal_code: 'postalCode',
    province_code: 'provinceCode',
    city_code: 'cityMunicipalityCode',
    barangay_code: 'barangayCode',
  }))
    if (fields[source]) address[target] = fields[source]!;
  return {
    person: { ...person, address },
    company: {
      ...row.normalized.company,
      companyStatus: fields.stated_status || null,
      statedPaymentTerms: fields.stated_payment_scheme || null,
      statedPaymentType: fields.stated_payment_method || null,
    },
    primary: { ...prefill.primary },
    secondary: prefill.secondary ? { ...prefill.secondary } : null,
  };
}

/** Internal proposal only. The API separately masks write-only fields before returning it. */
export function buildImportRecoveryPreview(
  source: Record<string, unknown>,
  current: Record<string, unknown>,
): {
  fill: Record<string, unknown>;
  conflicts: { field: string; message: string }[];
} {
  const fill: Record<string, unknown> = {};
  const conflicts: { field: string; message: string }[] = [];
  for (const [field, value] of Object.entries(source)) {
    if (value === null || value === undefined || value === '') continue;
    const previous = current[field];
    if (previous === null || previous === undefined || previous === '') fill[field] = value;
    else if (JSON.stringify(previous) !== JSON.stringify(value))
      conflicts.push({
        field,
        message: 'Imported value differs from the current record; review is required.',
      });
  }
  return { fill, conflicts };
}

/** Older imports lack normalized company facts; recompute without changing their evidence. */
export async function loadImportRecoveryContext(db: Db, rowId: string) {
  const result = await db
    .from('customer_import_rows')
    .select('id,raw_data,normalized_data')
    .eq('id', rowId)
    .maybeSingle();
  if (result.error) throw result.error;
  const row = result.data as {
    raw_data: Record<string, string>;
    normalized_data: Record<string, unknown>;
  } | null;
  return {
    fields: row?.raw_data ?? {},
    recoveryArguments:
      row && !row.normalized_data?.customerFacts
        ? {
            p_proposed_facts: {
              ...buildImportedCustomerFacts(row.raw_data),
              paymentClaims: legacyPaymentClaims(row.raw_data),
            },
          }
        : {},
  };
}
