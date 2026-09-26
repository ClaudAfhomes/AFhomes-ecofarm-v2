-- Member purge: include messaging tables (ADR-013).
--
-- "Message" and "Conversation" are member-scoped, non-financial rows, so the
-- sanctioned purge path (member_purge_cascade, super_admin-only, single
-- transaction) must destroy them with the rest of the member graph. The
-- ON DELETE CASCADE FKs would handle it, but this function deletes
-- leaf-first explicitly so ON DELETE RESTRICT-style enforcement never fires
-- and the purge stays a complete, auditable unit (mirrors
-- 20261001000001_member_purge.sql). Full create-or-replace of the function;
-- unchanged semantics otherwise.
--
-- Validation (must hold after apply):
--   select prosrc like '%"Message"%' from pg_proc where proname = 'member_purge_cascade';
--     -- true (messaging deletes present)
--   select grantee from information_schema.role_routine_grants
--     where routine_name = 'member_purge_cascade'; -- only service_role
-- Idempotent (create or replace + revoke/grant are idempotent).
-- Down (rollback only): re-apply 20261001000001_member_purge.sql to restore
--   the pre-messaging function body.

create or replace function public.member_purge_cascade(
  p_member uuid,
  p_actor uuid,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_member record;
  v_counts jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('error', jsonb_build_object('code','REJECTION_REASON_REQUIRED','message','A reason is required to permanently delete a member.','status',422));
  end if;

  select * into v_member from "Member" where id = p_member;
  if v_member.id is null then
    return jsonb_build_object('error', jsonb_build_object('code','NOT_FOUND','message','Member not found.','status',404));
  end if;

  -- Sever sponsor links to other members first (SET NULL semantics).
  update "Member" set "sponsorId" = null where "sponsorId" = p_member;

  -- Leaf-first deletes (dependents before the rows they reference).
  delete from "IdempotencyKey" where "memberId" = p_member;
  delete from "LedgerEntry"    where "memberId" = p_member;
  delete from "Commission"     where "memberId" = p_member;
  delete from "Withdrawal"     where "memberId" = p_member;
  delete from "Sale"           where "sellerId" = p_member;
  delete from "Customer"       where "memberId" = p_member;
  delete from "PayoutAccount"  where "memberId" = p_member;
  delete from "Voucher"        where "memberId" = p_member;
  delete from "Adjustment"     where "memberId" = p_member;  -- BI-005 exception (purge)
  delete from "Wallet"         where "memberId" = p_member;
  delete from "MemberRole"     where "memberId" = p_member;
  delete from "Notification"   where "member_id" = p_member;
  delete from "Message"        where "memberId" = p_member;
  delete from "Conversation"   where "memberId" = p_member;
  delete from "Member"         where id = p_member;

  v_counts := jsonb_build_object(
    'id', v_member.id,
    'email', v_member.email,
    'name', v_member.name,
    'purgedAt', now()
  );

  return jsonb_build_object('purged', v_counts);
end;
$$;

-- EXECUTE restricted to service_role (mirrors the money functions). API must
-- call via the service-role client after super_admin verification.
revoke execute on function public.member_purge_cascade(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.member_purge_cascade(uuid, uuid, text) to service_role;
