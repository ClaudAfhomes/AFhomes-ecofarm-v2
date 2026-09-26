# AF Homes Supabase

Only `migrations/` is active. JAD migrations and scripts are preserved under `legacy/` and are never read by AF Homes commands.

`pnpm seed` upserts reference configuration only. It creates no Auth users, customers, sales, payments, or commissions. `pnpm seed:demo` is explicitly preview-only and refuses the production project ref.

The first Super Admin must be invited by a one-time server-controlled bootstrap using `auth.admin.inviteUserByEmail`; the invitee sets their password through Supabase Auth. No password is stored in an environment variable or seed.

## Super Admin bootstrap (do not run until approved)

The Phase 1 foundation is already live. Do **not** run `db:migrate` merely to create the first Super Admin; database-password authentication and Auth invitations are separate concerns.

Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AFHOMES_SUPERADMIN_EMAIL`, and `AFHOMES_ADMIN_URL` in a secure server/local operator environment. Configure the matching Site URL and redirect allow-list in Supabase Auth, plus production SMTP/email settings. Then validate with `npx pnpm bootstrap:superadmin -- --check`. When invitation execution is approved, run `npx pnpm bootstrap:superadmin` once. The command sends an Auth invitation and writes the staff assignment and audit event; it never accepts a password. The invited owner creates their password through Supabase Auth.

## Database authentication errors

`password authentication failed for user "postgres"` means `DATABASE_URL` contains an incorrect database password or connection identity. It does not indicate a service-role-key failure. Copy the Session pooler URI from Supabase Dashboard **Connect**, use `postgres.ikaevepedpqygdlipsei` as the shared-pooler username, and replace only the password placeholder. Percent-encode reserved password characters. Never substitute `SUPABASE_SERVICE_ROLE_KEY` for the database password.
