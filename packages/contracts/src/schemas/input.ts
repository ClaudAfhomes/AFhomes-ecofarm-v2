import { z } from 'zod';

/**
 * System-wide input validation and safe normalization - SINGLE SOURCE.
 *
 * Every person-name, phone, email, money and birth-date rule in the product is
 * defined here so the browser, the API handlers and the Excel/CSV/Sheets
 * import path can never disagree on what is valid or how a value is stored:
 *
 *   NAMES    Unicode letters, spaces, apostrophes and hyphens only. No digits,
 *            ever. Entered capitalization is preserved (`normalizePersonName`).
 *   PHONES   No alphabetic characters, ever. Philippine mobile forms collapse
 *            to the canonical `+63XXXXXXXXXX` (`normalizePhilippinePhone`).
 *   EMAIL    Trimmed + lowercased (existing convention, kept).
 *   MONEY    Exact-decimal strings only (see `./money.js`): no alpha, no
 *            scientific notation, no floats. Validated server-side, always.
 *   DATES    Real calendar dates; birth dates must be past and plausible.
 *
 * WHAT IS NEVER UPPERCASED (by design, each with a test):
 * email, passwords, OTPs, tokens/JWTs, URLs (incl. Google Sheet URLs), UUIDs,
 * hashes, API keys, storage paths, technical identifiers, catalog display
 * titles, and free-form notes/descriptions where casing carries meaning.
 * Historical records are never rewritten - normalization applies on write.
 */

export const PERSON_NAME_RE = /^[\p{L}][\p{L}\p{M}'’\.\- ]*$/u;

/** Collapse whitespace while preserving deliberately entered name casing. */
export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Uppercase a human-readable address/business field for storage. */
export function normalizeAddressField(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Postal codes keep their characters; only surrounding space is trimmed. */
export function normalizePostalCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Canonical Philippine phone normalization. Returns the canonical form or
 * null when the input is not a phone number at all. Alphabetic characters
 * are never stripped - they fail the value outright.
 */
export function normalizePhilippinePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || /[a-zA-Z]/.test(value)) return null;
  const stripped = value.replace(/[\s\-.()]/g, '');
  if (!/^\+?\d+$/.test(stripped)) return null;
  const hasPlus = stripped.startsWith('+');
  const digits = hasPlus ? stripped.slice(1) : stripped;
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^63\d{10}$/.test(digits)) return `+${digits}`;
  if (digits.length >= 7 && digits.length <= 15) return hasPlus ? `+${digits}` : digits;
  return null;
}

/** Existing convention: emails are trimmed and lowercased, never uppercased. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return value.length > 0 ? value : null;
}

/** Trimmed money text that matches the exact-decimal rule, else null. */
export function normalizeMoneyString(raw: unknown, pattern: RegExp): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return pattern.test(value) ? value : null;
}

const isRealCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = new Date(`${value}T00:00:00Z`).valueOf();
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === value;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** A birth date must be real, in the past, and within a plausible lifetime. */
export function isPlausibleBirthDate(value: string): boolean {
  if (!isRealCalendarDate(value)) return false;
  const today = todayIso();
  if (value >= today) return false;
  const oldest = `${Number(today.slice(0, 4)) - 120}${today.slice(4)}`;
  return value >= oldest;
}

/* ------------------------------------------------------------------ */
/* Zod schemas                                                          */
/* ------------------------------------------------------------------ */

/**
 * A person-name part: Unicode letters plus space/apostrophe/hyphen, no digits.
 * Preserves entered casing on parse; historical records are never rewritten.
 */
export const personNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(PERSON_NAME_RE, 'Use letters, spaces, apostrophes and hyphens only - no numbers')
  .transform((value) => normalizePersonName(value));

/** Optional person-name part (middle names). Validated here; the owning
 *  schema/handler preserves entered capitalization on write. */
export const optionalPersonNameSchema = z
  .string()
  .trim()
  .max(80)
  .optional()
  .refine((value) => value === undefined || value === '' || PERSON_NAME_RE.test(value), {
    message: 'Use letters, spaces, apostrophes and hyphens only - no numbers',
  });

/** Optional phone part: validated here, canonicalized on write. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .optional()
  .refine((value) => value === undefined || normalizePhilippinePhone(value) !== null, {
    message: 'Phone must be 7-15 digits (Philippine mobile stored as +63…), no letters',
  });

/** Phone input: rejects alpha, stores the canonical form. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizePhilippinePhone(value))
  .refine((value): value is string => value !== null, {
    message: 'Phone must be 7-15 digits (Philippine mobile stored as +63…), no letters',
  });

/** Optional contact number: missing/blank/null means absent; supplied values
 * use the required phone policy, including canonical PH normalization. */
export const optionalContactNumberSchema = z.preprocess(
  (value) =>
    value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
  z.string().trim().max(30).pipe(phoneSchema).optional(),
);

/** Email input: trimmed + lowercased, never uppercased. */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
/** Optional landlines use number syntax, without Philippine mobile-prefix rules. */
export const optionalLandlineSchema = z.preprocess(
  (value) =>
    value == null || (typeof value === 'string' && /^(?:\s*|\s*N\/A\s*)$/i.test(value))
      ? undefined
      : value,
  z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9() .-]+$/, 'Enter a valid landline number')
    .refine((value) => {
      const count = value.replace(/\D/g, '').length;
      return count >= 7 && count <= 15;
    }, 'Enter 7 to 15 landline digits')
    .transform((value) => {
      const mobile = phoneSchema.safeParse(value);
      return mobile.success ? mobile.data : value;
    })
    .optional(),
);

/** Birth date input: real calendar date, past, plausible age. */
export const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD')
  .refine((value) => isRealCalendarDate(value), 'dateOfBirth is not a real calendar date')
  .refine((value) => value < todayIso(), 'dateOfBirth must be in the past')
  .refine((value) => isPlausibleBirthDate(value), 'dateOfBirth is not plausible');

/** Same rule with birthDate-flavoured messages (OST + official forms). */
export const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD')
  .refine((value) => isRealCalendarDate(value), 'birthDate is not a real calendar date')
  .refine((value) => value < todayIso(), 'birthDate must be in the past')
  .refine((value) => isPlausibleBirthDate(value), 'birthDate is not plausible');

/** Uppercase-stored address text (line1/city/province/occupation/position). */
export const uppercaseAddressSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((value) => normalizeAddressField(value));

/** Uppercase-stored short text with a caller-chosen cap (city/province). */
export const uppercasedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((value) => normalizeAddressField(value));

/**
 * Nullable person-name part for update payloads: null/undefined/blank pass
 * through untouched (null clears, undefined leaves). A real value must be a
 * name; the handler preserves its capitalization on write.
 */
export const nullablePersonNameSchema = z
  .string()
  .trim()
  .max(80)
  .nullable()
  .optional()
  .refine(
    (value) => value === undefined || value === null || value === '' || PERSON_NAME_RE.test(value),
    { message: 'Use letters, spaces, apostrophes and hyphens only - no numbers' },
  );
