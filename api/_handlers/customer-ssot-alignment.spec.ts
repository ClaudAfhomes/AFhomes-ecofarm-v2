/**
 * Structural tripwires for the customer-record SSOT alignment migration
 * (20261204000001). Text assertions only - the live proof that the SQL
 * applies and behaves is `pnpm test:db:local`. What these buy is fast
 * feedback on casual edits: a dropped column, a lost RPC mapping, a
 * whole-address clobber sneaking back in, or a browser grant appearing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION = fileURLToPath(
  new URL(
    '../../supabase/migrations/20261204000001_afhomes_customer_ssot_alignment.sql',
    import.meta.url,
  ),
);
const sql = readFileSync(MIGRATION, 'utf8');

describe('customer SSOT alignment migration', () => {
  it('adds the two landline columns, nullable, idempotently, without grants', () => {
    for (const column of ['landline', 'supplementary_landline'])
      expect(sql).toContain(`add column if not exists ${column}`);
    const addBlock = sql.slice(sql.indexOf('alter table public.customers'));
    expect(addBlock).not.toMatch(/not null default/);
    expect(sql).not.toMatch(
      /grant\s+(select\s*\([^)]*\)|select\s+on)\s+public\.customers\s+to\s+(anon|authenticated)/i,
    );
  });

  it('registers new customers from applications with suffix, sex, landline and barangay', () => {
    expect(sql).toContain("nullif(p_primary->>'suffix','')");
    expect(sql).toContain("lower(nullif(p_primary->>'sex',''))");
    expect(sql).toContain("nullif(p_primary->>'landline','')");
    expect(sql).toContain("'barangay',p_primary->>'barangay'");
    expect(sql).toContain(
      'grant execute on function public.register_customer_application_once(uuid,uuid,jsonb,jsonb,jsonb) to service_role',
    );
  });

  it('import CREATE persists landline and supplementary_landline', () => {
    expect(sql).toContain("nullif(p_customer->>'landline','')");
    expect(sql).toContain("nullif(v_company->>'supplementaryLandline','')");
  });

  it('import UPDATE merges address parts per-key and never clobbers with placeholders', () => {
    // The old whole-address replace is gone: the merge reads each stored key.
    expect(sql).toContain("address->>'line2'");
    expect(sql).toContain("address->>'barangay'");
    expect(sql).toContain("address->>'postalCode'");
    expect(sql).not.toContain(
      "address = case when nullif(v_row.raw_data->>'address_line_1','') is not null then v_address else address end",
    );
    // 'Imported' placeholders never reach an UPDATE merge.
    const updateSection = sql.slice(sql.indexOf('update public.customers set'));
    expect(updateSection.slice(0, updateSection.indexOf('updated_at = now()'))).not.toContain(
      "'Imported",
    );
    // The two new columns preserve stored values when the import cell is blank.
    expect(sql).toContain("landline = coalesce(nullif(v_person->>'landline',''), landline)");
    expect(sql).toContain(
      "supplementary_landline = coalesce(nullif(v_company->>'supplementaryLandline',''), supplementary_landline)",
    );
  });

  it('preserves the 20261021 random-allocator surgery in both re-delivered bodies', () => {
    expect(sql).toContain(`'^MBS-([0-9]{6}|[0-9A-F]{8}(-[0-9A-F]{8}){3})$'`);
    expect(sql).toContain(`if v_membership_number ~ '^MBS-[0-9]{6}$' then perform setval(`);
  });

  it('re-delivers every function with service-role-only grants', () => {
    expect(sql).toContain(
      'grant execute on function public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean) to service_role',
    );
    expect(sql).toContain(
      'grant execute on function public.commit_customer_import_row(uuid,uuid) to service_role',
    );
    expect(sql).not.toContain('grant execute on function public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean) to public');
  });

  it('keeps money and age disciplines untouched', () => {
    expect(sql).not.toContain('add column if not exists age');
    expect(sql).not.toMatch(/stated_[a-z_]+[^;]{0,80}::numeric/);
    expect(sql).not.toContain("to_char(");
  });
});
