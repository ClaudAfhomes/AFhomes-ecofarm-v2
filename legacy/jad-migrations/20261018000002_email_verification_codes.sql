-- Self-sent email verification codes (EmailJS delivery).
--
-- Registration no longer depends on Supabase Auth email delivery
-- (`signInWithOtp` + the Magic Link template): the API generates a 6-digit
-- code, stores only its HMAC-SHA256 hash here, and emails the code through
-- EmailJS (`api/_lib/emailjs.ts`). `POST /auth/verify-email` checks the
-- hash, then confirms the auth user (`email_confirm: true`) - the approval
-- handler remains the authoritative activation gate.
--
-- Anti-abuse columns: `attempts` (max 5 per code), `send_count` /
-- `window_start` (max 5 sends per rolling hour), `sent_at` (60s resend
-- cooldown). `user_id` links the auth user for confirmation; null only for
-- pre-feature legacy rows (resolved via a bounded auth-users scan).
--
-- Pre-apply validation (run first):
--   select * from "EmailVerification" limit 1;  -- expect "relation does not exist"
--
-- Down: drop table "EmailVerification" (codes are single-use; in-flight
-- applicants re-request via resend).

create table if not exists "EmailVerification" (
  email text primary key,
  "user_id" uuid,
  "code_hash" text not null,
  "expires_at" timestamptz not null,
  attempts integer not null default 0,
  "send_count" integer not null default 0,
  "window_start" timestamptz not null default now(),
  "sent_at" timestamptz not null default now(),
  "verified_at" timestamptz
);

alter table "EmailVerification" enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'EmailVerification' and policyname = 'email_verification_service_role_all') then
    create policy email_verification_service_role_all on "EmailVerification"
      for all to service_role using (true) with check (true);
  end if;
end $$;
