# Supabase - Auth foundation (Phase 1 fresh start)

No Prisma. `Supabase Postgres 15+` via `DATABASE_URL`, Auth (`email/password` `admin@jad.local` / `user@jad.local` - passwords from `SUPABASE_SEED_*` env) replaces `MockSessionProvider` `localStorage jad:mock:session` `packages/mock/src/session/MockSessionProvider.tsx:8`.

## Env (see `apps/web/.env.example:16`)

```sh
# public (VITE_ - shipped to client, RLS enforced)
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon>

# server-only (never VITE_, never commit .env)
DATABASE_URL=postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
SUPABASE_SERVICE_ROLE_KEY=<service_role> # bypasses RLS, seed only
SUPABASE_SEED_ADMIN_PASSWORD=<admin password> # local .env only, never commit
SUPABASE_SEED_USER_PASSWORD=<user password>  # local .env only, never commit
```

Copy `apps/web/.env.example` → `.env.local` for overrides. Never commit `.env*` `AGENTS.md:18`.

## Migrations

Apply with `pnpm db:migrate` (runs `supabase/apply-migrations.ts`): it connects via `DATABASE_URL`, records applied versions in `supabase_migrations.schema_migrations` (the Supabase CLI convention), applies pending `.sql` files in filename order, then probes `to_regclass` for the messaging tables.

- `DATABASE_URL` must be the **transaction-pooler** connection string from Dashboard → Settings → Database → Connect (`postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres`). The legacy direct host `db.<ref>.supabase.co` no longer resolves.
- **Upgrading a database whose migrations were applied out-of-band** (manual SQL editor, never recorded): run `pnpm db:migrate --mark-existing` once to record existing versions, then it applies only genuinely new files. (Without this, an unrecorded database re-runs every historical file - they are idempotent, but avoid it.)
- Idempotent: re-running is a no-op (`No pending migrations`). The `api/dev-server.ts` startup self-check warns loudly when `Conversation`/`Message` are missing from the schema cache.
- After each batch, run `supabase/security/rls_invariants.sql` in the SQL editor; expect only the documented `is_staff_user` exception row.

Legacy: `psql $DATABASE_URL -f supabase/migrations/<file>.sql` (requires a working pooler URL). `20260829000001_auth_foundation.sql` - Phase 1 auth only (no Prisma):

- Creates `Member`, `Role`, `MemberRole` if not exists (id = `auth.users.id` for `auth.uid()`).
- Seeds roles `admin` / `user`.
- Enables `RLS` `Member auth.uid()=id`, `MemberRole` own row, `Role` read for authenticated.
- **CRM tables (`Customer`, `Sale`, `Property`, `Commission`, `Wallet`, etc.) are intentionally left untouched** until CRM phase (Q3).

Later migrations (apply in filename order, all idempotent):

- `20260830000001_cms_contents.sql`, `20260831000002_cms_realtime.sql`,
  `20260831000003_location_verifications.sql`, `20260831000004_countries.sql`
- `20260904000001_staff_roles.sql` - staff `Role` rows (`super_admin`, `finance`, `merchant`)
- `20260905000001_audit_log.sql` - append-only `AuditLog` (service_role writes only)
- `20260906000001_reference_data.sql` - `Program`, `ProgramQuestion`, `SystemConfig`
  (service_role-only), `Policy` (public read)
- `20260907000001_notifications_content.sql` - `Notification` (own + broadcast reads),
  `ContentItem` (published public read), Realtime publication for notifications
- `20261008000001_messaging.sql`, `20261008000002_member_purge_messaging.sql`,
  `20261008000003_messaging_role_backfill.sql` - admin↔member messaging (ADR-013, FEAT-072):
  `Conversation`/`Message`, `is_staff_user()` RLS helper, `message_after_insert` trigger,
  Realtime for `Message`, purge extension, `messages` staff module

## Seed

`pnpm seed` (`tsx supabase/seed.ts:1`) uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) to `auth.admin.createUser` (`admin@jad.local` / `user@jad.local` - passwords from `SUPABASE_SEED_*` env, never committed) + `Role` (`admin`, `user`) + `Member` + `MemberRole`. Run after migrations:

```sh
# root .env (gitignored) must contain:
# SUPABASE_SEED_ADMIN_PASSWORD=...
# SUPABASE_SEED_USER_PASSWORD=...
pnpm seed
```

## Auth scope (Phase 1)

- Supabase + PostgreSQL + Supabase Auth + TanStack Query only. No Prisma / no ORM.
- Only `admin` / `user` test accounts. No registration, MFA, password reset, social login, user management UI.
- CRM/CMS backend intentionally deferred - dashboards are static placeholders.
- Full RLS/authorization design when CRM modules are connected.

## Security invariants

- No `VITE_` service key `docs/security/SECURITY.md:97`.
- No hardcoded passwords - `SUPABASE_SEED_*` env only.
- Roles resolved authoritatively via `MemberRole` → `Role` (never client-side).
- Finance invariants (`BI-005`, `BI-008`) deferred - no finance tables mutated in Phase 1.
