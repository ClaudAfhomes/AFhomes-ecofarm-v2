/**
 * Structural tripwires for the membership company-fields migration
 * (20261130000001). Text assertions only - the live proof that the SQL
 * applies and behaves is `pnpm test:db:local`. What these buy is fast
 * feedback on casual edits: a dropped column, a lost RPC mapping, or a
 * browser grant on a write-only TIN column.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION = fileURLToPath(
  new URL(
    '../../supabase/migrations/20261130000001_afhomes_membership_company_fields.sql',
    import.meta.url,
  ),
);
const sql = readFileSync(MIGRATION, 'utf8');

const COLUMNS = [
  'ra_number',
  'company_status',
  'citizenship',
  'civil_status',
  'tin_number',
  'occupation_business_name',
  'office_business_address',
  'employed_position',
  'supplementary_full_name',
  'supplementary_address',
  'supplementary_birthday',
  'supplementary_gender',
  'supplementary_citizenship',
  'supplementary_civil_status',
  'supplementary_tin_number',
  'supplementary_mobile',
  'supplementary_email',
  'supplementary_occupation_business_name',
  'supplementary_office_address',
  'supplementary_position',
  'ost_ist_name',
  'svd_name',
  'ssm_name',
  'sm_name',
  'referrer_name',
  'vip_recommender_name',
  'related_contact_no',
  'related_email',
  'stated_vip_package',
  'stated_payment_terms',
  'stated_regular_price',
  'stated_discount',
  'stated_total_amount',
  'stated_rf',
  'stated_payment_type',
  'stated_ref_no',
  'stated_payment_date',
];

describe('membership company-fields migration', () => {
  it('adds all 37 company-stated columns, all nullable, idempotently', () => {
    expect(COLUMNS).toHaveLength(37);
    for (const column of COLUMNS) expect(sql).toContain(`add column if not exists ${column}`);
    // No NOT NULL, no defaults: company-stated data must never be invented.
    const addBlock = sql.slice(sql.indexOf('alter table public.customers'));
    expect(addBlock).not.toMatch(/not null default/);
  });

  it('constrains supplementary gender to the shared list', () => {
    expect(sql).toContain(`supplementary_gender in ('male', 'female', 'other', 'undisclosed')`);
  });

  it('carries the company object through both import RPCs', () => {
    expect(sql).toContain(`v_company := coalesce(v_n->'company', '{}'::jsonb)`);
    expect(sql).toContain(`'company', v_company`);
    expect(sql).toContain('supplementary_tin_number');
    expect(sql).toContain('stated_total_amount');
    // UPDATE preserves stored values when the import cell is blank.
    expect(sql).toContain("tin_number = coalesce(nullif(v_company->>'tinNumber',''), tin_number)");
  });

  it('preserves the 20261021 random-allocator surgery (never restores narrow forms)', () => {
    // Replacing these bodies must not clobber the widened membership-number
    // shape or the guarded legacy-sequence bump: that exact regression broke
    // the duplicate-membership rule on random codes.
    expect(sql).toContain(`'^MBS-([0-9]{6}|[0-9A-F]{8}(-[0-9A-F]{8}){3})$'`);
    expect(sql).toContain(`if v_membership_number ~ '^MBS-[0-9]{6}$' then perform setval(`);
    // The row-commit audit carries the row id (import_legacy_member's own
    // p_job_id usage elsewhere is legitimate - it owns that parameter).
    expect(sql).toContain(`'CUSTOMER_IMPORT_ROW_COMMITTED', 'customer_import_row', p_row_id::text`);
  });

  it('grants nothing to browser roles and keeps RLS posture', () => {
    expect(sql).not.toMatch(
      /grant\s+(select\s*\([^)]*\)|select\s+on)\s+public\.customers\s+to\s+(anon|authenticated)/i,
    );
    expect(sql).toContain(
      'grant execute on function public.commit_customer_import_row(uuid,uuid) to service_role',
    );
    // TIN columns are documented write-only in the file itself.
    expect(sql).toContain('Write-only');
  });

  it('never derives age and never computes money from stated figures', () => {
    expect(sql).not.toContain('add column if not exists age');
    expect(sql).not.toContain('supplementary_age');
    for (const column of ['stated_regular_price', 'stated_discount', 'stated_total_amount']) {
      const casts = sql.match(new RegExp(`${column}[^;]{0,80}::numeric`, 'g'));
      expect(casts).toBeNull();
    }
  });
});
