import { describe, expect, it } from 'vitest';

import {
  AF_ID_ALPHABET,
  AF_ID_PREFIXES,
  afIdPattern,
  isAfId,
  matchesBusinessId,
  type AfIdPrefix,
} from './business-ids.js';

describe('AF business-ID vocabulary', () => {
  it('uses the 32-symbol readable alphabet with no ambiguous characters', () => {
    expect(AF_ID_ALPHABET).toHaveLength(32);
    expect(new Set(AF_ID_ALPHABET).size).toBe(32);
    for (const forbidden of ['I', 'O', '0', '1']) {
      expect(AF_ID_ALPHABET).not.toContain(forbidden);
    }
  });

  it('covers exactly the approved prefixes, including AF-CSALE not AF-SALES for sales', () => {
    expect([...AF_ID_PREFIXES]).toEqual([
      'AF-CUS',
      'AF-SALES',
      'AF-CSALE',
      'AF-EMP',
      'AF-APP',
      'AF-RES',
      'AF-OST',
      'AF-ACC',
      'AF-REN',
      'AF-PAY',
      'AF-COM',
      'AF-RED',
      'AF-IMP',
    ]);
  });

  it.each(AF_ID_PREFIXES as unknown as AfIdPrefix[])('matches %s-XXXXX strictly', (prefix) => {
    const pattern = afIdPattern(prefix);
    expect(pattern.test(`${prefix}-K7M4Q`)).toBe(true);
    expect(isAfId(prefix, `${prefix}-K7M4Q`)).toBe(true);
    // Legacy values never match the new format.
    for (const legacy of ['CUS-000023', 'SALE-000036', 'OST-000012', 'RDM-000031']) {
      expect(pattern.test(legacy)).toBe(false);
    }
    // Wrong length, lowercase, ambiguous symbols and foreign prefixes fail.
    expect(pattern.test(`${prefix}-K7M4`)).toBe(false);
    expect(pattern.test(`${prefix}-K7M4QZ`)).toBe(false);
    expect(pattern.test(`${prefix.toLowerCase()}-k7m4q`)).toBe(false);
    expect(pattern.test(`${prefix}-K7M4I`)).toBe(false);
    expect(pattern.test(`${prefix}-K7M40`)).toBe(false);
    expect(isAfId(prefix, null)).toBe(false);
    expect(isAfId(prefix, 42)).toBe(false);
  });

  it('matches legacy and AF identifiers case-insensitively for search', () => {
    expect(matchesBusinessId('CUS-000023', 'cus-000023')).toBe(true);
    expect(matchesBusinessId('AF-CUS-K7M4Q', 'af-cus-k7m4q')).toBe(true);
    expect(matchesBusinessId('AF-CSALE-P9X3D', 'csale-p9')).toBe(true);
    expect(matchesBusinessId('CUS-000023', 'AF-CUS')).toBe(false);
    expect(matchesBusinessId(null, 'cus')).toBe(false);
    expect(matchesBusinessId('CUS-000023', '')).toBe(false);
  });
});
