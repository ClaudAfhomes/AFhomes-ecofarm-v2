import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractMembershipNumber } from './identifier.js';
describe('random and historical public member identifiers', () => {
  it.each(['MBS-000004', 'MBS-01234567-89ABCDEF-01234567-89ABCDEF'])(
    'resolves the same identifier in its digital-card envelope: %s',
    (code) => {
      expect(extractMembershipNumber(code.toLowerCase())).toBe(code);
      expect(extractMembershipNumber(`AFHOMES:${code}`)).toBe(code);
    },
  );
  it('uses 16 cryptographic bytes without truncation or new privileges', () => {
    const sql = readFileSync(
      new URL(
        '../../supabase/migrations/20261021000001_afhomes_random_membership_number_allocator.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toContain('gen_random_bytes(16)');
    expect(sql).toContain('for attempt in 1..64');
    expect(sql).not.toMatch(
      /(?:grant|revoke)\s+(?:all|execute|usage|select)|Math\.random|update public\.memberships/i,
    );
  });
});
