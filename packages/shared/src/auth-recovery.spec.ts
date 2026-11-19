import { describe, expect, it } from 'vitest';

import {
  RECOVERY_SENT_MESSAGE,
  buildRecoveryRedirect,
  classifyRecoveryRequestError,
  isAllowedRecoveryRedirect,
  isValidRecoveryEmail,
  passwordRuleStates,
  validateRecoveryPassword,
} from './auth-recovery.js';

describe('recovery password policy (mirrors the activation contract)', () => {
  it('accepts a policy-compliant password', () => {
    expect(validateRecoveryPassword('NewPass1234')).toBeNull();
  });

  it('rejects short, simple, and single-class passwords', () => {
    expect(validateRecoveryPassword('Short1Aa')).toMatch(/at least 10/);
    expect(validateRecoveryPassword('alllowercase1')).toMatch(/lowercase/);
    expect(validateRecoveryPassword('ALLUPPERCASE1')).toMatch(/lowercase/);
    expect(validateRecoveryPassword('NoDigitsHereAa')).toMatch(/digit/);
  });

  it('validates email shape for the request form', () => {
    expect(isValidRecoveryEmail('staff@afhomes.test')).toBe(true);
    expect(isValidRecoveryEmail('not-an-email')).toBe(false);
    expect(isValidRecoveryEmail('')).toBe(false);
  });
});

describe('passwordRuleStates (live view of the same policy)', () => {
  it('marks every rule met exactly when the validator accepts', () => {
    const met = passwordRuleStates('NewPass1234');
    expect(met).toHaveLength(4);
    expect(met.every((rule) => rule.met)).toBe(true);
    expect(validateRecoveryPassword('NewPass1234')).toBeNull();
  });

  it('flips each rule independently', () => {
    const byId = Object.fromEntries(passwordRuleStates('Short1Aa').map((r) => [r.id, r.met]));
    expect(byId).toEqual({ length: false, lowercase: true, uppercase: true, digit: true });
    expect(passwordRuleStates('alllowercase1').find((r) => r.id === 'uppercase')?.met).toBe(false);
    expect(passwordRuleStates('ALLUPPERCASE1').find((r) => r.id === 'lowercase')?.met).toBe(false);
    expect(passwordRuleStates('NoDigitsHereAa').find((r) => r.id === 'digit')?.met).toBe(false);
  });

  it('marks nothing met for an empty password', () => {
    expect(passwordRuleStates('').every((rule) => !rule.met)).toBe(true);
  });
});

describe('recovery redirect builder', () => {
  it('joins the configured admin origin with the reset path', () => {
    // VITE_ADMIN_URL already carries the /admin base path in production, so
    // the app path is just /reset-password - never /admin/reset-password.
    expect(
      buildRecoveryRedirect('https://admin.afhomes.test', '/reset-password', 'https://x.test'),
    ).toBe('https://admin.afhomes.test/reset-password');
    expect(
      buildRecoveryRedirect('https://afhomes.test/admin', '/reset-password', 'https://x.test'),
    ).toBe('https://afhomes.test/admin/reset-password');
  });

  it('falls back to the current origin when nothing is configured', () => {
    expect(buildRecoveryRedirect(undefined, '/admin/reset-password', 'https://app.test')).toBe(
      'https://app.test/admin/reset-password',
    );
    expect(buildRecoveryRedirect('', '/customer/reset-password', 'https://app.test')).toBe(
      'https://app.test/customer/reset-password',
    );
  });

  it('rejects a localhost base in production but keeps it in development', () => {
    expect(
      buildRecoveryRedirect('http://localhost:5174/admin', '/reset-password', 'https://app.test'),
    ).toBe('https://app.test/reset-password');
    expect(
      buildRecoveryRedirect(
        'http://localhost:5174/admin',
        '/reset-password',
        'http://localhost:5173',
      ),
    ).toBe('http://localhost:5174/admin/reset-password');
  });

  it('rejects non-http schemes, credentials, and garbage', () => {
    const current = 'https://app.test';
    expect(buildRecoveryRedirect('javascript:alert(1)', '/x', current)).toBe('https://app.test/x');
    expect(buildRecoveryRedirect('https://user:pass@app.test', '/x', current)).toBe(
      'https://app.test/x',
    );
    expect(buildRecoveryRedirect('not a url', '/x', current)).toBe('https://app.test/x');
    expect(buildRecoveryRedirect('ftp://files.test', '/x', current)).toBe('https://app.test/x');
  });

  it('takes no user input, so there is no query value to inject', () => {
    const built = buildRecoveryRedirect(
      'https://app.test',
      '/customer/reset-password',
      'https://app.test',
    );
    expect(built).toBe('https://app.test/customer/reset-password');
    expect(built).not.toContain('?');
  });
});

describe('recovery redirect allowlist', () => {
  const allowed = ['https://app.test/admin/reset-password'];
  it('accepts the exact scope and deeper paths on the same origin', () => {
    expect(isAllowedRecoveryRedirect('https://app.test/admin/reset-password', allowed)).toBe(true);
  });

  it('blocks cross-origin, lookalike-origin, and user-supplied origins', () => {
    expect(isAllowedRecoveryRedirect('https://evil.test/admin/reset-password', allowed)).toBe(
      false,
    );
    expect(
      isAllowedRecoveryRedirect('https://app.test.evil.test/admin/reset-password', allowed),
    ).toBe(false);
    expect(isAllowedRecoveryRedirect('https://app.test/admin/other', allowed)).toBe(false);
    expect(isAllowedRecoveryRedirect('not a url', allowed)).toBe(false);
  });
});

describe('recovery request error classification (no enumeration)', () => {
  it('folds unknown-user refusals into the generic sent outcome', () => {
    expect(classifyRecoveryRequestError({ status: 400, message: 'User not found' })).toBe('sent');
    expect(classifyRecoveryRequestError(new Error('Identity not found'))).toBe('sent');
  });

  it('surfaces rate limits and transport failures distinctly', () => {
    expect(classifyRecoveryRequestError({ status: 429, message: 'slow down' })).toBe(
      'rate-limited',
    );
    expect(classifyRecoveryRequestError({ message: 'Email rate limit exceeded' })).toBe(
      'rate-limited',
    );
    expect(classifyRecoveryRequestError(new TypeError('Failed to fetch'))).toBe('unavailable');
  });

  it('keeps anything else a generic failure that names no account', () => {
    expect(classifyRecoveryRequestError({ status: 500, message: 'boom' })).toBe('failed');
    // The sent sentence is identical for known and unknown addresses: it
    // asserts nothing about the submitted email.
    expect(RECOVERY_SENT_MESSAGE).toBe(
      'If an account exists for that email, a password reset link has been sent.',
    );
  });
});
