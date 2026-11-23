import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../supabase/migrations/20261003000001_afhomes_phase8_ost_registration.sql',
  ),
  'utf8',
);

describe('PHASE 8 OST registration migration', () => {
  it('provides sequence-backed OST numbers without touching member auth', () => {
    expect(sql).toContain('create sequence if not exists public.ost_number_seq');
    expect(sql).toContain('create or replace function public.next_ost_number()');
    expect(sql).not.toMatch(/auth\.users/);
  });

  it('blocks duplicate reviewable applications case-insensitively', () => {
    expect(sql).toContain('ost_applications_one_reviewable_per_email');
    expect(sql).toContain("where status in ('submitted', 'under_review', 'changes_requested')");
    expect(sql).toMatch(/lower\(email\)/);
  });

  it('keeps browser roles read-only and reuses the Phase 1 lifecycle', () => {
    expect(sql).toContain(
      'revoke all on function public.next_ost_number() from public, anon, authenticated',
    );
    expect(sql).not.toMatch(/alter table public\.ost_applications\s+drop constraint/);
    expect(sql).not.toMatch(/commission/i);
  });

  it('preserves the Phase 7 hierarchy (no genealogy bypass)', () => {
    expect(sql).not.toMatch(/referral_relationships.*insert/i);
    expect(sql).not.toMatch(/validate_genealogy_relationship/);
  });
});
