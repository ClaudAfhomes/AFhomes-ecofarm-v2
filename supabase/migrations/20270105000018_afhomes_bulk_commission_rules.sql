-- Atomic personal commission-rate configuration for selected sellers.
-- No migration-supplied rate; frozen sale and commission values remain unchanged.
-- Validation: bulk-rule integration tests, rls_invariants.sql, test:db:local.
-- Down: revoke service_role EXECUTE; retain rules and audit history.
begin;
create or replace function public.bulk_set_commission_rate(
 p_member_ids uuid[], p_rate text, p_effective_from date, p_actor_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare
 v_member uuid; v_type text; v_old public.commission_rules%rowtype;
 v_new public.commission_rules%rowtype; v_created integer:=0; v_replaced integer:=0;
begin
 perform private.mutation_actor_role(p_actor_id,'network.commissions','update');
 if p_member_ids is null or cardinality(p_member_ids) not between 1 and 200
    or exists(select 1 from unnest(p_member_ids) x where x is null)
    or cardinality(p_member_ids)<>(select count(distinct x) from unnest(p_member_ids) x)
    or p_rate is null or p_rate !~ '^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$'
    or p_effective_from is null then
   raise exception 'COMMISSION_BULK_INVALID' using errcode='22023';
 end if;
 -- Rare, bounded configuration writes also serialize with existing single-rule writes.
 lock table public.commission_rules in share row exclusive mode;
 for v_member in select x from unnest(p_member_ids) x order by x loop
   v_type:=null;
   select case when r.slug='ost' then 'ost' else 'staff' end into v_type
   from public.staff_users s join public.staff_role_assignments a on a.staff_id=s.id
   join public.roles r on r.id=a.role_id
   where s.id=v_member and s.status='active' and r.is_active
     and r.slug in ('sales_manager','senior_sales_manager','vice_director','ost')
     and (r.slug<>'ost' or exists(select 1 from public.ost_members o where o.id=s.id and o.status='active'))
   order by r.id limit 1;
   if v_type is null then raise exception 'COMMISSION_SELLER_NOT_ELIGIBLE' using errcode='22023'; end if;
   if exists(select 1 from public.commission_rules r where r.target_type=v_type and r.target_id=v_member
       and r.is_active and r.effective_from=p_effective_from and r.effective_until is null
       and r.accredited_on_or_after is null and r.rate::numeric=p_rate::numeric) then continue; end if;
   for v_old in select * from public.commission_rules r where r.target_type=v_type and r.target_id=v_member
       and r.is_active and (r.effective_until is null or r.effective_until>=p_effective_from) order by r.id loop
     if v_old.effective_from<p_effective_from then
       update public.commission_rules set effective_until=p_effective_from-1,updated_by=p_actor_id,updated_at=now() where id=v_old.id;
     else
       update public.commission_rules set is_active=false,updated_by=p_actor_id,updated_at=now() where id=v_old.id;
     end if;
     insert into public.audit_events(actor_id,action,entity_type,entity_id,before_data,after_data,reason)
     select p_actor_id,'COMMISSION_RULE_REPLACED','commission_rule',r.id::text,to_jsonb(v_old),to_jsonb(r),
       'Personal rate replaced by explicit selected-seller configuration' from public.commission_rules r where r.id=v_old.id;
     v_replaced:=v_replaced+1;
   end loop;
   insert into public.commission_rules(target_type,target_id,rate,effective_from,created_by,updated_by)
   values(v_type,v_member,p_rate,p_effective_from,p_actor_id,p_actor_id) returning * into v_new;
   insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data)
   values(p_actor_id,'COMMISSION_RULE_CREATED','commission_rule',v_new.id::text,to_jsonb(v_new));
   v_created:=v_created+1;
 end loop;
 return jsonb_build_object('created',v_created,'replaced',v_replaced);
end $$;
revoke all on function public.bulk_set_commission_rate(uuid[],text,date,uuid) from public,anon,authenticated;
grant execute on function public.bulk_set_commission_rate(uuid[],text,date,uuid) to service_role;
notify pgrst,'reload schema';
commit;
