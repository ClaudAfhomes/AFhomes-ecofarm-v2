import { z } from 'zod';

/**
 * Exact-decimal money + rate validators - SINGLE SOURCE (BR-WAL-002,
 * DATABASE-DESIGN §7.17, API-SPECIFICATION §1.3). Money arrives as exact-decimal
 * STRINGS; floats are rejected. Schemas in this package and the display helpers
 * in `@afhomes/shared` share these regexes so validation and formatting can never
 * disagree on what a valid money string looks like.
 */

/** Exact-decimal money string: digits with an optional 1-2 decimal places, no sign, no separators. */
export const EXACT_DECIMAL_STRING_RE = /^\d+(\.\d{1,2})?$/;

/** Rate string: numeric(5,4), e.g. `0.0800` (BI-006). */
export const EXACT_DECIMAL_RATE_RE = /^\d+(\.\d{1,4})?$/;

export const exactDecimalStringSchema = z.string().regex(EXACT_DECIMAL_STRING_RE);

export const exactDecimalRateSchema = z.string().regex(EXACT_DECIMAL_RATE_RE);
