-- Validation: service_role alone may execute manage_service_policy; referenced policies return 23503.
-- Down: revoke execution; never remove audit or financial history.
begin;
create or replace function public.manage_service_policy(p_kind text,p_id uuid,p_patch jsonb,p_actor_id uuid,p_delete boolean default false)
returns boolean language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare v_table text; v_before jsonb; v_after jsonb; v_keys text[]; v_set text; v_key text;
begin
 if p_delete then
  if not exists(select 1 from public.staff_users s join public.staff_role_assignments a on a.staff_id=s.id join public.roles r on r.id=a.role_id and r.is_active join public.modules m on m.key='operations.catalog' and m.is_active left join public.role_permissions rp on rp.role_id=r.id and rp.module_id=m.id left join public.staff_permission_restrictions d on d.staff_id=s.id and d.module_id=m.id where s.id=p_actor_id and s.status='active' and (r.slug='super_admin' or coalesce(rp.can_delete,false)) and not coalesce(d.deny_view,false) and not coalesce(d.deny_delete,false)) then raise exception 'MUTATION_FORBIDDEN' using errcode='42501'; end if;
 else perform private.mutation_actor_role(p_actor_id,'operations.catalog','update'); end if;
 if p_kind='rules' then
  v_table:='point_earning_rules'; v_keys:=array['points_amount','eligible_tiers','effective_start','effective_end','min_quantity','max_award','promotion_reference'];
 elsif p_kind='tier-discounts' then
  v_table:='service_tier_discounts'; v_keys:=array['discount_rate','effective_start','effective_end'];
 elsif p_kind='redemption-rules' then
  v_table:='point_redemption_rules'; v_keys:=array['peso_value_per_point','eligible_tiers','effective_start','effective_end','min_points','max_points','promotion_reference','allow_discount_stacking'];
 else raise exception 'POLICY_KIND_INVALID' using errcode='22023'; end if;
 execute format('select to_jsonb(r) from public.%I r where id=$1 for update',v_table) into v_before using p_id;
 if v_before is null then raise exception 'POLICY_NOT_FOUND' using errcode='P0002'; end if;
 -- Locks conflict with the FK key-share locks acquired when claims or quotes are created.
 if (p_kind='rules' and exists(select 1 from public.earning_claims where rule_id=p_id))
 or (p_kind='redemption-rules' and exists(select 1 from public.redemption_quotes where redemption_rule_id=p_id)) then
  raise exception 'POLICY_HAS_HISTORY: preserve this rule; deactivate it and create a replacement' using errcode='23503';
 end if;
 if p_delete then
  execute format('delete from public.%I where id=$1',v_table) using p_id;
 else
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then raise exception 'POLICY_PATCH_REQUIRED' using errcode='22023'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
   if not v_key=any(v_keys) then raise exception 'POLICY_FIELD_INVALID' using errcode='22023'; end if;
   if v_key='eligible_tiers' and (jsonb_typeof(p_patch->v_key)<>'array' or jsonb_array_length(p_patch->v_key)=0) then raise exception 'POLICY_TIERS_REQUIRED' using errcode='22023'; end if;
   v_set:=concat_ws(',',v_set,format('%I=n.%I',v_key,v_key));
  end loop;
  execute format('update public.%I r set %s from jsonb_populate_record(null::public.%I,$2) n where r.id=$1 returning to_jsonb(r)',v_table,v_set,v_table) into v_after using p_id,v_before||p_patch;
 end if;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(p_actor_id,case when p_delete then 'SERVICE_POLICY_DELETED' else 'SERVICE_POLICY_EDITED' end,v_table,p_id,v_before,v_after);
 return true;
end $$;
revoke all on function public.manage_service_policy(text,uuid,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.manage_service_policy(text,uuid,jsonb,uuid,boolean) to service_role;
commit;
