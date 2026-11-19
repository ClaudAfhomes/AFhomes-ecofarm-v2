import { describe, expect, it } from 'vitest';
import { workbookContactSchema } from './customer-workbook.js';

describe('workbookContactSchema (bulk customer import mobile columns)', () => {
  it('accepts only the local 09XXXXXXXXX form, exactly 11 digits', () => {
    expect(workbookContactSchema.safeParse('09171234567').success).toBe(true);
  });

  it('rejects numbers that are not 09-prefixed, even at a valid length', () => {
    for (const value of ['63917123456' + '7', '08171234567', '11171234567']) {
      expect(workbookContactSchema.safeParse(value).success).toBe(false);
    }
  });

  it('enforces the exact 11-digit boundary on both sides', () => {
    expect(workbookContactSchema.safeParse('0917123456').success).toBe(false); // 10 digits
    expect(workbookContactSchema.safeParse('09171234567').success).toBe(true); // 11 digits, exact
    expect(workbookContactSchema.safeParse('091712345678').success).toBe(false); // 12 digits
  });

  it('rejects spaces, separators and non-digit characters', () => {
    for (const value of ['0917-123-4567', '0917 123 4567', '09171234567 ', 'abcdefghijk']) {
      expect(workbookContactSchema.safeParse(value).success).toBe(false);
    }
  });
});
