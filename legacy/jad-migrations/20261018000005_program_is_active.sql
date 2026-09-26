-- Program lifecycle: admin-editable programs with a soft "isActive" flag.
--
-- Programs are referenced by `Registration.programId` / `Member.programId`
-- (ON DELETE RESTRICT-style FK), so a hard delete is unsafe once used. Admin
-- retires a program by deactivating it: the public `GET /programs` list and
-- the public read RLS policy only expose active programs, while existing
-- registrations/members keep their reference intact.
--
-- Pre-apply validation (run first):
--   select id, code, name, "isActive" from "Program" order by id;
--
-- Down: drop policy program_public_read, recreate the unconditional read
-- (`using (true)`), alter table "Program" drop column if exists "isActive".

alter table "Program" add column if not exists "isActive" boolean not null default true;

do $$
begin
  if exists (select 1 from pg_policies where tablename = 'Program' and policyname = 'program_public_read') then
    drop policy program_public_read on "Program";
  end if;
  create policy program_public_read on "Program"
    for select to anon, authenticated using ("isActive");
end $$;
