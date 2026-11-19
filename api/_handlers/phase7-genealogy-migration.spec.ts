import { readFileSync } from 'node:fs';import { resolve } from 'node:path';import { describe,expect,it } from 'vitest';
const sql=readFileSync(resolve(process.cwd(),'../supabase/migrations/20261002000001_afhomes_phase7_genealogy.sql'),'utf8');
describe('PHASE 7 genealogy migration',()=>{
 it('enforces exact role adjacency with role slugs',()=>{expect(sql).toContain("v_subject_role='senior_sales_manager' and v_upline_role='vice_director'");expect(sql).toContain("v_subject_role='sales_manager' and v_upline_role='senior_sales_manager'");expect(sql).toContain("v_subject_role='ost' and v_upline_role='sales_manager'");});
 it('rejects self and indirect cycles',()=>{expect(sql).toContain('UPLINE_SELF_REFERENCE');expect(sql).toContain("raise exception 'GENEALOGY_CYCLE'");expect(sql).toMatch(/with recursive ancestors/);});
 it('keeps correction privileged and audited',()=>{expect(sql).toContain("has_permission_for_user(p_actor_id,'sales.uplines','update')");expect(sql).toContain("'UPLINE_CORRECTED'");expect(sql).toMatch(/update public\.referral_relationships set is_active=false/);});
});
