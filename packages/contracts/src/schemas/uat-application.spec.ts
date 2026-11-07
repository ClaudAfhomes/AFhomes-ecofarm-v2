import { describe, expect, it } from 'vitest';
import { applicationHolderSchema, createCustomerApplicationSchema } from './official-forms.js';
import { optionalLandlineSchema, emailSchema } from './input.js';
describe('UAT optional inputs', () => {
  it.each([' Name@Example.COM ', 'claud.jimenez+qa@example.com', 'qa-admin@example.org'])(
    'accepts normal email %s',
    (email) => expect(emailSchema.parse(email)).toBe(email.trim().toLowerCase()),
  );
  it.each(['', undefined, 'N/A', ' N/a '])('allows missing landline %s', (value) =>
    expect(optionalLandlineSchema.parse(value)).toBeUndefined(),
  );
  it('accepts a real local landline without mobile prefix assumptions', () =>
    expect(applicationHolderSchema.shape.landline.parse('(02) 8123-4567')).toBe('0281234567'));
  it('rejects text masquerading as a landline', () =>
    expect(optionalLandlineSchema.safeParse('letters').success).toBe(false));
  it('does not format-validate an absent recommender email', () =>
    expect(createCustomerApplicationSchema.shape.recommenderEmail.parse('')).toBeUndefined());
  it('normalizes a supplied recommender email', () =>
    expect(createCustomerApplicationSchema.shape.recommenderEmail.parse(' QA@Example.COM ')).toBe(
      'qa@example.com',
    ));
  it('treats a blank government ID number as not supplied and trims a real one', () => {
    const number = createCustomerApplicationSchema.shape.governmentIdNumber;
    expect(number.parse('')).toBeUndefined();
    expect(number.parse(undefined)).toBeUndefined();
    expect(number.parse(' P1234567 ')).toBe('P1234567');
    expect(number.safeParse('12').success).toBe(false);
  });
});

describe('referral chain staff linkage', () => {
  const shape = createCustomerApplicationSchema.shape;
  const id = '11111111-1111-4111-8111-111111111111';
  it.each(['svdStaffId', 'ssmStaffId', 'smStaffId', 'referrerStaffId'] as const)(
    'treats a blank %s as unnamed rather than invalid',
    (key) => {
      expect(shape[key].parse('')).toBeUndefined();
      expect(shape[key].parse(undefined)).toBeUndefined();
    },
  );
  it.each(['svdStaffId', 'ssmStaffId', 'smStaffId', 'referrerStaffId'] as const)(
    'accepts a staff id for %s and refuses anything else shaped',
    (key) => {
      expect(shape[key].parse(id)).toBe(id);
      expect(shape[key].safeParse('not-a-uuid').success).toBe(false);
      expect(shape[key].safeParse('Maria Santos').success).toBe(false);
    },
  );
  it('keeps the legacy stated names writable without linkage', () => {
    // Text without ids is the legacy path: the server stores it verbatim and
    // no chain rule applies, because names carry no linkage to check.
    expect(shape.svdName.parse('Pedro Reyes')).toBe('Pedro Reyes');
    expect(shape.vipReferrer.parse('Juan Cruz')).toBe('Juan Cruz');
  });
});
