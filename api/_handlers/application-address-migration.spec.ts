/**
 * Contract for 20261103000001_afhomes_application_psgc_address.sql.
 *
 * A text assertion cannot prove a migration WORKS, so `pnpm test:db:local` and
 * the db-integration suite execute this file for real. What this guards is the
 * set of promises the file makes in its own header - the ones a later edit could
 * silently break, which are also the ones that would corrupt historical records.
 *
 * The load-bearing ones: the columns are nullable, the two already-applied
 * functions are RE-ISSUED rather than edited in place (a runner skips versions a
 * database recorded, so an in-place edit would never arrive), and the immutable
 * purchase-flow migration is not referenced as if it were being changed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MIGRATION = fileURLToPath(
  new URL('../../supabase/migrations/20261103000001_afhomes_application_psgc_address.sql', import.meta.url),
);
const sql = readFileSync(MIGRATION, 'utf8');

describe('columns', () => {
  it('adds the four geography columns', () => {
    for (const column of [
      'barangay',
      'province_code',
      'city_municipality_code',
      'barangay_code',
    ]) {
      expect(sql).toContain(`add column if not exists ${column} `);
    }
  });

  it('adds them idempotently, so re-applying changes nothing', () => {
    expect(sql).not.toMatch(/add column (?!if not exists)/);
  });

  it('never makes an existing column NOT NULL, which would reject legacy rows', () => {
    expect(sql).not.toMatch(/alter column\s+\w+[^\n]*set not null/i);
  });

  it('backfills nothing - a legacy address must not gain a fabricated code', () => {
    expect(sql).not.toMatch(/\bupdate\s+public\.customer_application_holders\b/i);
    expect(sql).not.toMatch(/\bset\s+province_code\s*=/i);
  });
});

describe('constraints', () => {
  it('refuses a code that is not a 10-digit PSGC code', () => {
    expect(sql).toContain("province_code ~ '^[0-9]{10}$'");
  });

  it('requires all three codes or none', () => {
    expect(sql).toMatch(
      /num_nonnulls\(\s*province_code\s*,\s*city_municipality_code\s*,\s*barangay_code\s*\)\s*in\s*\(0,\s*3\)/,
    );
  });

  it('adds constraints only when absent, so the file is re-appliable', () => {
    expect(sql).toContain("if not exists (select 1 from pg_constraint where conname='customer_application_holders_psgc_triple')");
  });

  it('allows a barangay name only alongside a verified locality', () => {
    expect(sql).toContain('check (barangay is null or city_municipality_code is not null)');
  });
});

describe('re-issued function bodies', () => {
  it('re-issues save_customer_application, whose INSERT hard-codes the column list', () => {
    expect(sql).toContain('create or replace function public.save_customer_application(');
  });

  it('re-issues reserve_application_purchase_once, which joins the holder address', () => {
    expect(sql).toContain('create or replace function public.reserve_application_purchase_once(');
  });

  it('persists all four new fields on the PRIMARY holder', () => {
    const primaryInsert = sql.match(
      /insert into public\.customer_application_holders\([\s\S]*?\)\s*select v_id,'PRIMARY'[\s\S]*?;/,
    );
    expect(primaryInsert?.[0]).toContain('barangay,province_code,city_municipality_code,barangay_code');
    expect(primaryInsert?.[0]).toContain(
      "nullif(p_primary->>'barangay',''),nullif(p_primary->>'provinceCode',''),nullif(p_primary->>'cityMunicipalityCode',''),nullif(p_primary->>'barangayCode','')",
    );
  });

  it('persists them on the SECONDARY holder too, not just the primary', () => {
    const secondaryInsert = sql.match(
      /insert into public\.customer_application_holders\([\s\S]*?\)\s*select v_id,'SECONDARY'[\s\S]*?;/,
    );
    expect(secondaryInsert?.[0]).toContain(
      "nullif(p_secondary->>'barangay',''),nullif(p_secondary->>'provinceCode',''),nullif(p_secondary->>'cityMunicipalityCode',''),nullif(p_secondary->>'barangayCode','')",
    );
  });

  it('uses nullif so an absent code stores NULL rather than the empty string', () => {
    // '' would fail the 10-digit CHECK and break every legacy save.
    expect(sql).not.toMatch(/p_primary->>'provinceCode'(?!,)/);
  });

  it('writes the barangay before the municipality, as a Philippine address reads', () => {
    expect(sql).toContain(
      'h.barangay,h.city_municipality,h.province,h.postal_code',
    );
    expect(sql).toContain(
      'v_primary.permanent_address_line_2,v_primary.barangay,v_primary.city_municipality,v_primary.province,v_primary.postal_code',
    );
  });
});

describe('immutable migrations', () => {
  it('does not alter or reference the applied purchase-flow migration for editing', () => {
    // Referencing it in a comment to explain WHY is fine; executing an ALTER or
    // a CREATE OR REPLACE against something defined only there is not.
    expect(sql).not.toMatch(/alter\s+function\s+public\.reserve_application_purchase_once/i);
    expect(sql).not.toMatch(/drop\s+function/i);
  });

  it('restates the same grants rather than widening them', () => {
    expect(sql).toContain(
      'revoke all on function public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;',
    );
    expect(sql).toContain(
      'revoke all on function public.reserve_application_purchase_once(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;',
    );
  });
});