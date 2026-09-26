/**
 * AF Homes Phase 2 business constants.
 *
 * Single source for values the database, the API, and the UI must agree on.
 * Anything here that also exists as a SQL literal is asserted against the
 * migration in `api/_lib/constants.spec.ts`.
 */

/** Length of the spot-cash window, in days, counted from the first verified payment. */
export const SPOT_CASH_DAYS = 7;

/** Default commission rate applied to a card product when none is configured. */
export const DEFAULT_COMMISSION_RATE = '0.04';

/** Default membership validity in months, set at activation. */
export const DEFAULT_MEMBERSHIP_VALIDITY_MONTHS = 12;

/** Invitation window for a staff invite, in days. */
export const STAFF_INVITATION_VALID_DAYS = 7;

/** Default validity for a customer onboarding token, in hours. */
export const DEFAULT_ONBOARDING_TOKEN_VALID_HOURS = 72;
