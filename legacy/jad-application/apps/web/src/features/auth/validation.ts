/**
 * Frontend-only form validation for the auth preview screens (SCR-AUTH-001/002).
 *
 * UX validation only - the client is never the security boundary
 * (FRONTEND-ARCHITECTURE §8). No credentials are stored or logged anywhere.
 * Rules stay within documented requirements; the 8-character password minimum
 * is an ASSUMPTION (credential policy is TBD - REQUIREMENTS ASSUMPTION 1).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Loose phone check: +/digits with common separators, ≥ 7 characters. */
const PHONE_RE = /^\+?[\d\s().-]{7,}$/;
export type LoginField = 'identifier' | 'password';

export interface LoginValues {
  identifier: string;
  password: string;
}

export type LoginErrors = Partial<Record<LoginField, string>>;

export const LOGIN_FIELD_ORDER: LoginField[] = ['identifier', 'password'];

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

function isValidPhone(value: string): boolean {
  return PHONE_RE.test(value.trim());
}

/** A single identifier accepting either an email address or a phone number. */
export function validateLogin(values: LoginValues): LoginErrors {
  const errors: LoginErrors = {};

  const identifier = values.identifier.trim();
  if (!identifier) {
    errors.identifier = 'Enter your email address or phone number.';
  } else if (identifier.includes('@')) {
    if (!isValidEmail(identifier)) {
      errors.identifier = 'Enter a valid email address or phone number.';
    }
  } else if (!isValidPhone(identifier)) {
    errors.identifier = 'Enter a valid email address or phone number.';
  }

  if (!values.password) {
    errors.password = 'Enter your password.';
  }

  return errors;
}

/** First field with an error, in display order - for focus management. */
export function firstInvalidField<T extends string>(
  errors: Partial<Record<T, string>>,
  order: readonly T[],
): T | undefined {
  return order.find((field) => errors[field] !== undefined);
}
