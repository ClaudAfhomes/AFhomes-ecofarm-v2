-- AF Homes: preserve IST conversion provenance in the existing develop transfer workflow.
-- No parallel conversion endpoint or account creation path is introduced.
-- Validate: disposable lifecycle/transfer gates; down: retain immutable history.
begin;
create table if not exists private.ost_ist_conversions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  staff_id uuid not null unique references public.staff_users(id) on delete restrict,
  from_aa_number text not null,
  to_aa_number text not null unique,
  from_role text not null,
  from_upline_staff_id uuid references public.staff_users(id) on delete restrict,
  effective_date date not null,
  approved_by uuid not null references public.staff_users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table private.ost_ist_conversions enable row level security;
revoke all on private.ost_ist_conversions from public,anon,authenticated,service_role;

create or replace function private.guard_ost_conversion_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  raise exception 'OST_CONVERSION_HISTORY_IMMUTABLE' using errcode='42501';
end $$;
revoke all on function private.guard_ost_conversion_history() from public,anon,authenticated,service_role;
drop trigger if exists ost_conversion_history_guard on private.ost_ist_conversions;
create trigger ost_conversion_history_guard before update or delete on private.ost_ist_conversions
for each row execute function private.guard_ost_conversion_history();


insert into public.role_permissions(role_id,module_id,can_view,can_create,can_update,can_delete)
select r.id,m.id,true,false,false,false from public.roles r join public.modules m on m.key='network.ost_registrations'
where r.slug='senior_sales_manager' on conflict(role_id,module_id) do update set can_view=true;
commit;
