/**
 * Count display helper - same locale policy as `money.ts` (DESIGN-SYSTEM §9;
 * UX-DEC-010): the approved deployment locale is TBD / PROPOSED and `en-PH`
 * is a PLACEHOLDER. Count formatting is isolated here so only this formatter
 * changes when the locale is approved.
 *
 * Presentation-only: formats a whole count for display (e.g. `8000` →
 * `8,000`) and never computes anything.
 */

const countFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 0,
});

/**
 * Format a whole count with thousands separators (`8000` → `8,000`).
 * Throws on non-finite, fractional, or negative input to keep invalid values
 * out of the UI (a malformed count is a data bug, not a display decision) -
 * the same fail-loud rule `formatMoney` follows.
 */
export function formatCount(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`formatCount: expected an integer count, got "${String(value)}"`);
  }
  if (value < 0) {
    throw new Error(`formatCount: expected a non-negative count, got "${String(value)}"`);
  }
  return countFormatter.format(value);
}
