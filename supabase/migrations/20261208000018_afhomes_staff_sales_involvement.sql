-- Read-only projection of recorded participation; never reconstruct legacy genealogy.
create function public.staff_sales_involvement(p_actor_id uuid,p_staff_id uuid,p_limit integer default 25,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private,pg_temp as $$
declare result jsonb;
begin
 perform private.mutation_actor_role(p_actor_id,'organization.staff','view');
 perform private.mutation_actor_role(p_actor_id,'sales.customers','view');
 if p_limit not between 1 and 100 or p_offset<0 then raise exception 'IMPORT_BATCH_LIMIT';end if;
 if not exists(select 1 from public.staff_users where id=p_staff_id) then raise exception 'STAFF_NOT_FOUND';end if;
 with participation as (
  select 'sale:'||s.id as key,s.customer_id,s.id as sale_id,null::uuid as application_id,s.sale_number as reference,p.code as tier,s.status,s.created_at,'Seller'::text as involvement
  from public.card_sales s join public.card_plans p on p.id=s.plan_id
  where s.seller_staff_id=p_staff_id or s.seller_ost_id=p_staff_id
  union all
  select 'sale:'||s.id,s.customer_id,s.id,null::uuid,s.sale_number,p.code,s.status,s.created_at,h.ancestor_role
  from public.card_sale_hierarchy_snapshots h join public.card_sales s on s.id=h.sale_id join public.card_plans p on p.id=s.plan_id where h.ancestor_staff_id=p_staff_id
  union all
  select coalesce('sale:'||coalesce(a.sale_id,r.sale_id),'application:'||a.id),a.customer_id,coalesce(a.sale_id,r.sale_id),a.id,coalesce(s.sale_number,a.application_number),a.tier_snapshot,coalesce(s.status,a.status),a.created_at,v.label
  from public.customer_applications a
  left join public.reservation_agreements r on r.customer_application_id=a.id
  left join public.card_sales s on s.id=coalesce(a.sale_id,r.sale_id)
  cross join lateral (values(a.svd_staff_id,'VD'),(a.ssm_staff_id,'SSM'),(a.sm_staff_id,'SM'),(a.referrer_staff_id,'Referrer')) v(staff_id,label)
  where v.staff_id=p_staff_id
  union all
  select coalesce('sale:'||coalesce(a.sale_id,r.sale_id,ir.sale_id),'application:'||a.id,'import:'||coalesce(src.id,ir.id)),ir.customer_id,coalesce(a.sale_id,r.sale_id,ir.sale_id),a.id,coalesce(s.sale_number,a.application_number,src.purchase_reference,ir.raw_data->>'purchase_reference','Imported purchase'),coalesce(a.tier_snapshot,ir.raw_data->>'vip_tier'),coalesce(s.status,a.status,'imported_pending_review'),coalesce(src.created_at,ir.committed_at),v.label
  from public.customer_import_rows ir
  left join private.customer_import_source_rows link on link.row_id=ir.id
  left join private.customer_import_purchase_sources src on src.id=link.source_id
  left join public.customer_applications a on a.id=src.application_id
  left join public.reservation_agreements r on r.customer_application_id=a.id
  left join public.card_sales s on s.id=coalesce(a.sale_id,r.sale_id,ir.sale_id)
  cross join lateral (values
   ('vd_staff_id','VD'),('ssm_staff_id','SSM'),('sm_staff_id','SM'),('referrer_staff_id','Referrer'),('recommender_staff_id','VIP Recommender'),
   ('referrer_vd_staff_id','Referrer VD'),('referrer_ssm_staff_id','Referrer SSM'),('referrer_sm_staff_id','Referrer SM'),
   ('recommender_vd_staff_id','Recommender VD'),('recommender_ssm_staff_id','Recommender SSM'),('recommender_sm_staff_id','Recommender SM')) v(field,label)
  where ir.committed_at is not null and ir.customer_id is not null and ir.raw_data->>v.field=p_staff_id::text and src.superseded_by is null
   and (src.id is null or src.original_row_id=ir.id)
 ), grouped as (
  select key,customer_id,max(sale_id::text) as sale_id,max(application_id::text) as application_id,max(reference) as reference,max(tier) as tier,max(status) as status,min(created_at) as created_at,array_agg(distinct involvement order by involvement) as roles
  from participation group by key,customer_id
 ), page as (
  select g.*,c.ra_number,c.customer_number,concat_ws(' ',c.first_name,nullif(c.middle_name,''),c.last_name,nullif(c.suffix,'')) as customer_name
  from grouped g join public.customers c on c.id=g.customer_id order by g.created_at desc,g.key limit p_limit offset p_offset
 ) select coalesce(jsonb_agg(jsonb_build_object('id',key,'customerId',customer_id,'customerName',customer_name,'customerNumber',coalesce(nullif(ra_number,''),customer_number),'saleId',sale_id,'applicationId',application_id,'reference',reference,'tier',coalesce(tier,'Not recorded'),'status',status,'createdAt',created_at,'roles',roles) order by created_at desc,key),'[]'::jsonb) into result from page;
 return result;
end $$;
revoke all on function public.staff_sales_involvement(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.staff_sales_involvement(uuid,uuid,integer,integer) to service_role;
