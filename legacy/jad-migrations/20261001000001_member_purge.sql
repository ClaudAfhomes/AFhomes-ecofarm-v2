-- Phase D - Super-admin permanent member purge (owner-approved exception).
--
-- Sanctioned default lifecycle remains ARCHIVE (POST /admin/members/:id/archive).
-- This function is the sole hard-delete path, super_admin-only at the API
-- layer (verifyStaff SUPER_ADMIN_ONLY). It deletes the member and their
-- ENTIRE graph in ONE transaction so a partial purge can never happen:
-- ledger, commissions, withdrawals, sales, customers, wallets, payout
-- accounts, owned vouchers/adjustments, member roles, notifications, and the
-- Member row itself. The API then deletes the auth.users row and writes a
-- MEMBER_PURGED audit entry (audit of the purge survives; only the member's
-- own history is destroyed - the authorized BI-005 exception).
--
-- Semantics:
--   - Financial records owned by the member are DELETED here (ledger/commissions/
--     withdrawals/wallets). Corrections-as-new-transactions (BR-LED-002) do not
--     apply because the entire financial identity is being destroyed.
--   - FKs stay enforced the whole time: dependent rows are deleted leaf-first
--     so ON DELETE RESTRICT never fires.
--   - Sponsor links to OTHER members are severed via SET NULL (sponsorId),
--     preserving the remaining members' accounts.
--   - SET-NULL attributions on kept tables (Registration.reviewedBy,
--     SystemConfig.updated_by, cms_contents.updated_by, archivedBy) null out.
--   - Adjustment rows owned by the member are deleted (BI-005 exception noted);
--     adjustments authored by other members are left untouched.
--
-- Validation (must hold after apply):
--   select prosrc is not null from pg_proc where proname = 'member_purge_cascade';
--   select grantee from information_schema.role_routine_grants
--     where routine_name = 'member_purge_cascade'; -- only service_role
-- Idempotent (create or replace + revoke/grant are idempotent).
-- Down (rollback only):
--   drop function if exists public.member_purge_cascade(uuid, uuid, text);

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
