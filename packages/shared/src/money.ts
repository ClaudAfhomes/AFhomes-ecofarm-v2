import { EXACT_DECIMAL_STRING_RE } from '@jad/contracts';

/**
 * Money display helpers - DESIGN-SYSTEM.md §9.
 *
 * Money arrives from the API as exact-decimal STRINGS (BR-WAL-002; NUMERIC,
 * never floats). These helpers are presentation-only: they format a decimal
 * string for display and never perform arithmetic. No float math anywhere.
 */

/** Exact-decimal money regex lives in `@jad/contracts` (single source, API-SPEC §1.3). */

/** Exact-decimal string → integer cents, using BigInt so values never lose precision. */
function toCents(value: string): bigint {
  const [whole = '0', frac = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
}

/** Integer cents → exact-decimal string (keeps the `.00` form). */
function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/**
 * Validate that a value is an exact-decimal money string (digits, optional
 * 1-2 decimal places, no sign, no thousands separators). Floating-point or
 * malformed input is rejected rather than silently formatted.
 */
export function isExactDecimal(value: string): boolean {
  return typeof value === 'string' && EXACT_DECIMAL_STRING_RE.test(value);
}

/**
 * PROVISIONAL LOCALE (DESIGN-SYSTEM §9; UX-DEC-010): the approved deployment
 * locale is TBD / PROPOSED. `en-PH` is a PLACEHOLDER chosen to match the §9
 * example format (₱ + PHP). Before launch, replace with the approved locale
 * configuration - formatting is isolated here so only this formatter changes.
 * Money representation stays exact-decimal string; no float arithmetic.
 */
const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  currencyDisplay: 'symbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format an exact-decimal money string as ₱PHP (e.g. `1000000.00` → `₱1,000,000.00`).
 * Throws on malformed input to keep invalid values out of the UI
 * (DESIGN-SYSTEM §9 formatting rule; a malformed value is a data bug, not a display decision).
 */
export function formatMoney(value: string): string {
  if (!isExactDecimal(value)) {
    throw new Error(`formatMoney: expected exact-decimal string, got "${value}"`);
  }
  return phpFormatter.format(Number(value));
}

/**
 * Compare two exact-decimal money strings (returns -1, 0, or 1). Exact-decimal
 * comparison - never converts to a float.
 */
export function compareMoney(a: string, b: string): number {
  if (!isExactDecimal(a) || !isExactDecimal(b)) {
    throw new Error('compareMoney: expected exact-decimal strings');
  }
  const diff = toCents(a) - toCents(b);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

/**
 * Exact-decimal addition of two money strings (BigInt cents - no float math).
 * The result keeps two decimal places.
 */
export function addMoney(a: string, b: string): string {
  if (!isExactDecimal(a) || !isExactDecimal(b)) {
    throw new Error('addMoney: expected exact-decimal strings');
  }
  return fromCents(toCents(a) + toCents(b));
}

/**
 * Exact-decimal subtraction of two money strings (BigInt cents - no float
 * math). May return a negative string when `a < b`; callers that must preserve
 * the non-negative invariant (BI-001) should guard with `compareMoney`.
 */
export function subtractMoney(a: string, b: string): string {
  if (!isExactDecimal(a) || !isExactDecimal(b)) {
    throw new Error('subtractMoney: expected exact-decimal strings');
  }
  return fromCents(toCents(a) - toCents(b));
}

/**
 * Multiply an exact-decimal money string by a rate string (up to 4 decimal
 * places) and round to 2 decimals (half away from zero), mirroring PG
 * `round(amount::numeric * rate::numeric, 2)` for non-negative values.
 * Uses BigInt cents/basis-points - no float math.
 */
export function multiplyMoney(amount: string, rate: string): string {
  if (!isExactDecimal(amount)) {
    throw new Error(`multiplyMoney: expected exact-decimal amount, got "${amount}"`);
  }
  if (typeof rate !== 'string' || !/^\d+(\.\d{1,4})?$/.test(rate)) {
    throw new Error(`multiplyMoney: expected rate string up to 4dp, got "${rate}"`);
  }
  const [aWhole = '0', aFrac = ''] = amount.split('.');
  const cents = BigInt(aWhole) * 100n + BigInt((aFrac + '00').slice(0, 2));
  const [rWhole = '0', rFrac = ''] = rate.split('.');
  const rateBp = BigInt(rWhole) * 10000n + BigInt((rFrac + '0000').slice(0, 4));
  const estCents = (cents * rateBp + 5000n) / 10000n;
  return fromCents(estCents);
}

/**
 * Divide an exact-decimal money string into `divisor` equal parts, keeping
 * two decimals. Throws (never floats, never rounds silently) when the amount
 * does not split exactly - every approved VIP schedule divides exactly, so an
 * inexact result is a data bug, not a display decision.
 */
export function divideMoneyExact(amount: string, divisor: number): string {
  if (!isExactDecimal(amount)) {
    throw new Error(`divideMoneyExact: expected exact-decimal amount, got "${amount}"`);
  }
  if (!Number.isInteger(divisor) || divisor <= 0) {
    throw new Error(`divideMoneyExact: expected a positive integer divisor, got "${divisor}"`);
  }
  const cents = toCents(amount);
  const by = BigInt(divisor);
  if (cents % by !== 0n) {
    throw new Error(`divideMoneyExact: ${amount} does not split into ${divisor} exact parts`);
  }
  return fromCents(cents / by);
}
