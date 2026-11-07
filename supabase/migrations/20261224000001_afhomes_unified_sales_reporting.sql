-- Validation: customer-workbook DB suite, account scope/permission denials,
-- no duplicate sale IDs, inactive memberships never qualifying; RLS audit empty.
-- Down: revert reporting callers first; retain all source, sales and commission history.
-- Read-only projection: no financial records, memberships or commissions are rewritten.
create or replace function public.account_imported_sales(
 p_actor_id uuid,p_team boolean default false,p_from date default null,p_to date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,private,pg_temp as $$
declare actor_role text; result jsonb;
begin
 actor_role:=private.mutation_actor_role(p_actor_id,'sales.card_sales','view');
 if actor_role not in ('vice_director','senior_sales_manager','sales_manager','ost')
  or (p_team and actor_role='ost') then raise exception 'FORBIDDEN';end if;
 if p_from>p_to then raise exception 'INVALID_DATE_RANGE';end if;
 with records as (
  select distinct on (s.id) s.*,src.purchase_reference,
   coalesce(m.status,s.status) reporting_status,
   array_remove(array[r.raw_data->>'referrer_staff_id',r.raw_data->>'recommender_staff_id'],null) attributed_staff_ids
  from private.imported_purchase_scope(p_actor_id,p_team) scope
  join private.customer_import_purchase_sources src on src.id=scope.source_id
  join public.customer_import_rows r on r.id=src.original_row_id and r.committed_at is not null
  join public.customer_applications a on a.id=src.application_id
  join public.card_sales s on s.id=coalesce(a.sale_id,r.sale_id)
  left join public.memberships m on m.sale_id=s.id
  where src.superseded_by is null
   and (p_from is null or s.created_at>=(p_from::timestamp at time zone 'UTC'))
   and (p_to is null or s.created_at<((p_to+1)::timestamp at time zone 'UTC'))
  order by s.id,src.created_at,src.id
 ) select coalesce(jsonb_agg(to_jsonb(records)||jsonb_build_object(
  'sale_number',coalesce(purchase_reference,sale_number),
  'status',reporting_status) order by created_at desc,id),'[]'::jsonb) into result from records;
 return result;
end $$;
revoke all on function public.account_imported_sales(uuid,boolean,date,date) from public,anon,authenticated;
grant execute on function public.account_imported_sales(uuid,boolean,date,date) to service_role;
