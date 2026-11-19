-- AF Homes: Q16 financial retention and customer-purge protection.
-- Validation: purge a synthetic customer with a receipt, sale or purchase and expect
-- CUSTOMER_FINANCIAL_HISTORY_PROTECTED. The original rows and Storage objects must survive.
-- Down: forward only. Any relaxation requires a separately approved retention policy.
begin;

create or replace function private.assert_customer_financial_retention(p_customer_id uuid)
returns void language plpgsql security definer
set search_path=pg_catalog,public,private,pg_temp as $$
begin
  if exists(select 1 from public.payments p where p.customer_id=p_customer_id)
     or exists(select 1 from public.card_sales s where s.customer_id=p_customer_id)
     or exists(select 1 from public.reservation_agreements r where r.customer_id=p_customer_id)
     or exists(select 1 from public.purchases p where p.customer_id=p_customer_id)
     or exists(select 1 from public.identity_documents d where d.customer_id=p_customer_id) then
    raise exception 'CUSTOMER_FINANCIAL_HISTORY_PROTECTED' using errcode='55000';
  end if;
end $$;
revoke all on function private.assert_customer_financial_retention(uuid)
from public,anon,authenticated,service_role;

do $patch$
declare d text; src text; patched text;
begin
  select pg_get_functiondef(p.oid),p.prosrc into d,src
  from pg_proc p where p.oid='public.purge_customer(uuid)'::regprocedure;
  if position('private.assert_customer_financial_retention' in src)=0 then
    patched:=regexp_replace(src,'\mbegin\M',
      E'begin\n  perform private.financial_decision_lock(true);\n  perform 1 from public.customers c where c.id=p_customer_id for update;\n  perform private.assert_customer_financial_retention(p_customer_id);','i');
    if patched=src then raise exception 'FINANCIAL_GUARD_PATCH_DRIFT'; end if;
    execute replace(d,src,patched);
  end if;
end $patch$;

-- A customer-purge flag cannot authorize deletion of a verified receipt.
create or replace function private.verified_payment_delete_guard() returns trigger
language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if old.status<>'verified' then return old; end if;
  if current_setting('afhomes.allow_purchase_test_cleanup',true)='on'
     and current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid=tg_relid) then
    return old;
  end if;
  raise exception 'FINANCIAL_HISTORY_PROTECTED' using errcode='55000';
end $$;
revoke all on function private.verified_payment_delete_guard() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
