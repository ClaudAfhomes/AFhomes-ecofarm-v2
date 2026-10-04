import {
  CUSTOMER_EXPORT_COLUMNS,
  CUSTOMER_IMPORT_COLUMNS,
  CUSTOMER_IMPORT_ROW_LIMIT,
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
} from '@jad/contracts';
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

export { readXlsx as parseXlsxMatrix } from './customer-xlsx.js';

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

export function matrixToRecords(matrix: string[][]): {
  headers: string[];
  unknownHeaders: string[];
  rows: ImportFieldRow[];
} {
  const known = new Set<string>(CUSTOMER_IMPORT_COLUMNS);
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

/** Stable machine-readable template: one header row, no data rows. */
export const customerImportTemplateXlsx = () =>
  toXlsx(
    'Customer Import',
    CUSTOMER_IMPORT_COLUMNS.map((label) => ({
      label,
      type: 'text' as const,
      width: Math.min(36, Math.max(16, label.length + 2)),
    })),
    [[]],
  );

/** CSV twin of the template (same columns, same order). */
export const customerImportTemplateCsv = (): string => toCsv([...CUSTOMER_IMPORT_COLUMNS], [[]]);
