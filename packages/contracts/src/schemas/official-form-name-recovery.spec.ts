import { expect, it } from 'vitest';
import { applicationHolderSchema, reservationHolderSchema } from './official-forms.js';

it('treats an exact N/A application suffix as absent while preserving real suffixes', () => {
  expect(applicationHolderSchema.shape.suffix.parse(' n/a ')).toBeUndefined();
  expect(applicationHolderSchema.shape.suffix.parse('N/A')).toBeUndefined();
  expect(applicationHolderSchema.shape.suffix.parse('Jr.')).toBe('Jr.');
  // Free text (see address.spec.ts "takes suffix as free text"), not a
  // pick-list - the N/A normalization above still applies on top of it.
  expect(applicationHolderSchema.shape.suffix.parse('bad/part')).toBe('bad/part');
  expect(applicationHolderSchema.shape.suffix.safeParse('1'.repeat(21)).success).toBe(false);
});
it('reads historical reservation names with the exact trailing N/A suffix without weakening name validation', () => {
  expect(reservationHolderSchema.shape.name.parse('Ana Cruz n/a')).toBe('Ana Cruz');
  expect(reservationHolderSchema.shape.name.parse('Ana Cruz Jr.')).toBe('Ana Cruz Jr.');
  for (const value of ['n/a', 'Ana 123', 'Ana bad/part', 'Ana n/a Cruz']) {
    expect(reservationHolderSchema.shape.name.safeParse(value).success).toBe(false);
  }
});

it('accepts optional free-text Prefix without dropping it and preserves legacy absence', () => {
  expect(applicationHolderSchema.shape.prefix.parse(' Dr. ')).toBe('Dr.');
  expect(applicationHolderSchema.shape.prefix.parse('')).toBeUndefined();
  expect(applicationHolderSchema.shape.prefix.parse(undefined)).toBeUndefined();
  expect(applicationHolderSchema.shape.prefix.safeParse('X'.repeat(21)).success).toBe(false);
});
