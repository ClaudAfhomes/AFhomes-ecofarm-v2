import { z } from 'zod';
import { vipTierSchema } from './official-forms.js';

export type VipTier = z.infer<typeof vipTierSchema>;

/**
 * AF Homes bulk customer import/export contracts.
 *
 * Single source for the spreadsheet vocabulary, the friendly-status mapping
 * into authoritative fields, and the derived display category. The Customers
 * screen and the import preview resolve categories through the SAME
 * `resolveCustomerCategory`, so the two can never disagree.
 *
 * Display categories are never persisted: only customer.status,
 * memberships.status and verified payment rows are authoritative.
 */

/* ------------------------------------------------------------------ */
/* Template vocabulary (stable machine-readable column names)          */
/* ------------------------------------------------------------------ */

export const CUSTOMER_IMPORT_COLUMNS = [
  'customer_number',
  'membership_number',
  'first_name',
  'middle_name',
  'last_name',
  'suffix',
  'birth_date',
  'sex',
  'citizenship',
  'civil_status',
  'email',
  'mobile',
  'landline',
  'tin',
  'address_line_1',
  'address_line_2',
  'city',
  'province',
  'postal_code',
  'country',
  'occupation',
  'business_name',
  'business_address',
  'industry',
  'position',
  'vip_tier',
  'source_status',
  'activation_date',
  'membership_expiry_date',
  'current_points_balance',
  'total_paid',
  'historical_sale_total',
  'payment_scheme',
  'historical_reservation_fee',
  'historical_required_initial',
  'payment_amount',
  'payment_date',
  'payment_method',
  'payment_reference',
  'seller_code',
  'seller_name',
  'referral_code',
  'created_date',
  'secondary_first_name',
  'secondary_middle_name',
  'secondary_last_name',
  'secondary_birth_date',
  'secondary_email',
  'secondary_mobile',
  'notes',
] as const;

export type CustomerImportColumn = (typeof CUSTOMER_IMPORT_COLUMNS)[number];

/** Hard cap: oversized imports are rejected with a clear error, never streamed. */
export const CUSTOMER_IMPORT_ROW_LIMIT = 5000;

export const importSourceSchema = z.enum(['excel', 'csv', 'google_sheets']);
export type ImportSource = z.infer<typeof importSourceSchema>;

export const importJobStatusSchema = z.enum([
  'uploaded',
  'parsing',
  'validated',
  'ready',
  'committing',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
]);
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

export const importRowActionSchema = z.enum(['CREATE', 'UPDATE', 'SKIP', 'CONFLICT']);
export type ImportRowAction = z.infer<typeof importRowActionSchema>;

export const importValidationSchema = z.enum(['pending', 'valid', 'warning', 'error']);
export type ImportValidation = z.infer<typeof importValidationSchema>;

/* ------------------------------------------------------------------ */
/* Tier normalization (case-insensitive, strict, no fuzzy guessing)    */
/* ------------------------------------------------------------------ */

/** Trim + scream. Unknown values return null (row validation error), never a guess. */
export function normalizeTier(value: unknown): VipTier | null {
  if (typeof value !== 'string') return null;
  const tier = value.trim().toUpperCase();
  return tier === 'BRONZE' || tier === 'SILVER' || tier === 'GOLD' ? tier : null;
}

/* ------------------------------------------------------------------ */
/* Source-status mapping into authoritative fields                     */
/* ------------------------------------------------------------------ */

export const customerCategorySchema = z.enum([
  'ACTIVE_VIP',
  'FULLY_PAID_AWAITING_ACTIVATION',
  'DOWN_PAYMENT_COMPLETED',
  'RESERVATION_PAID',
  'PARTIALLY_PAID',
  'PENDING',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'CANCELLED',
]);
export type CustomerCategory = z.infer<typeof customerCategorySchema>;

export const CUSTOMER_CATEGORY_LABELS: Record<CustomerCategory, string> = {
  ACTIVE_VIP: 'Active VIP',
  FULLY_PAID_AWAITING_ACTIVATION: 'Fully Paid — Awaiting Activation',
  DOWN_PAYMENT_COMPLETED: 'Down Payment Completed',
  RESERVATION_PAID: 'Reservation Paid',
  PARTIALLY_PAID: 'Partially Paid',
  PENDING: 'Pending',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
};

const SOURCE_STATUS_ALIASES: Record<string, CustomerCategory> = {
  activevip: 'ACTIVE_VIP',
  active: 'ACTIVE_VIP',
  vip: 'ACTIVE_VIP',
  fullypaid: 'FULLY_PAID_AWAITING_ACTIVATION',
  fullypaidawaitingactivation: 'FULLY_PAID_AWAITING_ACTIVATION',
  awaitingactivation: 'FULLY_PAID_AWAITING_ACTIVATION',
  downpayment: 'DOWN_PAYMENT_COMPLETED',
  downpaymentcompleted: 'DOWN_PAYMENT_COMPLETED',
  dp: 'DOWN_PAYMENT_COMPLETED',
  reservationpaid: 'RESERVATION_PAID',
  reservation: 'RESERVATION_PAID',
  partial: 'PARTIALLY_PAID',
  partiallypaid: 'PARTIALLY_PAID',
  part: 'PARTIALLY_PAID',
  pending: 'PENDING',
  inactive: 'INACTIVE',
  suspended: 'SUSPENDED',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
};

/** Friendly spreadsheet status to canonical category. Null = row error. */
export function mapSourceStatus(value: unknown): CustomerCategory | null {
  if (typeof value !== 'string') return null;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return SOURCE_STATUS_ALIASES[key] ?? null;
}

/** Authoritative customer.status for a canonical category (DB enum values). */
export function customerStatusForCategory(category: CustomerCategory): string {
  switch (category) {
    case 'PENDING':
      return 'prospect';
    case 'SUSPENDED':
    case 'INACTIVE':
      return 'suspended';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'active';
  }
}

/** Whether the category may create an active membership on CREATE. */
export function categoryRequiresMember(category: CustomerCategory): boolean {
  return ['ACTIVE_VIP', 'SUSPENDED', 'EXPIRED'].includes(category);
}

/* ------------------------------------------------------------------ */
/* Exact-decimal comparison (no float anywhere near money)             */
/* ------------------------------------------------------------------ */

function toCents(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '0').padEnd(2, '0'));
}

/** -1 | 0 | 1, or null when either side is not exact-decimal. */
export function compareMoney(a: string, b: string): number | null {
  const ac = toCents(a);
  const bc = toCents(b);
  if (ac === null || bc === null) return null;
  return ac < bc ? -1 : ac > bc ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Derived display category: THE shared resolver                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve the display category from authoritative state only. Used by the
 * Customers screen and the import preview alike; the result is never stored.
 */
export function resolveCustomerCategory(input: {
  customerStatus: string;
  membershipStatus: string | null;
  verifiedTotal: string;
  priceTotal: string;
  reservationFee?: string;
  requiredInitial?: string;
}): CustomerCategory {
  const { customerStatus, membershipStatus } = input;
  // Service-denying account states override an otherwise active card.
  if (customerStatus === 'cancelled' || membershipStatus === 'cancelled') return 'CANCELLED';
  if (customerStatus === 'suspended' || membershipStatus === 'suspended') return 'SUSPENDED';
  if (membershipStatus === 'expired') return 'EXPIRED';
  if (membershipStatus === 'active') return 'ACTIVE_VIP';
  const verified = compareMoney(input.verifiedTotal, '0.00');
  if (verified === null || verified <= 0)
    return customerStatus === 'prospect' ? 'PENDING' : 'ACTIVE';
  // Unparseable totals fail closed to PARTIALLY_PAID (money was verified > 0,
  // but the ceiling is unknown, so no stronger claim is made).
  const vsPrice = compareMoney(input.verifiedTotal, input.priceTotal);
  if (vsPrice === null) return 'PARTIALLY_PAID';
  if (vsPrice >= 0) return 'FULLY_PAID_AWAITING_ACTIVATION';
  if (
    input.requiredInitial &&
    compareMoney(input.requiredInitial, input.reservationFee ?? '0.00') === 1
  ) {
    const vsInitial = compareMoney(input.verifiedTotal, input.requiredInitial);
    if (vsInitial !== null && vsInitial >= 0) return 'DOWN_PAYMENT_COMPLETED';
  }
  if (input.reservationFee) {
    const vsReservation = compareMoney(input.verifiedTotal, input.reservationFee);
    if (vsReservation !== null && vsReservation >= 0) return 'RESERVATION_PAID';
  }
  return 'PARTIALLY_PAID';
}

/* ------------------------------------------------------------------ */
/* Google Sheets URL handling (public sheets only, strict allowlist)   */
/* ------------------------------------------------------------------ */

/**
 * Parse a Google Sheets URL into { spreadsheetId, gid }. Returns null for
 * anything that is not a docs.google.com spreadsheet URL - the server never
 * fetches arbitrary URLs. Private sheets fail at fetch time with a clear
 * error naming the missing OAuth/service-credential configuration.
 */
export function parseGoogleSheetUrl(url: string): { spreadsheetId: string; gid: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'docs.google.com' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== ''
  )
    return null;
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,120})(?:\/.*)?$/.exec(parsed.pathname);
  if (!match) return null;
  const hashGid = new URLSearchParams(parsed.hash.slice(1)).get('gid');
  const queryGid = parsed.searchParams.get('gid');
  if (hashGid !== null && queryGid !== null && hashGid !== queryGid) return null;
  const gid = queryGid ?? hashGid;
  if (gid !== null && !/^\d{1,10}$/.test(gid)) return null;
  return { spreadsheetId: match[1]!, gid: gid ?? '0' };
}

/** Link-readable CSV export URL for a validated sheet reference. */
export function googleSheetCsvUrl(ref: { spreadsheetId: string; gid: string }): string {
  return `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/export?format=csv&gid=${ref.gid}`;
}

export const CUSTOMER_EXPORT_COLUMNS = [
  'customer_number',
  'membership_number',
  'customer_name',
  'vip_tier',
  'customer_status',
  'membership_status',
  'payment_status',
  'derived_category',
  'activated_at',
  'expires_at',
  'current_points_balance',
  'seller',
  'email',
  'mobile',
  'created_at',
] as const;

export type CustomerExportRow = Record<(typeof CUSTOMER_EXPORT_COLUMNS)[number], string>;

/* ------------------------------------------------------------------ */
/* API shapes                                                          */
/* ------------------------------------------------------------------ */

export const customerImportJobSchema = z.object({
  id: z.string().uuid(),
  sourceType: importSourceSchema,
  sourceName: z.string(),
  googleSheetId: z.string().nullable(),
  status: importJobStatusSchema,
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  insertedRows: z.number().int().nonnegative(),
  updatedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  createdAt: z.string(),
  validatedAt: z.string().nullable(),
  committedAt: z.string().nullable(),
  failedAt: z.string().nullable().default(null),
  cancelledAt: z.string().nullable().default(null),
  failedRows: z.number().int().nonnegative().default(0),
});
export type CustomerImportJob = z.infer<typeof customerImportJobSchema>;

export const customerImportRowSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  fields: z.record(z.string(), z.string()),
  normalized: z.record(z.string(), z.unknown()),
  validation: importValidationSchema,
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
  warnings: z.array(z.object({ field: z.string(), message: z.string() })),
  action: importRowActionSchema,
  customerId: z.string().uuid().nullable(),
  membershipId: z.string().uuid().nullable(),
});
export type CustomerImportRow = z.infer<typeof customerImportRowSchema>;

export const customerImportParseResponseSchema = z.object({
  job: customerImportJobSchema,
  rows: z.array(customerImportRowSchema),
});
export type CustomerImportParseResponse = z.infer<typeof customerImportParseResponseSchema>;

export const customerImportCommitResponseSchema = z.object({
  job: customerImportJobSchema,
  committed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  rowResults: z.array(
    z.object({
      rowId: z.string().uuid(),
      ok: z.boolean(),
      customerId: z.string().uuid().nullable(),
      membershipId: z.string().uuid().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type CustomerImportCommitResponse = z.infer<typeof customerImportCommitResponseSchema>;

/** Safe staff lookup: deliberately excludes contact, identity, Auth and payment fields. */
export const memberLookupSchema = z.object({
  membershipNumber: z.string(),
  memberName: z.string(),
  customerNumber: z.string(),
  tier: z.string(),
  membershipStatus: z.string(),
  category: customerCategorySchema,
  activatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  availablePoints: z.string().regex(/^\d+$/),
  mayUsePrivileges: z.boolean(),
});
export type MemberLookup = z.infer<typeof memberLookupSchema>;

export const customerSellerOptionSchema = z.object({ id: z.string().uuid(), name: z.string() });
