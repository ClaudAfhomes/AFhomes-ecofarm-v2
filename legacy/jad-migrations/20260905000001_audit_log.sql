-- Server-side audit log for api/ mutating handlers (Phase B0).
-- Append-only: no UPDATE/DELETE grants; rows are written with service_role
-- by Vercel Functions via api/_lib/audit.ts. Frontend visibility is served
-- through GET /api/v1/admin/audit-log (Phase B4).
-- SSOT: docs/business/BUSINESS-RULES.md #8 (all exceptions audited).

create table if not exists "AuditLog" (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_id uuid references "Member"(id) on delete set null,
  actor_role text,
  target_type text,
  target_id text,
  target_name text,
  detail text,
  created_at timestamp with time zone not null default now()
);
create index if not exists "AuditLog_created_idx" on "AuditLog"(created_at desc);
create index if not exists "AuditLog_target_idx" on "AuditLog"(target_type, target_id);
create index if not exists "AuditLog_actor_idx" on "AuditLog"(actor_id);

alter table "AuditLog" enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='AuditLog' and policyname='auditlog_service_role_all') then
    create policy auditlog_service_role_all on "AuditLog" for all to service_role using (true) with check (true);
  end if;
end $$;
