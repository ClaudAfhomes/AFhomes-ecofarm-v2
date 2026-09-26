import { describe, expect, it } from 'vitest';

import { validateLogin } from './validation';

describe('validateLogin', () => {
  it('requires an identifier and a password', () => {
    expect(validateLogin({ identifier: '', password: '' })).toEqual({
      identifier: 'Enter your email address or phone number.',
      password: 'Enter your password.',
    });
  });

  it('accepts an email identifier', () => {
    expect(validateLogin({ identifier: 'maria@example.com', password: 'x' })).toEqual({});
  });

  it('accepts a phone identifier', () => {
    expect(validateLogin({ identifier: '+639171234567', password: 'x' })).toEqual({});
  });

  it('rejects a malformed email identifier', () => {
    expect(validateLogin({ identifier: 'maria@', password: 'x' })).toEqual({
      identifier: 'Enter a valid email address or phone number.',
    });
  });

  it('rejects a malformed phone identifier', () => {
    expect(validateLogin({ identifier: '12', password: 'x' })).toEqual({
      identifier: 'Enter a valid email address or phone number.',
    });
  });
});
