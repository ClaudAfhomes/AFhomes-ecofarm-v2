-- Operational access: referral-code management and operational role editing.
-- Forward only. #19 and every applied migration untouched.
--
-- WHY THIS FILE EXISTS SEPARATELY FROM 20261024000001.
--
-- `20261024000001_afhomes_operations_communications.sql` (UNTRACKED, NOT APPLIED)
-- defines `manage_ost_referral_code` and `update_operational_role` alongside the
-- communications schema. The API handlers already call both. Production has
-- neither function, so today:
--
--   POST /ost/referral-codes        -> 42883 undefined_function
--   PATCH /admin/afhomes/roles/:id  -> 42883 undefined_function
--
-- That is a live outage of two shipped features, and it is NOT fixed by
-- deploying the application: the fix is this SQL. Applying the communications
-- migration would drag six new tables, a trigger and a notification fan-out into
-- a targeted operational repair, so only the two functions the API actually
-- calls are delivered here. Communications, messages, announcements,
-- notifications and CMS remain unapplied by design.
--
-- Once `20261024000001` is eventually applied, these definitions are REPLACED
-- there by identical bodies (`create or replace`), so the split is safe in both
-- orders. The bodies below are copied verbatim from that file precisely so the
-- later replace is a no-op rather than a behaviour change.
--
-- VALIDATE (run after applying, all must be true)
--   select has_function_privilege('anon','public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer)','EXECUTE');        -- false
--   select has_function_privilege('authenticated','public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer)','EXECUTE'); -- false
--   select has_function_privilege('service_role','public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer)','EXECUTE');  -- true
--   select has_function_privilege('anon','public.update_operational_role(uuid,uuid,jsonb)','EXECUTE');        -- false
--   select has_function_privilege('authenticated','public.update_operational_role(uuid,uuid,jsonb)','EXECUTE'); -- false
--   select has_function_privilege('service_role','public.update_operational_role(uuid,uuid,jsonb)','EXECUTE');  -- true
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where p.proname='manage_ost_referral_code' and n.nspname='public';  -- 1
--
-- Down: revert the two API routes; revoke the grants below and drop the two
-- functions. No table or column is created or altered by this migration, so
-- there is no schema to unwind.

-- ---------------------------------------------------------------------------
-- 1. Actor-aware permission lookup, extended to every action.
-- ---------------------------------------------------------------------------
-- `private.has_permission_for_user` already exists, defined by APPLIED migration
-- `20261002000001_afhomes_phase7_genealogy.sql`, which handles only 'view' and
-- 'update' and applies `deny_view` per branch. `update_operational_role` below
-- needs 'create' and 'delete' as well, or the subset rule it enforces would be
-- evaluated against a function that answers `false` for two of the four
-- actions it must check. Replaced with the body from `20261024000001`, which
-- adds those two branches and applies `deny_view` to all four.
--
-- Note this is a SUPERSET of the applied definition: 'view' and 'update' resolve
-- identically, and no currently-calling code path can become more permissive,
-- because the added branches only answer for actions that previously returned
-- false unconditionally.
create or replace function private.has_permission_for_user(p_staff_id uuid,p_key text,p_action text default 'view')
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff_users su
 join public.staff_role_assignments a on a.staff_id=su.id
 join public.roles r on r.id=a.role_id and r.is_active
 join public.modules m on m.key=p_key and m.is_active
 left join public.role_permissions rp on rp.role_id=r.id and rp.module_id=m.id
 left join public.staff_permission_restrictions spr on spr.staff_id=su.id and spr.module_id=m.id
 where su.id=p_staff_id and su.status='active' and not coalesce(spr.deny_view,false)
 and case p_action
 when 'view' then r.slug='super_admin' or coalesce(rp.can_view,false)
 when 'create' then (r.slug='super_admin' or coalesce(rp.can_create,false)) and not coalesce(spr.deny_create,false)
 when 'update' then (r.slug='super_admin' or coalesce(rp.can_update,false)) and not coalesce(spr.deny_update,false)
 when 'delete' then (r.slug='super_admin' or coalesce(rp.can_delete,false)) and not coalesce(spr.deny_delete,false)
 else false end);
$$;
-- Idempotent: already revoked from these roles by `20261002000001`. Re-stated so
-- this file stands alone, and because `create or replace` does NOT reset grants.
-- `service_role` is deliberately NOT granted: these two entry points are reached
-- only from inside the SECURITY DEFINER functions below, where the caller's
-- privileges do not apply.
revoke all on function private.has_permission_for_user(uuid,text,text) from public,anon,authenticated;

-- ---------------------------------------------------------------------------
-- 2. Referral-code management.
-- ---------------------------------------------------------------------------
-- Lock the sponsor, preserve legacy active codes, explicit rotation only.
--
-- The business rules this encodes, all of them server-side:
--   - the SPONSOR must be an active Sales Manager (`FOR UPDATE`, so a concurrent
--     deactivation cannot slip between the check and the insert);
--   - an Admin or Super Admin may issue on BEHALF of that sponsor; `created_by`
--     records the actor and `sponsor_staff_id` the sponsor, so an Admin clicking
--     the button never becomes the owner;
--   - a Sales Manager may only issue their own code;
--   - plain issue is refused while a live code exists, so duplicates cannot
--     accumulate; rotation is the ONLY way to replace one;
--   - rotation deactivates `is_active` codes only, leaving already-spent
--     (`use_count >= max_uses`) and expired rows as the historical record they
--     are;
--   - only the hash is stored. Plaintext is returned once by the API from the
--     value it generated, and is never persisted, so it cannot be recovered here;
--   - every issue and rotation writes an audit event in the same transaction.
create or replace function public.manage_ost_referral_code(p_actor uuid,p_sponsor uuid,p_rotate boolean,p_hash text,p_hint text,p_expires timestamptz,p_max_uses integer)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_role text; v_id uuid;
begin
 v_role:=private.mutation_actor_role(p_actor,'network.referrals','view');
 if v_role not in ('admin','super_admin','sales_manager') or (v_role='sales_manager' and p_actor<>p_sponsor) then raise exception 'FORBIDDEN: Only active Sales Managers or administrators may issue'; end if;
 perform 1 from public.staff_users s join public.staff_role_assignments a on a.staff_id=s.id join public.roles r on r.id=a.role_id and r.is_active
 where s.id=p_sponsor and s.status='active' and r.slug='sales_manager' for update of s;
 if not found then raise exception 'FORBIDDEN: Only an active Sales Manager can sponsor an OST account'; end if;
 if not p_rotate and exists(select 1 from public.referral_codes where sponsor_staff_id=p_sponsor and is_active and expires_at>now() and use_count<max_uses) then raise exception 'CONFLICT: An active referral code already exists. Rotate it to generate a replacement'; end if;
 if p_hash !~ '^[a-f0-9]{64}$' or p_max_uses not between 1 and 100 or p_expires<=now() then raise exception 'VALIDATION_ERROR: Invalid referral code'; end if;
 if p_rotate then update public.referral_codes set is_active=false where sponsor_staff_id=p_sponsor and is_active; end if;
 insert into public.referral_codes(code_hash,code_hint,sponsor_staff_id,expires_at,max_uses,use_count,is_active,created_by)
 values(p_hash,p_hint,p_sponsor,p_expires,p_max_uses,0,true,p_actor) returning id into v_id;
 insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values(p_actor,case when p_rotate then 'REFERRAL_CODE_ROTATED' else 'REFERRAL_CODE_ISSUED' end,'referral_code',v_id::text,jsonb_build_object('sponsorStaffId',p_sponsor));
 return v_id;
end $$;
-- Postgres grants EXECUTE to PUBLIC on every new function by default, so without
-- these two lines `anon` could mint itself a referral code by calling this
-- directly over PostgREST. Per-signature, never `on all functions`.
revoke all on function public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Operational role editing.
-- ---------------------------------------------------------------------------
-- Authorization lives here, not in the browser. The handler also checks these
-- rules in TypeScript, but a handler bug cannot widen this: the function
-- re-derives the actor from `p_actor`, re-locks the role, and re-checks every
-- precondition. A client that skips the UI still meets the same wall.
--
--   - `admin`, `super_admin` and `customer` are never editable by anyone,
--     including a Super Admin editing another Super Admin;
--   - nobody may edit a role they personally hold;
--   - a system role may be edited only by a Super Admin, which is why a
--     delegated Admin sees "View access" on Finance, HR, Employee, Vice
--     Director, Senior Sales Manager, Sales Manager and OST;
--   - the subset rule is symmetric with `private.has_permission()`: an Admin can
--     only grant permissions it holds itself. A Super Admin is exempt, matching
--     the model in `api/_lib/afhomes-access.ts`, where super_admin is granted
--     every module by slug;
--   - deny-only `staff_permission_restrictions` keep subtracting through the
--     helper above; a restriction can never ADD a permission;
--   - permission rows are replaced wholesale inside one transaction, so a
--     partial write cannot leave a role half-configured;
--   - every edit writes a `ROLE_PERMISSIONS_UPDATED` audit event.
create or replace function public.update_operational_role(p_actor uuid,p_role uuid,p_input jsonb)
returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_actor_role text; v_role public.roles%rowtype; v_permission jsonb; v_module_id uuid;
begin
 v_actor_role:=private.mutation_actor_role(p_actor,'organization.roles','update');
 select * into v_role from public.roles where id=p_role for update;
 if not found then raise exception 'NOT_FOUND: Role not found'; end if;
 if v_role.slug in ('admin','super_admin','customer') or exists(select 1 from public.staff_role_assignments where staff_id=p_actor and role_id=p_role)
 or (v_role.is_system and v_actor_role<>'super_admin') then raise exception 'FORBIDDEN: Protected role'; end if;
 if p_input ? 'permissions' then
  for v_permission in select value from jsonb_array_elements(p_input->'permissions') loop
   select id into v_module_id from public.modules where key=v_permission->>'moduleKey' and is_active;
   if v_module_id is null then raise exception 'VALIDATION_ERROR: Unknown module'; end if;
   if v_actor_role<>'super_admin' and (
    (coalesce((v_permission->>'canView')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','view')) or
    (coalesce((v_permission->>'canCreate')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','create')) or
    (coalesce((v_permission->>'canUpdate')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','update')) or
    (coalesce((v_permission->>'canDelete')::boolean,false) and not private.has_permission_for_user(p_actor,v_permission->>'moduleKey','delete')))
    then raise exception 'FORBIDDEN: Cannot grant permissions you do not possess'; end if;
  end loop;
  delete from public.role_permissions where role_id=p_role;
  insert into public.role_permissions(role_id,module_id,can_view,can_create,can_update,can_delete)
  select p_role,m.id,(p->>'canView')::boolean,(p->>'canCreate')::boolean,(p->>'canUpdate')::boolean,(p->>'canDelete')::boolean
  from jsonb_array_elements(p_input->'permissions') p join public.modules m on m.key=p->>'moduleKey';
 end if;
 update public.roles set name=coalesce(p_input->>'name',name),description=case when p_input ? 'description' then p_input->>'description' else description end,
  is_active=coalesce((p_input->>'isActive')::boolean,is_active),updated_at=now() where id=p_role;
 insert into public.audit_events(actor_id,action,entity_type,entity_id) values(p_actor,'ROLE_PERMISSIONS_UPDATED','role',p_role::text);
end $$;
revoke all on function public.update_operational_role(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_operational_role(uuid,uuid,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Post-conditions, asserted in the file rather than trusted.
-- ---------------------------------------------------------------------------
-- A migration that leaves a browser-reachable grant in place is worse than one
-- that fails loudly, and a grant check is exactly the kind of thing that is
-- easy to forget and invisible when wrong. These run at apply time, so a mistake
-- aborts the transaction instead of shipping.
do $$
declare v_bad text;
begin
  -- Every function this migration installs must be unreachable by a browser
  -- role and reachable by the API's service role. Checked per exact signature.
  if exists (
    select 1 from (values
      ('public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer)'),
      ('public.update_operational_role(uuid,uuid,jsonb)')
    ) as f(sig)
    where has_function_privilege('anon', f.sig, 'EXECUTE')
       or has_function_privilege('authenticated', f.sig, 'EXECUTE')
  ) then
    v_bad := 'anon or authenticated can EXECUTE an operational-access function';
  end if;
  if not has_function_privilege('service_role','public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer)','EXECUTE')
     or not has_function_privilege('service_role','public.update_operational_role(uuid,uuid,jsonb)','EXECUTE') then
    v_bad := 'service_role cannot EXECUTE an operational-access function';
  end if;
  -- The helper stays private-only. Granting it would let a browser role ask the
  -- database questions about arbitrary staff members' permissions.
  if has_function_privilege('anon','private.has_permission_for_user(uuid,text,text)','EXECUTE')
     or has_function_privilege('authenticated','private.has_permission_for_user(uuid,text,text)','EXECUTE')
     or has_function_privilege('service_role','private.has_permission_for_user(uuid,text,text)','EXECUTE') then
    v_bad := 'private.has_permission_for_user is reachable by a browser role or service_role';
  end if;
  if v_bad is not null then
    raise exception 'GRANT_INVARIANT_VIOLATED: %', v_bad;
  end if;
end $$;
