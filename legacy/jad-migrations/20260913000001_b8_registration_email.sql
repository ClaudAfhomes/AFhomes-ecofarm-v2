-- B8+ registration email (idempotent intake): one application per email
-- while legacy rows without email stay valid. The backend stores the
-- lowercased applicant email so retries/replays resolve to the same row
-- instead of orphaning an auth account on conflict.
-- Idempotent.

alter table "Registration" add column if not exists email text;
create unique index if not exists "Registration_email_uidx" on "Registration"(email) where email is not null;
