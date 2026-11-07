import { expect, it } from 'vitest';
import { applicationHolderSchema, reservationHolderSchema } from './official-forms.js';

it('treats an exact N/A application suffix as absent while preserving real suffixes', () => {
  expect(applicationHolderSchema.shape.suffix.parse(' n/a ')).toBeUndefined();
  expect(applicationHolderSchema.shape.suffix.parse('N/A')).toBeUndefined();
  expect(applicationHolderSchema.shape.suffix.parse('Jr.')).toBe('Jr.');
  expect(applicationHolderSchema.shape.suffix.safeParse('bad/part').success).toBe(false);
  expect(applicationHolderSchema.shape.suffix.safeParse('123').success).toBe(false);
});
it('reads historical reservation names with the exact trailing N/A suffix without weakening name validation', () => {
  expect(reservationHolderSchema.shape.name.parse('Ana Cruz n/a')).toBe('Ana Cruz');
  expect(reservationHolderSchema.shape.name.parse('Ana Cruz Jr.')).toBe('Ana Cruz Jr.');
  for (const value of ['n/a', 'Ana 123', 'Ana bad/part', 'Ana n/a Cruz']) {
    expect(reservationHolderSchema.shape.name.safeParse(value).success).toBe(false);
  }
});
