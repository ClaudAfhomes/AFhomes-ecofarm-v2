import { expect, it } from 'vitest';
import { applicationHolderSchema, reservationHolderSchema } from './official-forms.js';

it('treats an exact N/A application suffix as absent while preserving real suffixes', () => {
  expect(applicationHolderSchema.shape.suffix.parse(' n/a ')).toBeUndefined();
  expect(applicationHolderSchema.shape.suffix.parse('N/A')).toBeUndefined();
  expect(applicationHolderSchema.shape.suffix.parse('Jr.')).toBe('Jr.');
  // Fixed pick-list: anything off the list is refused.
  expect(applicationHolderSchema.shape.suffix.safeParse('bad/part').success).toBe(false);
  expect(applicationHolderSchema.shape.suffix.safeParse('1'.repeat(21)).success).toBe(false);
});
it('reads historical reservation names with the exact trailing N/A suffix without weakening name validation', () => {
  expect(reservationHolderSchema.shape.name.parse('Ana Cruz n/a')).toBe('ANA CRUZ');
  expect(reservationHolderSchema.shape.name.parse('Ana Cruz Jr.')).toBe('ANA CRUZ JR.');
  for (const value of ['n/a', 'Ana 123', 'Ana bad/part', 'Ana n/a Cruz']) {
    expect(reservationHolderSchema.shape.name.safeParse(value).success).toBe(false);
  }
});

it('takes Prefix from the fixed pick-list and preserves legacy absence', () => {
  expect(applicationHolderSchema.shape.prefix.parse(' Dr. ')).toBe('Dr.');
  expect(applicationHolderSchema.shape.prefix.parse('mrs')).toBe('Mrs.');
  expect(applicationHolderSchema.shape.prefix.safeParse('Sir').success).toBe(false);
  expect(applicationHolderSchema.shape.prefix.parse('')).toBeUndefined();
  expect(applicationHolderSchema.shape.prefix.parse(undefined)).toBeUndefined();
  expect(applicationHolderSchema.shape.prefix.safeParse('X'.repeat(21)).success).toBe(false);
});
