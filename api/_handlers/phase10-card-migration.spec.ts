import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../supabase/migrations/20261004000001_afhomes_phase10_card_management.sql',
  ),
  'utf8',
);

describe('PHASE 10 card-management migration', () => {
  it('adds only informational print/issuance columns', () => {
    for (const column of ['card_issued_at', 'card_issued_by', 'last_printed_at', 'print_count']) {
      expect(sql, column).toContain(column);
    }
    expect(sql).toContain('add column if not exists');
  });

  it('backfills issuance from activation without touching credentials', () => {
    expect(sql).toContain('set card_issued_at = activated_at');
    expect(sql).not.toMatch(/qr_token|fallback_code|hash_token|new_fallback|new_qr/);
  });

  it('keeps browser roles read-only and invents no card lifecycle', () => {
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant (insert|update|delete)/i);
    expect(sql).not.toMatch(
      /card_expires_at|expiry_date|replacement_fee|print_fee|courier_status|shipping_status|renewal_grace/i,
    );
  });

  it('guards its precondition and stays forward-only', () => {
    expect(sql).toContain('PHASE10_PREREQ_MISSING:memberships');
    expect(sql).not.toMatch(/drop table/i);
  });
});
