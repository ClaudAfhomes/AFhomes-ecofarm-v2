# SESSION.md — Chat Handoff Context

> **Protocol:** This file holds the latest handoff only. When the user says
> `handoff context to @SESSION.md`, REPLACE this entire file with the new
> session's context (do not append; delete stale sections). Keep it dense:
> decisions, patterns, open threads, and verification state. No prose essays.

## Stack (current)

pnpm + Turborepo monorepo. Branch `develop` @ `77e37ac`.

- `apps/web` (:5183 in MongoDB dev): marketing + `/customer/**` + `/ost/**` +
  dev staff entry `/admin/login`, `/staff/login`.
- `apps/admin` (:5184 in MongoDB dev): staff console, base `/admin/`.
- `api/`: single entry `api/router.ts` → `api/_lib/router.ts`
  (`BUSINESS_FAMILIES`) → `api/_handlers/**`.
- **Default local runtime is now native MongoDB** via
  `api/scripts/dev-mongodb-admin.ts`: API :3084, admin :5184, web :5183,
  database `afhomes_dev`, Better Auth (password-only), private local files under
  `~/.afhomes/private-storage/afhomes_dev`.
- Supabase Postgres + Auth remains preserved as the legacy/production path.
  MongoDB conversion is active; no Atlas import, no production cutover.
- `packages/contracts` (Zod SSOT; `lifecycle.ts`, `afhomes.ts`,
  `customer-ssot.ts`, `member.ts`) | `packages/shared` (exact-decimal money,
  dates, feature flags) | `packages/config` (`VITE_`-only) | `packages/ui`
  (tokens + primitives, incl. `TurnstileChallenge`).
- MongoDB runtime: `api/_lib/mongo-runtime.ts`, `api/_lib/mongodb.ts`,
  `api/_lib/auth.ts`, `api/_lib/hosted-runtime.ts`.
- Do not touch `docs/security/`, `docs/testing/`; `SESSION.md` is the handoff
  file updated only on explicit handoff request.

## Standing user preferences (apply without asking)

- `@ponytail` full: smallest complete change, house components first, no new
  deps, finish callers/tests/fixtures.
- UI rounds are UI-only: no handler/contract/SQL/history edits; preserve flows
  and permissions; desktop/tablet/mobile; gate on focused vitest + `tsc` +
  `eslint` + admin build; one named surface at a time.
- User-facing copy: every sentence max 5–6 words. Added copy gets reviewed and
  stripped; surface rules the user states win.
- User edits in parallel and commits mid-session. Re-check `git status` /
  `git log` before assuming state; re-read shared files before editing; leave
  foreign diffs alone; never restore what the user deliberately removed.
- Version control: never stage/commit/push/branch/tag/stash/reset or GitHub
  actions unless explicitly commanded in-session. Working-tree edits are work.
- Passwords, TIN, government IDs, Turnstile secrets never returned or printed.
  `.env.local` is read-only unless user explicitly authorizes; never commit it.
- No `select('*')` on wide rows; filter in SQL; Free-quota rules per
  `docs/supabase/SUPABASE-FREE.md`.
- Prettier is NOT a gate (CRLF artifact). Gate on `tsc` + `eslint`.

## Repo state (verified 2026-11-04)

- Branch `develop` @ `77e37ac "Merge branch 'fixes/profile-mage' into develop"`.
- Working tree has only this session's uncommitted changes:
  - `M .env.example`
  - `M api/_lib/auth.ts`
  - `M api/_lib/auth.spec.ts`
  - `M api/scripts/dev-mongodb-admin.ts`
  - `M apps/web/src/features/staff/StaffEntryPage.tsx`
  - `M apps/web/src/features/staff/staff-entry.spec.tsx`
  - `?? api/_lib/startup-diagnostics.ts`
  - `?? api/_lib/startup-diagnostics.spec.ts`
- `.env.local` (gitignored, user-owned, not modified by agent) now contains a
  valid `AFHOMES_AUTH_TURNSTILE_SECRET` and `VITE_TURNSTILE_SITE_KEY`. Auth
  secret currently mirrors `AFHOMES_SEARCH_TURNSTILE_SECRET`; both belong to the
  same widget prefix. Never print values.
- `pnpm dev` now starts successfully: MongoDB `afhomes_dev` connected, core
  workflows + search retention enabled, admin/web Vite up.
- No commits, pushes, migrations, deployments, or shared-system writes.

## Last session's work (UNCOMMITTED)

1. **`pnpm dev` configuration failure**
   - Root cause: missing `AFHOMES_AUTH_TURNSTILE_SECRET`; launcher called
     `requireAuthTurnstile()` before DB connect and its `catch` discarded the
     real error.
   - Added `api/_lib/startup-diagnostics.ts` + spec: surfaces only whitelisted,
     value-free configuration messages; hides connection/storage errors.
   - `api/scripts/dev-mongodb-admin.ts` now prints the safe detail.
   - `api/_lib/auth.ts`: `requireAuthTurnstile()` now reports the exact
     missing/invalid variable (site key vs secret, whitespace, short secret)
     and rejects `AFHOMES_AUTH_TURNSTILE_SECRET === VITE_TURNSTILE_SITE_KEY`.
   - `.env.example` documents `AFHOMES_AUTH_TURNSTILE_SECRET` (server secret,
     not the public site key).
2. **Login CAPTCHA service unavailable**
   - Root cause: auth secret had been set to the public site key; Cloudflare
     returned HTTP 400 `invalid-input-secret`, which Better Auth maps to
     `CAPTCHA service unavailable`.
   - User then configured a valid secret. Guard now prevents the site-key
     mistake at startup.
3. **Login action mismatch**
   - Root cause: `apps/web/src/features/staff/StaffEntryPage.tsx` rendered
     `TurnstileChallenge` without `action="login"`, so the web `/admin/login`
     and `/staff/login` tokens had an empty action.
   - Fix: added `action="login"` to that widget.
   - Regression test added to `staff-entry.spec.tsx` for both routes.
   - Kept backend `expectedAction: 'login'`; did NOT weaken action enforcement.
   - Admin app `PortalLoginPage.tsx` already passed `action="login"`.

## Verification this session

- `pnpm --filter api exec vitest run _lib/auth.spec.ts _lib/auth-turnstile.spec.ts _lib/startup-diagnostics.spec.ts --maxWorkers=1` — 31 passed.
- `pnpm --filter @afhomes/web exec vitest run src/features/staff/staff-entry.spec.tsx --maxWorkers=1` — 18 passed.
- `pnpm --filter @afhomes/admin exec vitest run src/features/auth/portal-login.spec.tsx --maxWorkers=1` — 15 passed.
- `pnpm --filter api typecheck` — passed.
- `pnpm --filter @afhomes/web typecheck` — passed.
- `pnpm check:env` — passed (749 browser + 554 server files).
- `pnpm dev` — starts; MongoDB ping/connection verified.
- Full `pnpm test`, full `pnpm typecheck`, `pnpm lint`, `pnpm build`,
  `pnpm test:db:local` were NOT re-run this session.

## Open threads

- **Re-test login after hard refresh** (pending user confirmation). Use
  `http://localhost:5184/admin/login` (admin app) or
  `http://localhost:5183/admin/login` / `/staff/login` (web dev entry); Vite
  HMR may have cached the old widget. If action mismatch persists, confirm
  which URL/port produced the request.
- **MongoDB conversion still gated:** no Atlas data import, migration prep
  unmounted, hosted deployment/browser acceptance pending. Production routing
  remains Supabase. Preserve existing Supabase data, admin, passwords,
  assignments; no destructive resets.
- **Carried-forward DB failures from prior session:** section 48 (customer
  import referral hierarchy), section 58 (purchase terms reason refusal ×3),
  section 77 (OST team transfer) still block `pnpm test:db:harness`; not
  re-verified this session.
- **Carried-forward product threads:** RF Only/Refunded/Installment payment
  statuses undefined; finance queue row `aria-label` still says “Record a …”
  although click opens details; live authenticated visual pass pending;
  customer-purge review still outstanding.
- **No commit/push/deploy** authorized or performed.

## Verify (from root)

```sh
pnpm dev                     # MongoDB localhost: API 3084, admin 5184, web 5183
pnpm --filter api typecheck
pnpm --filter @afhomes/web typecheck
pnpm --filter api exec vitest run _lib/auth.spec.ts _lib/auth-turnstile.spec.ts _lib/startup-diagnostics.spec.ts --maxWorkers=1
pnpm --filter @afhomes/web exec vitest run src/features/staff/staff-entry.spec.tsx --maxWorkers=1
pnpm --filter @afhomes/admin exec vitest run src/features/auth/portal-login.spec.tsx --maxWorkers=1
pnpm check:env
# full gates when needed:
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:db:local
pnpm test:db:harness          # blocked by pre-existing section 77
```
