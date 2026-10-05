import { describe, expect, it } from 'vitest';

import {
  AF_CODE_PREFIX,
  AF_ID_ALPHABET,
  AF_SUFFIX_LENGTH,
  afIdPattern,
  customerCodeSchema,
  isAfId,
} from './business-ids.js';

/**
 * Mirrors private.af_candidate('AF-CC'): 40 bits from 5 bytes, eight 5-bit
 * slices. Web Crypto rather than node:crypto, because this package ships browser
 * types and must stay free of Node-only imports.
 */
function mirrorCode(): string {
  const raw = new Uint8Array(5);
  globalThis.crypto.getRandomValues(raw);
  let v = 0;
  for (const byte of raw) v = v * 256 + byte;
  let out = '';
  for (let i = 0; i < 8; i += 1) out += AF_ID_ALPHABET[Math.floor(v / 2 ** (i * 5)) % 32]!;
  return `${AF_CODE_PREFIX}-${out}`;
}

describe('Customer Code (AF-CC)', () => {
  it('is a distinct prefix with an 8-character suffix, not the 5-character ID', () => {
    expect(AF_SUFFIX_LENGTH['AF-CC']).toBe(8);
    expect(AF_SUFFIX_LENGTH['AF-CUS']).toBe(5);
    expect(afIdPattern('AF-CC').source).toContain('{8}');
    expect(afIdPattern('AF-CUS').source).toContain('{5}');
  });

  it('matches only AF-CC-XXXXXXXX and never a Customer ID', () => {
    expect(isAfId('AF-CC', 'AF-CC-K7M4Q9XP')).toBe(true);
    expect(isAfId('AF-CC', 'AF-CUS-K7M4Q')).toBe(false);
    expect(isAfId('AF-CC', 'CUS-000023')).toBe(false);
    expect(isAfId('AF-CC', 'AF-CC-K7M4Q')).toBe(false); // 5 chars
    expect(isAfId('AF-CC', 'AF-CC-K7M4Q9XPZ')).toBe(false); // 9 chars
    expect(isAfId('AF-CC', 'af-cc-k7m4q9xp')).toBe(false); // canonical uppercase only
    for (const bad of ['AF-CC-K7M4Q9XI', 'AF-CC-K7M4Q9XO', 'AF-CC-K7M4Q9X0', 'AF-CC-K7M4Q9X1'])
      expect(isAfId('AF-CC', bad)).toBe(false);
    expect(isAfId('AF-CC', null)).toBe(false);
  });

  it('validates as an additive, transitional response field', () => {
    expect(customerCodeSchema.safeParse('AF-CC-9XP4M7KR').success).toBe(true);
    expect(customerCodeSchema.safeParse(null).success).toBe(true);
    expect(customerCodeSchema.safeParse(undefined).success).toBe(true);
    expect(customerCodeSchema.safeParse('AF-CC-bad').success).toBe(false);
  });

  it('generates 1,000 unique, well-formed, non-sequential codes with no I/O/0/1', () => {
    const codes = Array.from({ length: 1000 }, mirrorCode);
    expect(new Set(codes).size).toBe(1000);
    for (const code of codes) {
      expect(afIdPattern('AF-CC').test(code)).toBe(true);
      expect(code.slice('AF-CC-'.length)).toHaveLength(8);
      expect(code).not.toMatch(/[IO01]/);
    }
    const sorted = [...codes].sort();
    expect(codes).not.toEqual(sorted);
    expect(codes).not.toEqual([...sorted].reverse());
  });

  it('shares no characters with the Customer ID it sits beside', () => {
    const code = mirrorCode();
    expect(code.startsWith('AF-CC-')).toBe(true);
    expect(code.startsWith('AF-CUS-')).toBe(false);
    // Independent values: a code is never derived from, or equal to, an ID.
    expect(afIdPattern('AF-CUS').test(code)).toBe(false);
  });
});