import { expect, it } from 'vitest';
import { aaNumberSchema } from './sale-team.js';

it('accepts six letters and six digits, normalizing typed case and spacing', () => {
  expect(aaNumberSchema.parse(' aa-k7q2m9t4b1r8 ')).toBe('AA-K7Q2M9T4B1R8');
  expect(aaNumberSchema.parse('AA-ABCDEF123456')).toBe('AA-ABCDEF123456');
});
it.each([
  'AA-00000001',
  'AA-ABCDEFGHIJKL',
  'AA-123456789012',
  'AA-ABCDE1234567',
  'AA-ABCDEFG12345',
  'AA-ABCDEF12345!',
])('rejects invalid AA composition %s', (value) => {
  expect(aaNumberSchema.safeParse(value).success).toBe(false);
});
