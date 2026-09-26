-- Sale deletion guard: block when credited commissions exist.
--
-- `Commission` has no FK on `saleId`, so deleting a `Sale` row used to orphan
-- its commission rows (they kept showing in the member's commissions list
-- with dead property links). New policy (owner decision): a sale with any
-- AVAILABLE (credited) commission cannot be deleted - the credited money
-- must not silently lose its record. Deleting a sale with only non-credited
-- commissions (PENDING/CANCELLED/REVERSED) removes those rows along with the
-- sale so no orphans are left.
--
-- `sale_delete` is SECURITY DEFINER, single transaction: lock sale, check
-- commissions, delete commissions + sale, audit. Errors are RETURNED (never
-- raised) as {error:{...}}. EXECUTE restricted to service_role.
--
-- Pre-apply validation (run first):
--   -- sales that would be blocked by the guard:
--   select distinct "saleId" from "Commission" where status = 'AVAILABLE';
--
-- Down: drop function public.sale_delete(text, uuid, text).

create or replace function public.sale_delete(
  p_id text,
  p_actor uuid,
  p_role text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sale record;
  v_credited integer;
  v_removed integer;
  v_now timestamptz := now();
begin
  select * into v_sale from "Sale" where id = p_id for update;
  if v_sale.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Sale not found','status',404));
  end if;
  select count(*) into v_credited from "Commission"
    where "saleId" = p_id and status = 'AVAILABLE';
  if v_credited > 0 then
    return jsonb_build_object('error', jsonb_build_object('code','CONFLICT','message','This sale has credited commissions and cannot be deleted.','status',409));
  end if;
  -- Remove non-credited commission rows (no wallet/ledger movement) so no
  -- orphans are left behind.
  delete from "Commission" where "saleId" = p_id;
  get diagnostics v_removed = row_count;
  delete from "Sale" where id = p_id;
  insert into "AuditLog" (action, actor_id, actor_role, target_type, target_id, target_name, detail, created_at)
    values ('SALE_DELETED', p_actor, p_role, 'Sale', p_id,
            coalesce(v_sale."propertyName", p_id) || ' - ' || coalesce(v_sale."customerName", ''),
            'Deleted sale ' || p_id || ' (' || v_removed || ' uncredited commission(s) removed).', v_now);
  return jsonb_build_object('deleted', true, 'id', p_id, 'commissionsRemoved', v_removed);
end;
$$;

revoke execute on function public.sale_delete(text, uuid, text) from public, anon, authenticated;
grant execute on function public.sale_delete(text, uuid, text) to service_role;
