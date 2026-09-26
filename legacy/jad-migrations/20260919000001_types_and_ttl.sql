-- Phase 2C/2D - Types, updated_at maintenance, idempotency TTL
-- (review F-19 / F-24 / F-16).
--
-- dateOfBirth was stored as free text and parsed in application code; it is
-- now a real date. A shared updated_at trigger keeps mtime columns honest
-- instead of relying on callers to remember. IdempotencyKey gains a TTL so
-- replay protection cannot grow unboundedly (SPEC §5.3; default 24h, applied
-- by callers).
--
-- Pre-apply validation:
--   select id from "Member" where "dateOfBirth" is not null
--     and "dateOfBirth" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
--   select id from "Registration" where "dateOfBirth" is not null
--     and "dateOfBirth" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
-- Down: reverse the type casts only if data was backfilled (date → text via
-- to_char), drop triggers/function by name, drop the expiresAt column.

-- dateOfBirth text → date (both tables). Guarded by current type so
-- re-runs are safe: re-applying nullif(date_col,'') on an already-date
-- column would itself raise `invalid input syntax for type date`.
-- Unparseable legacy values become NULL (current data verified clean).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'Member' AND column_name = 'dateOfBirth'
             AND data_type <> 'date') THEN
    ALTER TABLE "Member" ALTER COLUMN "dateOfBirth" TYPE date
      USING (CASE WHEN trim("dateOfBirth") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN trim("dateOfBirth")::date ELSE NULL END);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'Registration' AND column_name = 'dateOfBirth'
             AND data_type <> 'date') THEN
    ALTER TABLE "Registration" ALTER COLUMN "dateOfBirth" TYPE date
      USING (CASE WHEN trim("dateOfBirth") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  THEN trim("dateOfBirth")::date ELSE NULL END);
  END IF;
END $$;

-- Shared updated_at trigger.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.set_updatedAt()
returns trigger language plpgsql as $$
begin
  new."updatedAt" = now();
  return new;
end $$;

-- Tables with an updated_at / updatedAt column that lack a trigger today.
drop trigger if exists registration_set_updatedAt on "Registration";
create trigger registration_set_updatedAt before update on "Registration"
  for each row execute function public.set_updatedAt();

drop trigger if exists sale_set_updatedAt on "Sale";
create trigger sale_set_updatedAt before update on "Sale"
  for each row execute function public.set_updatedAt();

drop trigger if exists property_set_updatedAt on "Property";
create trigger property_set_updatedAt before update on "Property"
  for each row execute function public.set_updatedAt();

drop trigger if exists policy_set_updated_at on "Policy";
create trigger policy_set_updated_at before update on "Policy"
  for each row execute function public.set_updated_at();

-- Idempotency TTL (SPEC §5.3 - 24h). NULL expiresAt = no expiry (legacy rows).
alter table "IdempotencyKey" add column if not exists "expiresAt" timestamp with time zone;
create index if not exists "IdempotencyKey_expires_idx" on "IdempotencyKey"("expiresAt");
