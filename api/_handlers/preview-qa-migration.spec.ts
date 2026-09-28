import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    import.meta.dirname,
    '../../supabase/migrations/20261012000001_afhomes_preview_qa_sale_hierarchy.sql',
  ),
  'utf8',
).toLowerCase();

describe('preview QA sale hierarchy correction', () => {
  it('preserves admin sales without inventing a genealogy snapshot', () => {
    expect(sql).toContain("if v_role in ('admin', 'super_admin') then");
    expect(sql).toMatch(/if v_role in \('admin', 'super_admin'\) then\s+return new;/);
  });

  it('keeps complete genealogy mandatory for hierarchy sellers', () => {
    expect(sql).toContain("raise exception 'sale_complete_hierarchy_required'");
    expect(sql).toContain("when 'ost' then 3");
    expect(sql).toContain('insert into public.card_sale_hierarchy_snapshots');
  });
});
