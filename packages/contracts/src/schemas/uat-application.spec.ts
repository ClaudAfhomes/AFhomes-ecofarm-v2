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
});
