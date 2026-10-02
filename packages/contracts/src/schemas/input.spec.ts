/**
 * System-wide input validation and safe uppercase normalization.
 *
 * Pins the single source (`./input.js`): what a name/phone/money/date may
 * contain, what gets uppercased, and - just as important - what must NEVER be
 * uppercased (emails, URLs, tokens, UUIDs, hashes, keys, paths, notes).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  dateOfBirthSchema,
  emailSchema,
  normalizeAddressField,
  normalizeEmail,
  normalizeMoneyString,
  normalizePersonName,
  normalizePhilippinePhone,
  normalizePostalCode,
  nullablePersonNameSchema,
  optionalPersonNameSchema,
  optionalPhoneSchema,
  optionalContactNumberSchema,
  personNameSchema,
  phoneSchema,
  uppercaseAddressSchema,
  uppercasedText,
} from './input.js';
import { EXACT_DECIMAL_RATE_RE, EXACT_DECIMAL_STRING_RE } from './money.js';
import { createRedemptionRequestSchema, pointsAmountSchema } from './redemption.js';

describe('person names', () => {
  it('accepts alphabetic, Unicode, hyphen and apostrophe names', () => {
    for (const name of ['Juan', 'Maria Santos', 'Anne-Marie', "O'Brien", 'Peña', 'ÑOÑO']) {
      expect(personNameSchema.parse(name)).toBe(name.toUpperCase());
    }
  });

  it('rejects numeric and mixed letter+number names', () => {
    for (const name of ['J0hn', 'Maria2', '123', 'A1', 'Test9Name']) {
      expect(personNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it('rejects blank and overlong names', () => {
    expect(personNameSchema.safeParse('   ').success).toBe(false);
    expect(personNameSchema.safeParse('').success).toBe(false);
    expect(personNameSchema.safeParse('A'.repeat(81)).success).toBe(false);
  });

  it('validates optional names without transforming (owners normalize on write)', () => {
    expect(optionalPersonNameSchema.parse(undefined)).toBeUndefined();
    expect(optionalPersonNameSchema.parse('   ')).toBe('');
    expect(optionalPersonNameSchema.parse('maria luisa')).toBe('maria luisa');
    expect(optionalPersonNameSchema.safeParse('R2D2').success).toBe(false);
    expect(optionalPhoneSchema.parse(undefined)).toBeUndefined();
    expect(optionalPhoneSchema.parse('09185550101')).toBe('09185550101');
    expect(optionalPhoneSchema.safeParse('0918ABC0101').success).toBe(false);
  });

  it('preserves null/undefined/blank on nullable update names', () => {
    expect(nullablePersonNameSchema.parse(null)).toBeNull();
    expect(nullablePersonNameSchema.parse(undefined)).toBeUndefined();
    expect(nullablePersonNameSchema.parse('')).toBe('');
    expect(nullablePersonNameSchema.parse('juan')).toBe('juan');
    expect(nullablePersonNameSchema.safeParse('J0hn').success).toBe(false);
    expect(uppercasedText(100).parse('san jose')).toBe('SAN JOSE');
    expect(uppercasedText(100).safeParse('').success).toBe(false);
  });
});

describe('safe uppercase normalization', () => {
  it('uppercases lowercase and mixed-case names', () => {
    expect(normalizePersonName('claud mars jimenez')).toBe('CLAUD MARS JIMENEZ');
    expect(normalizePersonName('  Claud   Mars  Jimenez  ')).toBe('CLAUD MARS JIMENEZ');
    expect(normalizePersonName("o'brien")).toBe("O'BRIEN");
  });

  it('uppercases address and business text, trims postal codes', () => {
    expect(normalizeAddressField('  123 main st, quezon city  ')).toBe('123 MAIN ST, QUEZON CITY');
    expect(uppercaseAddressSchema.parse('san jose')).toBe('SAN JOSE');
    expect(normalizePostalCode('  1103 ')).toBe('1103');
  });

  it('never uppercases emails, URLs, tokens, UUIDs or hashes', () => {
    // Emails normalize DOWN, never up.
    expect(normalizeEmail('  Juan@Example.COM ')).toBe('juan@example.com');
    expect(emailSchema.parse('Juan@Example.COM')).toBe('juan@example.com');
    // Everything below must pass through byte-identical: no case folding.
    for (const technical of [
      'https://docs.google.com/spreadsheets/d/AbC123xYz-_9',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      '550e8400-e29b-41d4-a716-446655440000',
      'a3f5c9e1b2d4478899001122334455667788990011223344556677889900aabbcc',
      'private/afhomes-payment-receipts/r1.pdf',
      'sk-live-AbC123',
      'Keep this Note as Typed!',
    ]) {
      expect(z.string().parse(technical)).toBe(technical);
    }
  });
});

describe('phones', () => {
  it('accepts valid Philippine formats and canonicalizes mobile to +63', () => {
    expect(normalizePhilippinePhone('09185550101')).toBe('+639185550101');
    expect(normalizePhilippinePhone('0918-555-0101')).toBe('+639185550101');
    expect(normalizePhilippinePhone('(0918) 555 0101')).toBe('+639185550101');
    expect(normalizePhilippinePhone('+639185550101')).toBe('+639185550101');
    expect(normalizePhilippinePhone('639185550101')).toBe('+639185550101');
    expect(phoneSchema.parse('09185550101')).toBe('+639185550101');
  });

  it('rejects alphabetic and malformed phones', () => {
    for (const phone of [
      '0918ABC0101',
      'call-me-maybe',
      '09abr5550101',
      '',
      '123',
      '+',
      '++63918',
    ]) {
      expect(normalizePhilippinePhone(phone)).toBeNull();
      expect(phoneSchema.safeParse(phone).success).toBe(false);
    }
    expect(phoneSchema.safeParse('0'.repeat(16)).success).toBe(false);
  });
});

describe('money', () => {
  it('accepts integers and decimals, rejects alpha/scientific/negative', () => {
    for (const money of ['0', '1', '60000', '60000.00', '0.10', '29999.70']) {
      expect(normalizeMoneyString(money, EXACT_DECIMAL_STRING_RE)).toBe(money);
    }
    for (const bad of ['6e4', '1E5', '-5', '-0.01', 'abc', '₱100', '10.123', '', '  ', '1,000']) {
      expect(normalizeMoneyString(bad, EXACT_DECIMAL_STRING_RE)).toBeNull();
    }
    expect(normalizeMoneyString('0.0800', EXACT_DECIMAL_RATE_RE)).toBe('0.0800');
    expect(normalizeMoneyString('0.08005', EXACT_DECIMAL_RATE_RE)).toBeNull();
  });
});

describe('whole numbers', () => {
  it('accepts only whole units inside explicit bounds', () => {
    expect(pointsAmountSchema.safeParse(2000).success).toBe(true);
    expect(pointsAmountSchema.safeParse(0).success).toBe(true);
    expect(pointsAmountSchema.safeParse(2000.5).success).toBe(false);
    expect(pointsAmountSchema.safeParse(-1).success).toBe(false);
    expect(pointsAmountSchema.safeParse('2000').success).toBe(false);
    expect(
      createRedemptionRequestSchema.safeParse({
        membershipId: '22222222-2222-4222-8222-222222222222',
        redemptionItemId: '33333333-3333-4333-8333-333333333333',
        quantity: 2,
        clientTransactionId: 'pos-12345678',
      }).success,
    ).toBe(true);
    expect(
      createRedemptionRequestSchema.safeParse({
        membershipId: '22222222-2222-4222-8222-222222222222',
        redemptionItemId: '33333333-3333-4333-8333-333333333333',
        quantity: 0,
        clientTransactionId: 'pos-12345678',
      }).success,
    ).toBe(false);
    expect(
      createRedemptionRequestSchema.safeParse({
        membershipId: '22222222-2222-4222-8222-222222222222',
        redemptionItemId: '33333333-3333-4333-8333-333333333333',
        quantity: 1.5,
        clientTransactionId: 'pos-12345678',
      }).success,
    ).toBe(false);
  });
});

describe('birth dates', () => {
  it('accepts past real dates and rejects impossible, future and ancient ones', () => {
    expect(dateOfBirthSchema.safeParse('1990-05-04').success).toBe(true);
    expect(dateOfBirthSchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateOfBirthSchema.safeParse('2099-01-01').success).toBe(false);
    expect(dateOfBirthSchema.safeParse('1899-01-01').success).toBe(false);
    expect(dateOfBirthSchema.safeParse('not-a-date').success).toBe(false);
    expect(dateOfBirthSchema.safeParse('').success).toBe(false);
  });
});

describe('optional contact numbers', () => {
  it.each([undefined, null, '', '   '])('normalizes absent value %s to undefined', (value) => {
    expect(optionalContactNumberSchema.parse(value)).toBeUndefined();
  });
  it.each(['09171234567', '+639171234567', '0917-123-4567'])(
    'normalizes %s canonically',
    (value) => {
      expect(optionalContactNumberSchema.parse(value)).toBe('+639171234567');
    },
  );
  it.each(['09ABC123456', 'PHONE123', '0917TEST', '123', '++63917', 1234567])(
    'rejects supplied invalid value %s',
    (value) => {
      expect(optionalContactNumberSchema.safeParse(value).success).toBe(false);
    },
  );
});
