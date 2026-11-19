import { describe, expect, it } from 'vitest';

import { safeStartupDetail } from './startup-diagnostics.js';

describe('safeStartupDetail', () => {
  it('surfaces a whitelisted configuration message', () => {
    const error = new Error('Login requires server-only AFHOMES_AUTH_TURNSTILE_SECRET.');
    expect(safeStartupDetail('configuration', error)).toBe(
      ' Login requires server-only AFHOMES_AUTH_TURNSTILE_SECRET.',
    );
  });

  it('normalizes the message to a single line', () => {
    const error = new Error('BETTER_AUTH_SECRET must be a server-only secret.\nCheck it.');
    expect(safeStartupDetail('configuration', error)).toBe(
      ' BETTER_AUTH_SECRET must be a server-only secret. Check it.',
    );
  });

  it('does not surface messages once startup has moved past configuration', () => {
    const error = new Error('MONGODB_URI must be configured in the server environment.');
    expect(safeStartupDetail('connection', error)).toBe('');
  });

  it('does not surface messages that are not known-safe configuration diagnostics', () => {
    const error = new Error('connect ECONNREFUSED 10.0.0.1:27017');
    expect(safeStartupDetail('configuration', error)).toBe('');
  });

  it('does not surface a variable prefix that carries a value', () => {
    const error = new Error('AFHOMES_AUTH_TURNSTILE_SECRET=super-secret-value');
    expect(safeStartupDetail('configuration', error)).toBe('');
  });

  it('does not surface non-Error values or oversized messages', () => {
    expect(safeStartupDetail('configuration', 'Login requires a secret')).toBe('');
    expect(safeStartupDetail('configuration', new Error(`AFHOMES_${'x'.repeat(300)}`))).toBe('');
  });
});
