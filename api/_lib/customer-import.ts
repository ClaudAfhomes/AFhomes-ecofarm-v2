import {
  CUSTOMER_EXPORT_COLUMNS,
  CUSTOMER_IMPORT_COLUMNS,
  CUSTOMER_IMPORT_ROW_LIMIT,
  MEMBERSHIP_TEMPLATE_COLUMNS,
  MEMBERSHIP_TEMPLATE_POSITION_MAP,
  PERSON_NAME_RE,
  dateOfBirthSchema,
  emailSchema,
  personNameSchema,
  categoryRequiresMember,
  compareMoney,
  customerStatusForCategory,
  googleSheetCsvUrl,
  mapSourceStatus,
  normalizeAddressField,
  normalizeEmail,
  normalizePersonName,
  normalizePhilippinePhone,
  normalizeTier,
  parseGoogleSheetUrl,
  resolveCustomerCategory,
  type CustomerCategory,
  type CustomerExportRow,
} from '@afhomes/contracts';
import { escapeCsvCell, toCsv, toXlsx, type XlsxColumn } from './report-export.js';

/* ------------------------------------------------------------------ */
/* Upload envelope limits (mirror the official-forms import caps)      */
/* ------------------------------------------------------------------ */

export const MAX_IMPORT_BYTES = 8_000_000;
export const MAX_IMPORT_ROWS = CUSTOMER_IMPORT_ROW_LIMIT;
export const MAX_SHEET_FETCH_BYTES = 5_000_000;
const SHEET_FETCH_TIMEOUT_MS = 20000;

/* ------------------------------------------------------------------ */
/* Dependency-free XLSX reader (stored AND deflated entries)           */
/* ------------------------------------------------------------------ */

export { readXlsx as parseXlsxMatrix, readXlsxSheets as parseXlsxSheets } from './customer-xlsx.js';

/* ------------------------------------------------------------------ */
/* Dependency-free UTF-8 CSV reader (RFC 4180, BOM-tolerant)           */
/* ------------------------------------------------------------------ */

export function parseCsvMatrix(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  while (i < input.length) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        cell += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      pushCell();
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      pushCell();
      rows.push(row);
      row = [];
      i += input[i] === '\r' && input[i + 1] === '\n' ? 2 : 1;
    } else {
      cell += ch;
      i += 1;
    }
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field');
  pushCell();
  rows.push(row);
  // Drop a single trailing blank line; keep intentional blank rows elsewhere.
  while (rows.length > 1 && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  if (rows.length === 0) throw new Error('CSV has no rows');
  return rows;
}

/* ------------------------------------------------------------------ */
/* Matrix to field records                                             */
/* ------------------------------------------------------------------ */

export type ImportFieldRow = { rowNumber: number; fields: Record<string, string> };

export function matrixToRecords(
  matrix: string[][],
  extraKnown: readonly string[] = [],
): {
  headers: string[];
  unknownHeaders: string[];
  rows: ImportFieldRow[];
} {
  const known = new Set<string>([...CUSTOMER_IMPORT_COLUMNS, ...extraKnown]);
  const headers = (matrix[0] ?? []).map((h) => h.trim().toLowerCase());
  if (headers.every((h) => h === '')) throw new Error('Spreadsheet header row is empty');
  const unknownHeaders = headers.filter((h) => h !== '' && !known.has(h));
  const rows: ImportFieldRow[] = [];
  matrix.slice(1).forEach((cells, index) => {
    if (cells.every((c) => (c ?? '').trim() === '')) return;
    const fields: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header !== '') fields[header] = (cells[i] ?? '').trim();
    });
    rows.push({ rowNumber: index + 2, fields });
  });
  return { headers, unknownHeaders, rows };
}

/* ------------------------------------------------------------------ */
/* Google Sheets (link-readable only)                                  */
/* ------------------------------------------------------------------ */

export async function fetchGoogleSheetCsv(sheetUrl: string): Promise<string> {
  const ref = parseGoogleSheetUrl(sheetUrl);
  if (!ref) throw new Error('Not a valid Google Sheets URL');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHEET_FETCH_TIMEOUT_MS);
  try {
    const exportUrl = new URL(googleSheetCsvUrl(ref));
    let current = exportUrl;
    const visited = new Set<string>();
    let res: Response;
    for (let hops = 0; ; hops++) {
      visited.add(current.href);
      res = await fetch(current.href, { signal: controller.signal, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new Error('Google Sheets redirect has no destination');
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new Error('Google Sheets redirect destination is invalid');
      }
      // Observed Sheets CSV flow: docs.google.com -> doc-XX-XX-sheets
      // .googleusercontent.com/export/.... No general Google suffix allowlist.
      const allowedHost =
        (next.hostname === 'docs.google.com' && next.pathname === exportUrl.pathname) ||
        (/^doc-[a-z0-9]{2}-[a-z0-9]{2}-sheets\.googleusercontent\.com$/.test(next.hostname) &&
          next.pathname.startsWith('/export/'));
      if (next.protocol !== 'https:' || next.username || next.password || next.port || !allowedHost)
        throw new Error('Google Sheets redirect destination is not permitted');
      if (visited.has(next.href)) throw new Error('Google Sheets redirect loop detected');
      if (hops >= 3) throw new Error('Google Sheets redirect limit exceeded');
      current = next;
    }
    if (!res.ok)
      throw new Error(
        res.status === 401 || res.status === 403
          ? 'Private sheet: Google OAuth/service-credential configuration is required (not configured)'
          : `Google Sheets export failed (status ${res.status})`,
      );
    const contentType = res.headers.get('content-type') ?? '';
    if (!/^(text\/csv|text\/plain|application\/octet-stream)(?:;|$)/i.test(contentType))
      throw new Error(
        'Google Sheets export unavailable: private sheets require OAuth configuration',
      );
    if (Number(res.headers.get('content-length')) > MAX_SHEET_FETCH_BYTES) {
      controller.abort();
      await res.body?.cancel().catch(() => {});
      throw new Error('Google Sheet exceeds the import size limit');
    }
    if (!res.body) throw new Error('Google Sheets response has no body');
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SHEET_FETCH_BYTES) {
        controller.abort();
        await reader.cancel().catch(() => {});
        throw new Error('Google Sheet exceeds the import size limit');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (
      /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(text) ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)
    )
      throw new Error(
        'Google Sheets export unavailable: private sheets require OAuth configuration',
      );
    return text;
  } catch (error) {
    controller.abort();
    if (error instanceof Error && error.name === 'AbortError')
      throw new Error('Google Sheets request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Row validation + normalization (single source for XLSX/CSV/Sheets)  */
/* ------------------------------------------------------------------ */

export type ImportContext = {
  plansByTier: Map<string, { id: string; code: string }>;
  customerByNumber: Map<string, { id: string; email: string }>;
  customerByEmail: Map<string, { id: string }>;
  membershipByNumber: Map<string, { id: string; customerId: string }>;
  referralStaffByCode: Map<string, string>;
  seenMembershipNumbers: Map<string, number>;
};

export type NormalizedImportRow = {
  category: CustomerCategory;
  tier: string | null;
  customerStatus: string;
  person: Record<string, string | null>;
  /** Company-stated verbatim fields (see migration 20261130000001). All nullable; never computed. */
  company: Record<string, string | null>;
  payment: { amount: string; date: string | null; method: string; reference: string | null } | null;
  historicalSaleTotal: string | null;
  paymentScheme: string | null;
  historicalReservationFee: string | null;
  historicalRequiredInitial: string | null;
  totalPaid: string | null;
  membershipNumber: string | null;
  activationDate: string | null;
  expiresAt: string | null;
  openingBalance: number;
  memberStatus: string;
  requireMember: boolean;
  secondaryNote: string | null;
};

export type ValidatedImportRow = {
  rowNumber: number;
  fields: Record<string, string>;
  normalized: NormalizedImportRow | null;
  validation: 'valid' | 'warning' | 'error';
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'CONFLICT';
  customerId: string | null;
  membershipId: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FORMULA_RE = /^[=+\-@\t\r]/;
const MEMBERSHIP_NUMBER_RE = /^MBS-(?:\d{6}|[0-9A-F]{8}(?:-[0-9A-F]{8}){3})$/;

const isRealDate = (value: string) => {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
};

const nonEmpty = (value: string | undefined) => (value ?? '').trim() !== '';

/** Opening balances are whole non-negative points; negatives are rejected by policy. */
export function parseOpeningBalance(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

export function validateImportRow(
  rowNumber: number,
  fields: Record<string, string>,
  ctx: ImportContext,
  today: string,
): ValidatedImportRow {
  const errors: { field: string; message: string }[] = [];
  const warnings: { field: string; message: string }[] = [];
  const err = (field: string, message: string) => errors.push({ field, message });
  const warn = (field: string, message: string) => warnings.push({ field, message });
  const get = (name: string) => (fields[name] ?? '').trim();

  for (const [field, value] of Object.entries(fields))
    if (FORMULA_RE.test(value)) warn(field, 'Formula-like content is stored as plain text');

  if (!nonEmpty(get('first_name'))) err('first_name', 'Required');
  else if (!personNameSchema.safeParse(get('first_name')).success)
    err('first_name', 'Use letters, spaces, apostrophes and hyphens only');
  if (!nonEmpty(get('last_name'))) err('last_name', 'Required');
  else if (!personNameSchema.safeParse(get('last_name')).success)
    err('last_name', 'Use letters, spaces, apostrophes and hyphens only');
  if (nonEmpty(get('middle_name')) && !personNameSchema.safeParse(get('middle_name')).success)
    err('middle_name', 'Use letters, spaces, apostrophes and hyphens only');
  if (nonEmpty(get('suffix')) && !PERSON_NAME_RE.test(get('suffix').replace(/\./g, '')))
    err('suffix', 'Use letters, spaces, apostrophes and hyphens only');
  if (!nonEmpty(get('email'))) err('email', 'Required');
  else if (!emailSchema.safeParse(get('email')).success) err('email', 'Invalid email');
  const mobile = normalizePhilippinePhone(get('mobile'));
  if (!nonEmpty(get('mobile'))) err('mobile', 'Required');
  else if (mobile === null) err('mobile', 'Invalid phone');
  if (nonEmpty(get('birth_date')) && !dateOfBirthSchema.safeParse(get('birth_date')).success)
    err('birth_date', 'Use a real past birth date within 120 years');
  for (const key of [
    'activation_date',
    'membership_expiry_date',
    'payment_date',
    'created_date',
  ] as const)
    if (nonEmpty(get(key)) && !isRealDate(get(key))) err(key, 'Use YYYY-MM-DD');
  if (nonEmpty(get('payment_date')) && get('payment_date') > today)
    err('payment_date', 'Historical payments cannot be dated in the future');
  if (
    nonEmpty(get('activation_date')) &&
    nonEmpty(get('membership_expiry_date')) &&
    get('membership_expiry_date') <= get('activation_date')
  )
    err('membership_expiry_date', 'Expiry must be after activation');

  const category = mapSourceStatus(get('source_status'));
  if (!category) err('source_status', 'Unknown status');
  const tier = nonEmpty(get('vip_tier')) ? normalizeTier(get('vip_tier')) : null;
  if (nonEmpty(get('vip_tier')) && !tier) err('vip_tier', 'Unknown tier');

  const hasSecondary =
    nonEmpty(get('secondary_first_name')) ||
    nonEmpty(get('secondary_last_name')) ||
    nonEmpty(get('secondary_email')) ||
    nonEmpty(get('secondary_mobile')) ||
    nonEmpty(get('secondary_birth_date'));
  if (hasSecondary && tier !== 'GOLD') err('secondary_first_name', 'Secondary holder is Gold-only');
  for (const field of [
    'secondary_first_name',
    'secondary_middle_name',
    'secondary_last_name',
  ] as const)
    if (nonEmpty(get(field)) && !personNameSchema.safeParse(get(field)).success)
      err(field, 'Use letters, spaces, apostrophes and hyphens only');
  if (nonEmpty(get('secondary_email')) && !emailSchema.safeParse(get('secondary_email')).success)
    err('secondary_email', 'Invalid email');
  const secondaryMobileRaw = get('secondary_mobile');
  const secondaryMobile = secondaryMobileRaw ? normalizePhilippinePhone(secondaryMobileRaw) : null;
  if (secondaryMobileRaw && secondaryMobile === null) err('secondary_mobile', 'Invalid phone');
  if (
    nonEmpty(get('secondary_birth_date')) &&
    !dateOfBirthSchema.safeParse(get('secondary_birth_date')).success
  )
    err('secondary_birth_date', 'Use a real past birth date within 120 years');

  // Company-template verbatim fields: trimmed hygiene caps only, reusing the
  // established validators where one exists. Values are stored exactly as
  // stated; nothing here interprets business meaning (no tier/scheme/status
  // translation, no money coherence beyond the historical rules above).
  const capped = (key: string, max: number) => {
    if (get(key).length > max) err(key, `Keep to ${max} characters or fewer`);
  };
  for (const key of ['ra_number'] as const) capped(key, 120);
  for (const key of [
    'citizenship',
    'civil_status',
    'employed_position',
    'supplementary_citizenship',
    'supplementary_civil_status',
    'supplementary_position',
  ] as const)
    capped(key, 100);
  for (const key of ['tin_number', 'supplementary_tin_number'] as const) capped(key, 40);
  for (const key of [
    'occupation_business_name',
    'office_business_address',
    'supplementary_address',
    'supplementary_occupation_business_name',
    'supplementary_office_address',
  ] as const)
    capped(key, 200);
  for (const key of [
    'supplementary_full_name',
    'ost_ist_name',
    'svd_name',
    'ssm_name',
    'sm_name',
    'referrer_name',
    'vip_recommender_name',
  ] as const) {
    if (nonEmpty(get(key)) && !personNameSchema.safeParse(get(key)).success)
      err(key, 'Use letters, spaces, apostrophes and hyphens only');
    else capped(key, 120);
  }
  for (const key of [
    'stated_regular_price',
    'stated_discount',
    'stated_total_amount',
    'stated_rf',
  ] as const)
    capped(key, 120);
  if (
    nonEmpty(get('supplementary_birthday')) &&
    !dateOfBirthSchema.safeParse(get('supplementary_birthday')).success
  )
    err('supplementary_birthday', 'Use a real past birth date within 120 years');
  if (nonEmpty(get('supplementary_gender'))) {
    // Mirror the established sex handling below: unrecognized values resolve
    // to null in normalization rather than failing the row.
    const g = get('supplementary_gender').toLowerCase();
    if (g !== 'male' && g !== 'female' && g !== 'other' && g !== 'undisclosed')
      warn('supplementary_gender', 'Unrecognized gender resolves to no value');
  }
  const relatedContactRaw = get('related_contact_no');
  if (relatedContactRaw && normalizePhilippinePhone(relatedContactRaw) === null)
    err('related_contact_no', 'Invalid phone');
  if (nonEmpty(get('related_email')) && !emailSchema.safeParse(get('related_email')).success)
    err('related_email', 'Invalid email');

  const balance = parseOpeningBalance(get('current_points_balance'));
  if (balance === null) err('current_points_balance', 'Must be a whole non-negative number');

  const historicalTotal = get('historical_sale_total');
  if (
    nonEmpty(historicalTotal) &&
    (!/^\d+(\.\d{1,2})?$/.test(historicalTotal) || compareMoney(historicalTotal, '0.00') !== 1)
  )
    err('historical_sale_total', 'Positive exact-decimal historical total required');
  const scheme = get('payment_scheme');
  if (
    scheme &&
    !['spot_cash', 'move_a', 'installment_4_month', 'move_b1_40_12', 'move_b2_25_12'].includes(
      scheme,
    )
  )
    err('payment_scheme', 'Unknown payment scheme');
  for (const field of ['historical_reservation_fee', 'historical_required_initial'] as const) {
    if (get(field) && !/^\d+(\.\d{1,2})?$/.test(get(field)))
      err(field, 'Exact-decimal historical snapshot required');
  }
  if (category === 'DOWN_PAYMENT_COMPLETED') {
    if (!scheme || !get('historical_required_initial') || !get('historical_reservation_fee'))
      err(
        'payment_scheme',
        'Down-payment classification requires the actual historical scheme, reservation and required-initial snapshots',
      );
    else if (
      compareMoney(get('historical_required_initial'), get('historical_reservation_fee')) !== 1
    )
      err('historical_required_initial', 'Down-payment threshold must exceed the reservation fee');
    else if (compareMoney(get('payment_amount'), get('historical_required_initial')) === -1)
      err('payment_amount', 'Payment does not meet the historical down-payment threshold');
  }
  if (category === 'RESERVATION_PAID' && !get('historical_reservation_fee'))
    err(
      'historical_reservation_fee',
      'Reservation classification requires the actual historical reservation fee',
    );
  if (get('payment_amount') && !scheme)
    err('payment_scheme', 'Actual historical payment scheme is required');
  if (
    get('payment_amount') &&
    scheme &&
    scheme !== 'spot_cash' &&
    (!get('historical_reservation_fee') || !get('historical_required_initial'))
  )
    err(
      'historical_required_initial',
      'Non-spot-cash history requires actual reservation and required-initial snapshots',
    );
  const hasPayment = nonEmpty(get('payment_amount'));
  let payment: NormalizedImportRow['payment'] = null;
  if (hasPayment) {
    if (!isRealDate(get('payment_date')))
      err('payment_date', 'Historical payment date is required (YYYY-MM-DD)');
    if (!nonEmpty(get('payment_method')))
      err('payment_method', 'Historical payment method is required');
    if (!/^\d+(\.\d{1,2})?$/.test(get('payment_amount')))
      err('payment_amount', 'Must be a positive exact-decimal amount');
    else if (compareMoney(get('payment_amount'), '0.00') !== 1)
      err('payment_amount', 'Must be greater than zero');
    else
      payment = {
        amount: get('payment_amount'),
        date: nonEmpty(get('payment_date')) ? get('payment_date') : null,
        method: get('payment_method'),
        reference: nonEmpty(get('payment_reference')) ? get('payment_reference') : null,
      };
  }
  if (hasPayment && !historicalTotal)
    warn(
      'historical_sale_total',
      'Current plan price is an explicit estimate; it is not historical price evidence',
    );
  if (nonEmpty(get('total_paid'))) {
    if (!/^\d+(\.\d{1,2})?$/.test(get('total_paid')))
      err('total_paid', 'Must be an exact-decimal amount');
    else if (hasPayment && compareMoney(get('total_paid'), get('payment_amount')) !== 0)
      err('total_paid', 'Must equal the supplied payment amount');
    else if (!hasPayment) err('total_paid', 'Needs its payment row (amount, date, method)');
  }

  const moneyCategory =
    category === 'ACTIVE_VIP' ||
    category === 'FULLY_PAID_AWAITING_ACTIVATION' ||
    category === 'PARTIALLY_PAID' ||
    category === 'DOWN_PAYMENT_COMPLETED' ||
    category === 'RESERVATION_PAID';
  if (moneyCategory && !hasPayment && category !== 'ACTIVE_VIP')
    err('payment_amount', `A payment row is required for ${category}`);
  if (!moneyCategory && hasPayment && category !== 'SUSPENDED' && category !== 'EXPIRED')
    err('payment_amount', `No payment applies to ${category}`);

  if (
    category &&
    categoryRequiresMember(category) &&
    !ctx.membershipByNumber.has(get('membership_number'))
  ) {
    if (!historicalTotal)
      err('historical_sale_total', 'New legacy members require their historical frozen sale total');
    if (!tier) err('vip_tier', 'Tier is required for an Active VIP row');
    if (!hasPayment)
      err('payment_amount', 'Payment history is required; economics are never invented');
  }

  // Duplicate matching (priority: membership_number > customer_number > email).
  let action: ValidatedImportRow['action'] = 'CREATE';
  let customerId: string | null = null;
  let membershipId: string | null = null;
  const suppliedMemberNo = nonEmpty(get('membership_number')) ? get('membership_number') : null;
  if (suppliedMemberNo && !MEMBERSHIP_NUMBER_RE.test(suppliedMemberNo))
    err('membership_number', 'Use an existing MBS member number or leave blank to generate');
  const matchedMember = suppliedMemberNo ? ctx.membershipByNumber.get(suppliedMemberNo) : undefined;
  const matchedCustomerNo = nonEmpty(get('customer_number'))
    ? ctx.customerByNumber.get(get('customer_number'))
    : undefined;
  const matchedEmail = ctx.customerByEmail.get(get('email').toLowerCase());

  if (suppliedMemberNo && !matchedMember) {
    // Supplied + unused: accepted for CREATE (validated unique again at commit).
  }
  if (matchedMember) {
    membershipId = matchedMember.id;
    customerId = matchedMember.customerId;
    action = 'UPDATE';
    if (matchedCustomerNo && matchedCustomerNo.id !== matchedMember.customerId)
      err('customer_number', 'Customer number contradicts membership ownership');
    if (matchedEmail && matchedEmail.id !== matchedMember.customerId)
      err('email', 'Email belongs to a different customer than the membership');
    if (
      category &&
      category !== 'ACTIVE_VIP' &&
      category !== 'SUSPENDED' &&
      category !== 'EXPIRED' &&
      category !== 'CANCELLED'
    )
      err('source_status', 'Only member lifecycle states can update an existing membership');
  } else if (matchedCustomerNo) {
    customerId = matchedCustomerNo.id;
    action = 'UPDATE';
    if (matchedEmail && matchedEmail.id !== matchedCustomerNo.id)
      err('email', 'Email belongs to a different customer than the customer number');
  } else if (matchedEmail) {
    customerId = matchedEmail.id;
    action = 'UPDATE';
  }
  if (action === 'UPDATE' && hasPayment)
    err(
      'payment_amount',
      'Existing-record updates cannot import payments; use the normal payment workflow',
    );
  if (nonEmpty(get('customer_number')) && !matchedCustomerNo)
    warn('customer_number', 'Unknown number: a new customer number will be generated');
  if (
    category === 'EXPIRED' &&
    !matchedMember &&
    (!get('membership_expiry_date') || get('membership_expiry_date') >= today)
  )
    err('membership_expiry_date', 'An expired member needs a past expiry date');

  // Multi-payment guard: one payment group per membership per file.
  if (suppliedMemberNo && hasPayment) {
    const seen = ctx.seenMembershipNumbers.get(suppliedMemberNo) ?? 0;
    ctx.seenMembershipNumbers.set(suppliedMemberNo, seen + 1);
    if (seen >= 1)
      err(
        'payment_amount',
        'Multiple historical payments per membership are unsupported; use the normal payment workflow',
      );
  }

  if (errors.length > 0)
    return {
      rowNumber,
      fields,
      normalized: null,
      validation: 'error',
      errors,
      warnings,
      action: 'CONFLICT',
      customerId,
      membershipId,
    };

  const normalized: NormalizedImportRow = {
    category: category!,
    tier,
    customerStatus: customerStatusForCategory(category!),
    person: {
      firstName: normalizePersonName(get('first_name')),
      middleName: nonEmpty(get('middle_name')) ? normalizePersonName(get('middle_name')) : null,
      lastName: normalizePersonName(get('last_name')),
      suffix: nonEmpty(get('suffix')) ? normalizePersonName(get('suffix')) : null,
      birthDate: get('birth_date') || null,
      gender: (() => {
        const g = get('sex').toLowerCase();
        return g === 'male' || g === 'female' || g === 'other' || g === 'undisclosed' ? g : null;
      })(),
      email: normalizeEmail(get('email')) ?? get('email'),
      phone: mobile ?? get('mobile'),
    },
    payment,
    historicalSaleTotal: nonEmpty(get('historical_sale_total'))
      ? get('historical_sale_total')
      : null,
    paymentScheme: scheme || null,
    historicalReservationFee: get('historical_reservation_fee') || null,
    historicalRequiredInitial: get('historical_required_initial') || null,
    totalPaid: nonEmpty(get('total_paid')) ? get('total_paid') : payment ? payment.amount : null,
    membershipNumber: suppliedMemberNo,
    activationDate: get('activation_date') || null,
    expiresAt: get('membership_expiry_date') || null,
    openingBalance: balance ?? 0,
    memberStatus:
      category === 'SUSPENDED' ? 'suspended' : category === 'EXPIRED' ? 'expired' : 'active',
    requireMember: categoryRequiresMember(category!),
    secondaryNote:
      tier === 'GOLD' && hasSecondary
        ? [
            [get('secondary_first_name'), get('secondary_middle_name'), get('secondary_last_name')]
              .filter(Boolean)
              .map((part) => normalizePersonName(part))
              .join(' '),
            normalizeEmail(get('secondary_email')) ?? get('secondary_email'),
            secondaryMobile ?? secondaryMobileRaw,
          ]
            .filter(Boolean)
            .join(' · ') || null
        : null,
    company: {
      raNumber: get('ra_number') || null,
      // Raw echo of the stated status; lifecycle mapping stays in customerStatus.
      companyStatus: get('source_status') || null,
      citizenship: get('citizenship') || null,
      civilStatus: get('civil_status') || null,
      tinNumber: get('tin_number') || null,
      occupationBusinessName: get('occupation_business_name') || null,
      officeBusinessAddress: get('office_business_address') || null,
      employedPosition: get('employed_position') || null,
      supplementaryFullName: get('supplementary_full_name') || null,
      supplementaryAddress: get('supplementary_address') || null,
      supplementaryBirthday: get('supplementary_birthday') || null,
      supplementaryGender: ((): string | null => {
        const g = get('supplementary_gender').toLowerCase();
        return g === 'male' || g === 'female' || g === 'other' || g === 'undisclosed' ? g : null;
      })(),
      supplementaryCitizenship: get('supplementary_citizenship') || null,
      supplementaryCivilStatus: get('supplementary_civil_status') || null,
      supplementaryTinNumber: get('supplementary_tin_number') || null,
      supplementaryOccupationBusinessName: get('supplementary_occupation_business_name') || null,
      supplementaryOfficeAddress: get('supplementary_office_address') || null,
      supplementaryPosition: get('supplementary_position') || null,
      ostIstName: get('ost_ist_name') || null,
      svdName: get('svd_name') || null,
      ssmName: get('ssm_name') || null,
      smName: get('sm_name') || null,
      referrerName: get('referrer_name') || null,
      vipRecommenderName: get('vip_recommender_name') || null,
      relatedContactNo: get('related_contact_no') || null,
      relatedEmail: get('related_email') || null,
      statedVipPackage: get('vip_tier') || null,
      statedPaymentTerms: get('payment_scheme') || null,
      statedRegularPrice: get('stated_regular_price') || null,
      statedDiscount: get('stated_discount') || null,
      statedTotalAmount: get('stated_total_amount') || null,
      statedRf: get('stated_rf') || null,
      statedPaymentType: get('payment_method') || null,
      statedRefNo: get('payment_reference') || null,
      statedPaymentDate: get('payment_date') || null,
    },
  };
  if (tier && !hasSecondary && nonEmpty(get('vip_tier')) && category !== 'ACTIVE_VIP')
    warn('vip_tier', 'Tier is informational without a membership or payment intent');
  if (balance !== null && balance > 0 && !normalized.requireMember)
    err('current_points_balance', 'An opening balance needs an active-member row');
  if (errors.length > 0)
    return {
      rowNumber,
      fields,
      normalized: null,
      validation: 'error',
      errors,
      warnings,
      action: 'CONFLICT',
      customerId,
      membershipId,
    };
  return {
    rowNumber,
    fields: {
      ...fields,
      first_name: normalized.person.firstName ?? '',
      middle_name: normalized.person.middleName ?? '',
      last_name: normalized.person.lastName ?? '',
      suffix: normalized.person.suffix ?? '',
      email: normalized.person.email ?? '',
      mobile: normalized.person.phone ?? '',
      ...(secondaryMobile ? { secondary_mobile: secondaryMobile } : {}),
    },
    normalized,
    validation: warnings.length > 0 ? 'warning' : 'valid',
    errors,
    warnings,
    action,
    customerId,
    membershipId,
  };
}

/* ------------------------------------------------------------------ */
/* Export rendering (XLSX/CSV share one row matrix; formulas neutral)  */
/* ------------------------------------------------------------------ */

/** Prefix spreadsheet-formula leaders so exports can never execute on open. */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const exportColumns = (headers: readonly string[]): XlsxColumn[] =>
  headers.map((label) => ({
    label,
    type: 'text' as const,
    width: Math.min(36, Math.max(16, label.length + 2)),
  }));

export const customerExportXlsx = (rows: CustomerExportRow[]) =>
  toXlsx('Customers', exportColumns(CUSTOMER_EXPORT_COLUMNS), [
    ...rows.map((row) =>
      CUSTOMER_EXPORT_COLUMNS.map((header) => neutralizeFormula(row[header] ?? '')),
    ),
  ]);

export const customerExportCsv = (rows: CustomerExportRow[]): string =>
  toCsv(
    [...CUSTOMER_EXPORT_COLUMNS],
    rows.map((row) => CUSTOMER_EXPORT_COLUMNS.map((h) => row[h] ?? '')),
  );

/* ------------------------------------------------------------------ */
/* Company membership template (45 columns) + positional import mapping */
/* ------------------------------------------------------------------ */

export type MembershipTemplateSection = {
  /** Worksheet tab name (<=31 chars, no :\/?*[]). */
  sheet: string;
  /** Slice of MEMBERSHIP_TEMPLATE_COLUMNS, verbatim order. */
  headers: readonly string[];
  /** Header tint for the downloadable workbook. */
  tone: 'blue' | 'green' | 'amber' | 'purple';
  /** One-line guidance rendered on the README tab. */
  blurb: string;
};

/**
 * The 45 company columns grouped for guided entry: one tab per member
 * group instead of one 45-wide wall. Slices are positional views of
 * MEMBERSHIP_TEMPLATE_COLUMNS, so the single-sheet order, the duplicates
 * (ADDRESS x2, EMAIL ADDRESS x3, AGE x2, FULL NAME x2) and the positional
 * remap below stay the single source of truth - this list only decides
 * which tab a verbatim header is printed on.
 */
export const MEMBERSHIP_TEMPLATE_SECTIONS: readonly MembershipTemplateSection[] = [
  {
    sheet: 'Primary',
    headers: MEMBERSHIP_TEMPLATE_COLUMNS.slice(0, 15),
    tone: 'blue',
    blurb: 'Primary member identity, contact, work, and company status.',
  },
  {
    sheet: 'Supplementary',
    headers: MEMBERSHIP_TEMPLATE_COLUMNS.slice(15, 28),
    tone: 'green',
    blurb: 'Supplementary member facts. Leave the whole row blank when none.',
  },
  {
    sheet: 'Related',
    headers: MEMBERSHIP_TEMPLATE_COLUMNS.slice(28, 36),
    tone: 'amber',
    blurb: 'Referral chain and related-person contact, stated verbatim.',
  },
  {
    sheet: 'Package',
    headers: MEMBERSHIP_TEMPLATE_COLUMNS.slice(36, 45),
    tone: 'purple',
    blurb: 'Stated package and payment facts. Reference only, never totals.',
  },
];

/** Sheet names the sectioned parser skips (guidance, never data). */
export const MEMBERSHIP_TEMPLATE_GUIDE_SHEETS = ['readme', 'instructions', 'guide', 'example', 'examples'];

const membershipTemplateColumns = (): XlsxColumn[] =>
  MEMBERSHIP_TEMPLATE_COLUMNS.map((label) => ({
    label,
    type: 'text' as const,
    width: Math.min(36, Math.max(16, label.length + 2)),
  }));

/** Stable single-sheet membership template: all 45 headers, no data rows. */
export const membershipTemplateXlsx = () =>
  toXlsx('Membership Template', membershipTemplateColumns(), [[]]);

/** CSV twin of the membership template (same 45 columns, same order). */
export const membershipTemplateCsv = (): string => toCsv([...MEMBERSHIP_TEMPLATE_COLUMNS], [[]]);

/**
 * True when a spreadsheet header row is exactly the 45-column company
 * membership template (compared trimmed + lowercased, order-sensitive).
 * Duplicated headers (ADDRESS, EMAIL ADDRESS, …) make name-based matching
 * ambiguous, so only an exact positional match qualifies for remapping.
 */
export function isCompanyMembershipTemplate(headers: string[]): boolean {
  if (headers.length !== MEMBERSHIP_TEMPLATE_COLUMNS.length) return false;
  return MEMBERSHIP_TEMPLATE_COLUMNS.every(
    (column, index) => (headers[index] ?? '').trim().toLowerCase() === column.toLowerCase(),
  );
}

export type CompanyTemplateRemap = {
  matrix: string[][];
  /** Company headers with no v2 target, in column order. */
  dropped: { index: number; header: string }[];
};

/**
 * Rewrite a company-template matrix onto import columns by POSITION.
 * Mapped positions take their import column name; unmapped positions keep a
 * marker header so they surface as ignored-column warnings naming the exact
 * company header. Values are never transformed here - validation downstream
 * decides what each value means.
 */
export function remapCompanyTemplateMatrix(matrix: string[][]): CompanyTemplateRemap {
  const [headerRow = [], ...body] = matrix;
  const dropped: { index: number; header: string }[] = [];
  const headers = headerRow.map((header, index) => {
    const target = MEMBERSHIP_TEMPLATE_POSITION_MAP[index] ?? null;
    if (target) return target;
    dropped.push({ index, header: (header ?? '').trim() });
    return `__company_ignored_${index}`;
  });
  return { matrix: [headers, ...body], dropped };
}

export type SectionedTemplateMerge = {
  /** Canonical 45-column company matrix, ready for the positional remap. */
  matrix: string[][];
  /** Headers found on section tabs with no v2 meaning, for warnings. */
  unknownHeaders: string[];
};

/**
 * Merge a sectioned membership workbook (README + Primary/Supplementary/
 * Related/Package tabs) back into the canonical 45-column company matrix.
 *
 * Matching is by accurate column NAME within each tab's group, in any order:
 * every non-empty header must belong to exactly one section's verbatim set,
 * and the tab is that section. Missing columns read as blank; unknown ones
 * are reported (never merged). Rows merge by POSITION across tabs, so every
 * data tab must carry the same number of data rows - keep the same row order
 * on every tab and leave unused rows blank instead of deleting them. Guide
 * sheets (README and friends) are skipped, never data.
 */
export function mergeSectionedTemplateSheets(
  sheets: { name: string; matrix: string[][] }[],
): SectionedTemplateMerge {
  const guide = new Set(MEMBERSHIP_TEMPLATE_GUIDE_SHEETS);
  const data = sheets.filter((sheet) => !guide.has(sheet.name.trim().toLowerCase()));
  if (data.length === 0) throw new Error('Sectioned template has no entry sheets');
  const sectionOf = (headers: string[]): number => {
    let best = -1;
    let bestHits = 0;
    MEMBERSHIP_TEMPLATE_SECTIONS.forEach((section, si) => {
      const expected = new Set(section.headers.map((h) => h.toLowerCase()));
      const hits = headers.filter((h) => h !== '' && expected.has(h)).length;
      const foreign = headers.filter((h) => h !== '' && !expected.has(h)).length;
      if (foreign === 0 && hits > bestHits) {
        best = si;
        bestHits = hits;
      }
    });
    return bestHits > 0 ? best : -1;
  };
  const bySection = new Map<number, { name: string; matrix: string[][] }>();
  const unknownHeaders: string[] = [];
  for (const sheet of data) {
    const headers = (sheet.matrix[0] ?? []).map((h) => (h ?? '').trim().toLowerCase());
    if (headers.every((h) => h === '')) throw new Error('Spreadsheet header row is empty');
    const si = sectionOf(headers);
    if (si < 0)
      throw new Error(
        `Worksheet "${sheet.name}" does not match a template section; ` +
          'use the downloaded tabs with their exact headers, or a single worksheet instead',
      );
    if (bySection.has(si))
      throw new Error(
        `Duplicate "${MEMBERSHIP_TEMPLATE_SECTIONS[si]!.sheet}" sheets; keep one tab per section`,
      );
    const expected = new Set(
      MEMBERSHIP_TEMPLATE_SECTIONS[si]!.headers.map((h) => h.toLowerCase()),
    );
    for (const h of headers)
      if (h !== '' && !expected.has(h) && !unknownHeaders.includes(h)) unknownHeaders.push(h);
    bySection.set(si, sheet);
  }
  if (bySection.size !== MEMBERSHIP_TEMPLATE_SECTIONS.length) {
    const missing = MEMBERSHIP_TEMPLATE_SECTIONS.filter((_, si) => !bySection.has(si)).map(
      (section) => section.sheet,
    );
    throw new Error(`Sectioned template is missing sheets: ${missing.join(', ')}`);
  }
  // Row alignment: trim trailing blank rows per tab, then require agreement.
  // A blank row inside the range still counts, so a deleted middle row cannot
  // silently shift one tab's persons out of line with the others.
  const bodies = MEMBERSHIP_TEMPLATE_SECTIONS.map((section, si) => {
    const body = bySection.get(si)!.matrix.slice(1);
    let end = body.length;
    while (end > 0 && (body[end - 1] ?? []).every((c) => (c ?? '').trim() === '')) end -= 1;
    return body.slice(0, end);
  });
  const counts = bodies.map((body) => body.length);
  if (!counts.every((n) => n === counts[0]))
    throw new Error(
      `Section sheets have different row counts (${MEMBERSHIP_TEMPLATE_SECTIONS.map(
        (section, si) => `${section.sheet} has ${counts[si]}`,
      ).join(', ')}). Keep the same row order across sheets.`,
    );
  // Canonical positions per section: the sections are slices of the 45, so
  // the k-th header of section si lives at offset[si] + k. Offsets (not
  // indexOf) break the verbatim duplicates across tabs: ADDRESS on the
  // Supplementary tab lands at 16, never at Primary's 3.
  const offsets: number[] = [];
  let at = 0;
  for (const section of MEMBERSHIP_TEMPLATE_SECTIONS) {
    offsets.push(at);
    at += section.headers.length;
  }
  const canonical = [...MEMBERSHIP_TEMPLATE_COLUMNS];
  const rows: string[][] = [];
  for (let r = 0; r < (counts[0] ?? 0); r += 1) {
    const out = new Array<string>(canonical.length).fill('');
    MEMBERSHIP_TEMPLATE_SECTIONS.forEach((section, si) => {
      const headers = (bySection.get(si)!.matrix[0] ?? []).map((h) => (h ?? '').trim().toLowerCase());
      const seen = new Set<string>();
      for (const h of headers) {
        if (h === '') continue;
        if (seen.has(h))
          throw new Error(
            `Worksheet "${bySection.get(si)!.name}" repeats "${h}"; keep one column per header`,
          );
        seen.add(h);
      }
      const cells = bodies[si]![r] ?? [];
      section.headers.forEach((verbatim, k) => {
        const hi = headers.indexOf(verbatim.toLowerCase());
        if (hi >= 0) out[offsets[si]! + k] = cells[hi] ?? '';
      });
    });
    rows.push(out);
  }
  return { matrix: [canonical, ...rows], unknownHeaders };
}
