# AGENTS.md

Authority for the AF Homes Ecofarm codebase (membership-card business). This file
holds the rules common tasks need. History and specialist detail are in
`docs/agents/` (see **Reference**) and are read only when relevant. Do not
reintroduce retired JAD Realty material or implement from JAD DTOs, tables,
statuses or permission models.

## Active branch and architecture

Checkout `ClaudAfhomes/AFhomes-ecofarm-v2`, branch `claud/mongodb-conversion`, selected
by the user. Preserve all existing uncommitted work, including CMS. MongoDB work came
from the separate `afhomes-mongodb` workspace; never copy that workspace wholesale.

Active stack: MongoDB Atlas through the native `mongodb` 7.7 driver, Better Auth,
TypeScript, Node.js API, React 19 + Vite 8 + TanStack Query, CSS Modules with shared
`@afhomes/ui`, pnpm + Turborepo. Intended hosting: DigitalOcean Droplet with Node,
systemd and Nginx, no Docker (`docs/mongodb/DIGITALOCEAN-NATIVE-HOSTING.md`).
Do not add Mongoose, Ant Design, Tailwind or Supabase dependencies to active MongoDB
functionality because historical documents mention them. Supabase/Postgres and
Vercel material is legacy reference only.

## Current owner decisions

- **Fresh native MongoDB operation (3 Nov).** Do not combine or import Supabase history
  into Atlas. "Fresh start" does not authorize deleting or resetting anything: preserve
  Supabase, existing MongoDB records, administrators, passwords and assignments,
  capture archives and unmounted migration code. Focus: native workflow correctness,
  measured performance, remaining browser proof. Scope:
  `docs/mongodb/NATIVE-READINESS-2026-11-03.md`, `LOCAL-RELEASE-ACCEPTANCE-2026-11-03.md`.
- **Deployment status (5 Nov correction).** The owner confirms an existing DigitalOcean
  deployment. Freshly fetched `origin/develop` and `origin/release/v2.0` contain the
  production API and manual release helper; the old `staging/v1.0` branch was removed.
  The running Droplet revision/configuration was not inspected. This branch's pending
  changes are not assumed deployed; local proof is not production acceptance. See
  `docs/ai/decision-register.md` D20 and the Phase 10 report's deployment correction.
- **Administrators.** One administrator exists in Supabase; a separate MongoDB Super
  Admin was authorized and created 26 Oct (`docs/mongodb/ADMIN-BOOTSTRAP-REPORT.md`).
  Preserve both. Never rerun bootstrap, reset credentials or repair assignments.
- **Native auth** is password-only (MongoDB MFA removed at the user's request; Supabase
  MFA code stays intact). Staff use administrator-set temporary passwords with an
  enforced first-login change, never invitations. VIP customers activate through
  single-use, expiring codes/links and choose their own password. Never mount the
  private Better Auth admin handler. `AFHOMES_ENABLE_LEGACY_PASSWORDS` stays default-off.
- **OST** is created directly and is already accredited; never add a
  registration/endorsement journey.
- **CMS last.** Redemption, Services, Reports and CMS are disabled
  (`packages/shared/src/features.ts`) with source preserved. Do not enable them or widen
  the conversion allowlist to bypass UI errors.
- **Runtime.** `pnpm dev` launches real-MongoDB localhost (admin 5184, web 5183, API
  3084) on `afhomes_dev` with only previously approved core writes and no automatic
  schema setup. `pnpm dev:mongodb:local` is the disposable synthetic runtime. Tests must
  never target Atlas.

### Past approvals are not standing authorization

These Atlas changes were each separately approved and applied: additive core
initialization (26 Oct), reference catalog, historical-import collections/indexes
(29 Oct), six core validators (31 Oct), VIP issuance setup (2 Nov). Each approval
covered that action only. The tier-validator and points-ledger-validator proposals
are **not** approved. Every new database, schema, validator, index, import or cleanup
action needs its own explicit approval. Dated detail: `docs/agents/mongodb-conversion-log.md`.

## Approval boundaries

Never without explicit, per-action authorization in the current session: existing-data
migration or import, Atlas or Supabase writes, schema/validator/index changes,
real-admin or account changes, environment or secret changes, enabling disabled
modules, provisioning, deployment, service restarts, DNS/Atlas access changes,
production migrations or remote crons, real payment/commission/accreditation records.
A question about how to deploy is not permission to deploy. Never print credentials,
connection strings or raw MongoDB errors. Keep `.env.local` untouched and ignored.

## Version control

The agent must never stage, commit, push, publish, or otherwise alter git state — no
`git add`, `git commit`, `git push`, branch, tag, stash, reset, or GitHub action (PRs,
merges, releases) of any kind — unless the user has explicitly commanded it in the
current session. Reading history, status, and diffs is always allowed. File edits in
the working tree are normal work; moving them into git is not.

## Layout

- `apps/web` - public SPA, customer portal (`/customer/**`), OST portal. Base `/`.
- `apps/admin` - staff operations SPA. Base `/admin/`.
- `api/` - one router (`api/router.ts` → `api/_lib/router.ts`); handlers in
  `api/_handlers/**`; native MongoDB logic in `api/_lib/*.mongo.ts`; hosted entry
  `api/server.ts`. Underscore directories are never separate functions.
- `packages/contracts` - Zod contracts, the **single source** for shared types;
  `schemas/lifecycle.ts` owns core sale-lifecycle statuses and transitions.
- `packages/shared` (exact-decimal money, formatters, feature flags), `packages/ui`
  (tokens, primitives), `packages/config` (typed public env).
- `supabase/` legacy migrations/seed/bootstrap; `deploy/digitalocean/` systemd/Nginx templates.

## Commands (from root)

```sh
pnpm dev | pnpm dev:mongodb:local
pnpm test            # all workspaces, one at a time (slow; release gates)
pnpm typecheck | pnpm lint
pnpm check:env       # env isolation; add -- --built after builds
pnpm test:mongodb:local | test:mongodb:harness | test:mongodb:recovery
```

Single spec: `pnpm --filter api exec vitest run <path>` (same per workspace).
`pnpm format` rewrites the whole repo; format only files you changed. If `turbo` cannot
find `pnpm`, use `npx pnpm <cmd>` or `corepack enable`.

## Database invariants

- **Money is exact-decimal text**; no float math. Use `@afhomes/shared` helpers.
- **A sale is a frozen commercial record** (price, minimum down payment, yearly points,
  commission rate, expected commission snapshots). Never recompute history from the
  catalog or hand-edit a snapshot.
- **Only verified money counts.** `recorded` is not money yet; `rejected` and `voided`
  never were. Totals, balances and activation come from server-side payment records.
- **Activation requires full verified payment, re-checked server-side**, and is
  idempotent. A down payment, existing account, seller action or button never activates.
- **No final-commission-qualification rule exists.** `final_qualification_pending →
  earned` is a manual, permission-gated, audited decision with mandatory notes. Payout
  is a reference marker, not money movement. No automatic clawbacks.
- **Identifiers never authorize anything.** QR token and fallback code are hashed,
  random, returned once and rotated, never recovered. Resolution carries no customer PII.
- **Issued identifiers are permanent:** AAI/AAO accreditation numbers, customer numbers
  and VIP control numbers are never reissued, renumbered or reused. IST AAI is a
  permanent employee identifier (no expiry/renewal); OST has annual validity. IST→OST
  keeps the numeric suffix and collisions block conversion. OST team transfer requires an
  expired term; generic referral writes cannot bypass transfer/renewal approval.
- **Government ID numbers are write-only**: masked in responses, never in audit payloads.
- Private files are delivered only through short-lived signed URLs from an authorized API.
- Points are safe integers. Historical records are never rewritten to match new rules.
- Rule sources: `docs/AFHOMES-BUSINESS-RULES.md`, `docs/business-rules/INDEX.md`,
  index `docs/ai/business-rules-index.md`; open conflicts `docs/ai/decision-register.md`.

## Authorization architecture

Staff: active staff user → role assignment → active role → per-module
view/create/update/delete, MINUS deny-only restrictions (which can never add);
super_admin gets every module by slug. The principal is resolved **per request** with no
cache, so a permission change applies on the next call
(`api/_lib/afhomes-access.mongo.ts`). Frontend `canViewModule()`,
`navItemsForPermissions()` and `RequireRole` (`apps/admin/src/app/navigation.ts`) are UX
only; every action is re-checked server-side.

Customers are a **separate**, ownership-only system (`customer-access*`) with no module
row. A staff member who owns a customer gets customer access to that one customer and no
staff capability through the portal. A suspended/cancelled customer may read their profile
but not membership or points.

Each invariant has a named regression test that must stay green:

| # | Invariant | Test |
|---|---|---|
| A | A user restriction removes access, never adds it | `api/_handlers/authorization.regression.spec.ts` |
| B | A user cannot assign a permission they do not hold | same |
| C | An Admin cannot alter or deactivate the Super Admin | same |
| D | System roles cannot be deleted or defanged | same |
| E | A direct URL cannot bypass nav permission filtering | `apps/admin/src/app/authorization.regression.spec.tsx` |
| F | Client permission state cannot authorize a server action | both suites |
| G | Inactive staff cannot use staff APIs with a valid session | api suite |
| H | A permission change applies on the next resolution | api suite |

## Conventions

- CSS Modules per component; tokens in `@afhomes/ui`; `@/*` maps to `apps/<app>/src`.
- Tests colocated as `<target>.spec.ts(x)`; apps use `renderWithProviders`
  (`src/test/utils.tsx`). Never reintroduce `installMockApi` or `@afhomes/mock`.
  Native MongoDB tests use disposable replicas (`api/_lib/testing/mongo-replica.ts`).
- All HTTP goes through `apps/<app>/src/lib/api/client.ts` (`request`/`requestList`),
  validated against `@afhomes/contracts`. No ad-hoc `fetch` in features.
- Prettier: `semi`, `singleQuote`, `printWidth: 100`, `trailingComma: all`.
- Input rules (single source `packages/contracts/src/schemas/input.ts`): person names
  Unicode letters, stored UPPERCASE; PH mobiles canonical `+63`; emails lowercase; money
  exact-decimal strings; birth dates past and plausible. Emails, passwords, tokens, URLs,
  UUIDs, hashes, keys, paths and notes are never case-folded. Frontend normalizes on
  submit (`apps/admin/src/lib/normalize.ts`), handlers on write, imports per row.
- Business dates use Asia/Manila, not UTC. Server instants shown to members use the shared
  UTC helpers; the staff console stays browser-zone (`apps/admin/src/lib/format.ts`).
- Live search: `useDebouncedValue` (~300ms) with the debounced term in the queryKey;
  staged filters sync from the settle callback, never a setState-in-effect.
- Freshness: mutation invalidation first, then conservative polling (5s import jobs; 15s
  finance/activation/history/member-lookup; 30s audit/OST/applications/commissions/
  memberships/customer points). Logout clears the whole QueryClient.
- Money/count display only through `@afhomes/shared` (`formatMoney`, `formatCount`,
  `…OrDash`, `formatCompactMoney`). Never concat `₱{…}`.
- Query keys from `features/business/queryKeys.ts`; mutations via `useBusinessMutation`.
- Form controls from `@afhomes/ui`; optional fields are labelled "(Optional)"; add
  `required` only where the original control had it.
- Admin routes are lazy (`apps/admin/src/app/App.tsx`); route specs use `findBy*`. Never
  stub the global `URL` constructor with a plain object (subclass it).

## Environment

Only `VITE_`-prefixed variables reach the browser; browser code never reads
`process.env` and server code never reads `import.meta.env`. `pnpm check:env` enforces
this. `loadPublicEnv` in `packages/config` is the one sanctioned whole-object read.
Never commit `.env*`; `.env.example` lists names only.

## Reference (load only when relevant; not auto-imported)

| File | Contents |
|---|---|
| `docs/agents/mongodb-conversion-log.md` | Dated MongoDB checkpoints and approvals, 26 Oct – 3 Nov, verbatim |
| `docs/agents/supabase-legacy-reference.md` | Supabase/Postgres + Vercel system verbatim: phases, SQL invariants, defects and false passes, Postgres test suite, original conventions/authorization/env, bootstrap, health, known debt, Vercel deployment |
| `docs/agents/knowledge-vault.md` | Obsidian vault and Graphify workflow |
| `docs/mongodb/` | Per-feature MongoDB reports and evidence |
| `docs/ai/` | AI navigation indexes and decision register (open items U1–U7) |
