# SESSION.md - handoff for a new chat session

> ## ⚠️ STALE — describes the retired JAD Realty platform
>
> Every path, table, endpoint, credential, and migration below belongs to the
> JAD platform that AF Homes Ecofarm replaced. It also points at a different
> machine. **Do not act on it.** Read `AGENTS.md` and
> `docs/AFHOMES-PHASE-1-PLAN.md` instead. Kept only for provenance; the JAD
> code is archived under `legacy/`.

Date: 2026-09-24 (UTC). This session (plan → build): **registration validation hardening** (names, middle-initial N/A, per-country phone, structured PH/non-PH address, strict DOB, submit re-validation) + **localhost location-list incident** (root-caused to unapplied/unseeded location tables, fixed live). Prior session work (voucher edit/delete, SweetAlert modal, QR stop-on-decode, message auto-scroll, login privacy link, storage sync) is committed as `be541ad` on `develop`. **This session's 45 files are UNCOMMITTED and UNDEPLOYED** - but `pnpm db:migrate` + `seed:locations` were run against the hosted DB (backward-compatible, see below). No `vercel --prod` this session.

## Deployment - current state (the important part)

**Live site:** `https://jadrealty.vercel.app` (production alias of the `jad-realty` Vercel project under `orlando-workspace-afhomes`). All deploys are **manual**: `pnpm dlx vercel --prod` from the repo root (deploy source shows as the `staging` branch). Branch history is `feature/chat` → merged/committed by the user; there is no git auto-deploy wired up.

**Topology (all one origin - required for auth):**

- `/` → web SPA (`apps/web/dist`)
- `/admin` → admin SPA (`apps/admin/dist`, Vite `base: '/admin/'` in production)
- `/api/v1/*` → ONE Vercel Function (`api/router.ts`)
- `/health` → readiness probe (`api/_handlers/health.ts`)
- `/crons/commission-clearing` → daily commission-clearing trigger (GET, see below)

**Supabase:** project `vudwoqduebdgtzvybywb.supabase.co` (URL is in root `.env`).
**Super-admin login is `jad@admin.com` / `SUPABASE_PROD_SUPERADMIN_PASSWORD`** (both in root `.env`). `admin@jad.local` and `user@jad.local` **do not exist** on the deployed DB - do not suggest them. Migrations + seed are applied (`pnpm db:migrate` uses root `.env` `DATABASE_URL`; versions recorded in `supabase_migrations.schema_migrations`).

**New endpoints since the last handoff:**

- `GET /locations/provinces?countryCode=PH` (public, provinces + independent cities as top level)
- `GET /locations/cities?provinceCode=...` (public, children; `[]` for independent-city parents; 404 unknown)
- `GET /locations/barangays?cityCode=...` (public; 404 unknown city)
- `GET /config/public` countries now carry optional `dialCode/phoneMin/phoneMax/phonePattern`
- `POST /contact` (public, honeypot + per-IP throttle) - `api/_handlers/contact.ts`
- `GET /admin/inquiries`, `PATCH /admin/inquiries/:id` (staff `cms` module, audited)
- `POST /admin/programs`, `PATCH /admin/programs/:id` (staff `programs` super_admin, audited; `isActive` retire)
- `POST /auth/verify-email`, `POST /auth/verify-email/resend` rewritten to self-managed EmailJS codes (see Phase K)
- `POST /admin/commissions/clear-due` (staff `withdrawals`+FINANCE_VIEW, audited)
- `GET /crons/commission-clearing` (daily Vercel cron; **intentionally unauthenticated** - idempotent + time-gated, can create no money; system actor)
- Frontend routes: `/auth/forgot-password`, `/auth/reset-password` (Supabase `resetPasswordForEmail` → PKCE recovery session → `updateUser`)
- `GET /policies` now returns `slug` and filters active programs

**New migrations applied (all live, verified in prod):**

- `20261020000003_policy_privacy_seed.sql` - upserts canonical `privacy` policy (pol-003) exactly once, never overwrites admin content. **Resolves backlog item 6 below** - the login consent Privacy Policy link now resolves.
- `20261020000004_phone_country_rules.sql` - `dial_code/phone_national_min/max/pattern` on `countries` + curated seed (25 dial codes; PH `63/10/10/^9[0-9]{9}$`).
- `20261020000005_ph_location_tables.sql` - `ph_provinces/ph_cities/ph_barangays` (PSGC codes, nullable city parent for HUCs), SELECT-public + ALL-service_role RLS mirroring `countries`.
- `20261020000006_registration_address_columns.sql` - 7 structured columns (`province/city/barangay_code+name`, `region_name`) on `Registration` + `Member`; legacy `address` keeps street-line meaning.
- `20261016000001_sale_qualify_coalesce_fix.sql` - `(v_patch ->> 'sellerId')::uuid` cast
- `20261016000002_list_order_indexes.sql` - `Member(createdAt)`, `Sale(submittedAt)`, `Sale(sellerId,submittedAt)`, `Commission(memberId,createdAt)`
- `20261017000001_role_authenticated_read.sql` - `grant select (slug, name) on "Role" to authenticated`
- `20261017000002_sale_qualify_referral_fix.sql` - per-`commissionType` idempotency + `DIRECT_REFERRAL` backfill
- `20261017000003_commission_clearing.sql` - `commission_clear`, `commission_clear_batch`, `COMMISSION_CLEARING_DAYS='7'`
- `20261017000004_member_id_verified.sql` - `Member.idVerified` + backfill
- `20261017000005_commission_clear_format_fix.sql` - `…990.00` mask
- `20261018000001_contact_inquiries.sql` - `ContactInquiry(id, name, email, message, status NEW|READ|ARCHIVED, ipHash, createdAt, handledAt, handledBy)`, service_role-only RLS, `INQUIRY_STATUS_UPDATED` audit
- `20261018000002_email_verification_codes.sql` - `EmailVerification(email PK, user_id, code_hash, expires_at, attempts, send_count, window_start, sent_at, verified_at)`, service_role-only
- `20261018000003_policy_slug.sql` - `Policy.slug` backfilled from `type`/`id`, `UNIQUE`, `CHECK slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`
- `20261018000004_policy_realtime.sql` - `alter publication supabase_realtime add table "Policy"`
- `20261018000005_program_is_active.sql` - `Program.isActive boolean default true`, public RLS `using ("isActive")`
- `20261018000006_policy_type_normalize.sql` - `type/slug='policies'` → `terms` when title contains "term"
- `20261019000001_sale_qualify_immediate_credit.sql` - `sale_qualify` now inserts `AVAILABLE` + inline `commission_clear` (wallet/ledger) in same tx; sweep `commission_clear_batch(0,'system')`
- `20261019000002_sale_qualify_return_fix.sql` - fixes `jsonb_build_object('sale', v_sale)` nesting bug via `v_sale_json jsonb` → flat `{"sale":{…}}`
- `20261019000003_sale_referrer_id.sql` - `Sale.referrerId uuid` + best-effort backfill from `referrerName` → direct referral
- `20261019000004_sale_qualify_referrer_model.sql` - `DIRECT_REFERRAL` payee is `Sale.referrerId` (members only, no free text); `referrerId` fallback removed (null = no referral)
- `20261019000005_sale_delete_guard.sql` - `sale_delete(id,actor,role)` SECURITY DEFINER; blocks delete when any `AVAILABLE` commission exists; deletes non-credited commissions + sale + `SALE_DELETED` audit
- `20261019000006_orphan_commission_cleanup.sql` - reverses/wallet-debits 3 orphan `AVAILABLE` commissions (Darcy 160k, Orlando 640k) with `COMMISSION_REVERSAL` ledger entries and removes rows
- `20261019000007_sale_qualify_sponsor_fallback.sql` - fallback: `referrerId` wins else `Member.sponsorId` (never both); adds pending estimate downline slice + sponsor backfill

### How the deploy is wired

- `scripts/prepare-vercel-env.mjs` - writes `VITE_WEB_URL`/`VITE_ADMIN_URL` into `apps/{web,admin}/.env.production` from **`VERCEL_PROJECT_PRODUCTION_URL`** (fallback `VERCEL_URL`). MUST be the canonical host, otherwise login redirects to a per-deployment URL (different origin → different localStorage → login loop). Do not set these vars in Vercel env.
- `scripts/assemble-vercel-output.mjs` - copies `apps/web/dist` → `vercel-static/` and `apps/admin/dist` → `vercel-static/admin/`.
- `vercel.json` - `framework: null`, buildCommand chain (prepare → `turbo run build` → assemble), `outputDirectory: vercel-static`, rewrites (`/api/v1/:path*`→`/api/router`, `/health`→`/api/router?path=health`, `/admin*`→admin index, `/(.*)`→web index), `functions: { "api/router.ts": { "includeFiles": "packages/**" } }`, and `crons`: `/health` daily `0 0 * * *` + `/crons/commission-clearing` daily `0 1 * * *`. **Hobby allows max 2 daily crons**.
- **CRITICAL:** `includeFiles` must stay `packages/**`. Narrowing it risks `ERR_MODULE_NOT_FOUND .../@jad/contracts/src/index.ts`.
- `.vercelignore` - excludes `**/*.spec.ts(x)`, `api/dev-server.ts`, `supabase/`, `docs/`, `node_modules/`, `.turbo/`, `vercel-static/`, **`.env*`**, `.vercel/`.
- `.gitignore` - added `vercel-static/`.

### Single-function API (Vercel Hobby caps at 12 functions)

- `api/v1/**` handlers live in **`api/_handlers/**`** (underscore dirs are not functions).
- `api/_lib/router.ts` - shared URL→handler router. **Handlers are lazy-loaded** (`lazy(() => import(...))` per branch, cached per instance); shared libs stay eager. `route-coverage.ts` recognizes dynamic-import branches.
- `api/router.ts` - the single Vercel Function; `resolveRequestUrl` rebuilds the path from the rewrite's `?path=` param.
- `api/_lib/rest.ts` - `serviceClient()`/`anonClient()` are **cached per instance**; `requireService` delegates. `api/_lib/verification-code.ts` uses the inferred `ServiceClient` type (`NonNullable<ReturnType<typeof serviceClient>>`) with `Chain` casts through `unknown` so `supabase.from()` typing stays loose.
- `api/_lib/emailjs.ts` - EmailJS REST delivery (`user_id`/`accessToken`/`template_params`), 10s abort, never throws.
- `api/_lib/catalog-cms-sync.ts` - bidirectional catalog↔CMS `properties` sync for linked listings (`catalogId`), exact-decimal price gate, version bump + realtime broadcast.
- `api/_lib/env.ts` - no hardcoded URL fallback; trims `url`/`serviceKey`/`anonKey`; `getEmailJsConfig()` requires `EMAILJS_SERVICE_ID/TEMPLATE_ID/PUBLIC_KEY`.

### What this session built (uncommitted; prior turns deployed: 9d78da8, 71323a0, 1278dee on staging)

**Commission instant-credit + pending pipeline:**
- `sale_qualify` now credits `AVAILABLE` + `clearedAt` + `Wallet` (`availableBalance`, `totalEarned`, recomputed `pendingAmount` via `990.00` mask) + `LedgerEntry` `CREDIT` + `COMMISSION_CLEARED` audit in the same tx; per-type idempotency; referral backfill + sweep `commission_clear_batch(0)`. Referrer model: `DIRECT_REFERRAL` → `Sale.referrerId` when set else `Member.sponsorId` (never both), no self-pay. `pendingCommission` computed server-side in `GET /me/wallet` via `pending-commission.ts` (`ownSales×direct` + `referredSales×referral` + `downlineSales(referrerId IS NULL)×referral`), with `multiplyMoney` in `@jad/shared` (BigInt, PG-compatible half-away). Contract `walletSchema.pendingCommission` optional; `saleSchema.referrerId`, `submitSaleRequestSchema.referrerId`.

**Qualify fixes:**
- `ConfirmDialog` gained `confirmDisabled`/`confirmLoading` (`packages/ui/src/components/ConfirmDialog.tsx`); `SaleDetailPage` gained `inFlight` ref + `deleteMut.isPending` guard, close-on-success only, `ConfirmDialog` pending wiring; `SalesPage` guard via `deleteMut.isPending`; `SaleFormDialog` added `if (isPending) return` race guard.
- `api/_lib/pipeline.ts` same-status idempotent (`patch.status === currentStatus → null`); handler same-status no-op for non-qualify, always RPC for `QUALIFYING_SALE`.
- Return-shape fix: `select to_jsonb(s) into v_sale_json` → `jsonb_build_object('sale', v_sale_json)`; handler defensively unwraps `sale.to_jsonb ?? sale`. Specs updated to flat.

**Referrer flow:**
- `submitSaleRequestSchema` now `referrerId` (no free text); `SaleSubmitPage` select uses `referrerId` (id + name) from `useDirectReferrals`, hint notes sponsor fallback; admin `SaleFormDialog` filters `referrerOptions` to `sponsorId === sellerId`, clears invalid referrer on seller change, edit prefill + `updateMut` includes `referrerId/referrerName`.
- API `POST /sales` + `/sales/:id/resubmit` + `POST /admin/sales` validate `referrerId` is a direct referral of the seller; `PATCH /admin/sales/:id` whitelist + validation; `sponsorId` repair skips `referrerId IS NOT NULL` sales.

**Payout + sale-delete + commissions link:**
- `POST /me/payout-accounts` now inserts `accountIdentifierMasked: maskIdentifier(...)` (was the NOT NULL violation). `GET /me/commissions` drops commissions whose sale no longer exists (never a dead property link). `sale_delete` guard + orphan cleanup (reverse credited via ledger + wallet debit then remove).

**Admin loading hardening (10-item):**
- Sale detail/list delete, sale form race, registration accept/reject, MembersPage archive/restore, MemberDetailPage edit save, deactivate/activate, qualify/revoke, archive, purge spinner `loading={purgePending}`. All use `actionPending + guard + confirmDisabled/confirmLoading` + cancel/backdrop lock.

**Auth gates + archive:**
- Archived-list mapping now uses `mapMemberRow` + fallbacks, warns on drop.
- `getMemberAccessBlock()` shared helper; `LoginPage` + `session.tsx` block `archivedAt` / `accountStatus !== ACTIVE` with `ACCOUNT_ARCHIVED`/`ACCOUNT_INACTIVE`; archive bans (`ban_duration: 876000h`), restore unbans, clears `archivedBy`; mock parity in admin/member handlers.

**Mocks/seeds/specs:** `MockSale.referrerId`, `toSale`, ` MockWallet.pendingCommission`, store wallets, commissions `AVAILABLE`, member store `accountStatus/archivedAt`, web mock login gates, admin archive/restore/purge mock, new `pending-commission.spec.ts`, `archived.spec.ts`, `memberLifecycle.spec.ts`, updated `SaleSubmitPage.spec`, `sponsors repair`, `payout-accounts`.

**Background:** `docs/business/BUSINESS-RULES.md:133` BR-COM-002 now notes fallback ("referrer wins else sponsor").

### What this session built (UNCOMMITTED, 45 files on `develop`; DB writes ARE live)

**Registration validation hardening (TDD, user decisions: curated phone table / non-PH text fields / MI N/A→empty / full PSGC seed):**
- `packages/contracts/src/schemas/registration-validation.ts` (new, single source): normalize-then-validate primitives - Unicode-letter names (`\p{L}\p{M}`, spaces/hyphens/apostrophes, curly-folded, 60 max, control-char reject), MI fold (`A.`→`A`, N/A→empty), E.164 phone engine (`toPhoneRule` kernel + `validatePhoneNumber`), strict DOB parser (YYYY-MM-DD round-trip, past-only, min-age, 120 max), PH/generic address shapes.
- `registerRequestSchema` tightened (names/MI/DOB/phone-shape/gender+country trim+length, structured address + no-mixing superRefine; `resubmitRequestSchema` re-derived via plain-base `.partial()` - Zod v4 forbids `.partial()` on refined schemas); `registration.ts`/`member.ts` read models gained optional address columns; `publicConfigSchema` countries gained optional phone metadata.
- `api/_lib/intake-validation.ts` (new): `buildPhoneRule`/`validateIntakePhone`/`resolveIntakeAddress` with injected lookups + `locationLookupsFor` (service-client cast pattern); independent-city self-parent convention (`provinceCode == cityCode`, names snapshotted server-side, never trusted from client).
- `register.ts`: country `is_active` check, per-country E.164 normalization stored canonical, hierarchy membership checks, new columns on insert + replay; `resubmit.ts`: **now actually validates** (`resubmitRequestSchema.safeParse`, legacy `governmentId` alias folded) + phone/address normalization + street-only path; `approve.ts` carries columns to Member; `mapRegistrationRow`/`mapMemberRow` pass new columns through.
- `GET /locations/*` handlers + router branches (route-coverage green); `GET /config/public` serves sanitized phone metadata (malformed rows dropped per-row).
- Web `RegistrationForm`: MI N/A checkbox (disables input), `+dial` hint, `SearchableSelect` combobox (deferred filter, free text reverts on blur - never submitted; keyboard accessible), PH hierarchy with dependent resets vs generic region/city, live DOB validation, **full-draft re-validation on submit** with step jump + focus (closes persisted-draft/devtools bypass), review shows N/A + resolved names; draft key bumped `v1→v2` with shape guard + v1 cleanup (also added to test setup); `ResubmitPage` prefills hierarchy + N/A state.
- Dev mocks: dial metadata on mock PH, mock `/locations/*` tiny dataset, MockMember hierarchy fields.

**Localhost location-list incident (user-reported, fixed live):**
- Root cause: brand-new `ph_*` tables existed only as migration files - never applied or seeded on the hosted DB (localhost points at hosted). Endpoint correctly fail-closed (500/empty → Alert).
- Ran `pnpm db:migrate` (4 pending incl. privacy seed - all verified via header queries), seeded PSGC via `pnpm seed:locations` from transient `@ph-dev-utils/core@0.5.0` + `@ph-dev-utils/psgc-barangays@0.1.0` (PSA Q4 2024 provenance, NOT added to package.json): **82 provinces / 1634 cities / 42046 barangays, 0 orphans**; verified via dev-server curl (all three endpoints 200 with real rows).
- UI hardening: the single opaque Alert is now split - fetch error ("could not be loaded" + Retry) vs empty dataset ("has not been loaded into the database", warning + Retry); query errors log to dev console; cities/barangays errors gained Retry.

### Production auth fixes (cumulative)

- Bearer header on every request; 401 → one rotation → retry → `clearSession` (no warning for public requests). `VITE_SUPABASE_ANON_KEY` trimmed (trailing-newline `%0A` realtime bug).
- Role reads for login go through the restored `authenticated` `SELECT(slug,name)` grant.
- Email verification no longer depends on Supabase SMTP or the Magic Link template variable; EmailJS is the delivery mechanism (requires `Allow non-browser` + correct `EMAILJS_*`).

### Security audit - done + still open
Done: secrets excluded, hardcoded URL removed, CORS scoped, `/health`, money functions + `commission_clear(_batch)` + `sale_delete` service_role-only, cron trigger intentionally public (idempotent + time-gated), SELECT-only Role re-grant (rls_invariants #1,4,6 PASS; #2/3 findings are pre-existing managed-project Anon/Storage grants + is_staff_user routine, documented), pending replay now updates the existing row (no duplicate).
**Still open (do these next):**

1. **EmailJS delivery:** the deployed env has the right `EMAILJS_*` keys but the service was misconfigured. Logs showed `403 non-browser disabled` then `400 The service ID not found` (the configured `EMAILJS_SERVICE_ID` does not exist in the account that owns the configured public key). Re-enter the correct `EMAILJS_SERVICE_ID` (same EmailJS account as the keys) and redeploy.
2. **Rate limiting** on public endpoints (`/auth/register`, `/registration/location-verify`) - API-SPEC 5.2.
3. **Clean the Vercel env var `VITE_SUPABASE_ANON_KEY`** - trailing newline (realtime `%0A`).
4. **Rotate the Supabase service-role key** - pre-`.vercelignore` snapshots may hold it.
5. **Supabase dashboard → Authentication → URL Configuration:** Site URL `https://jadrealty.vercel.app` + redirect URL `.../auth/reset-password`.
6. **Privacy policy content: DONE this session** (`20261020000003` upserts canonical `privacy` policy; login consent link resolves).
7. **Deploy the uncommitted registration work:** commit the 45 files, then `pnpm dlx vercel --prod` (DB side already live and backward-compatible).
7. **Pending-replay update semantics (now implemented):** a re-registration with the same email refreshes the PENDING row. Consider whether a PENDING application should be editable before a decision; a stricter alternative is to keep replay unchanged and just show `replayed: true` without mutating (current implementation mutates).
8. **Public properties pages are still static** (`content/properties.ts`); the catalog↔CMS sync keeps the two admin editors consistent but does not make the public listings dynamic.
9. **Registration follow-ups (deliberately out of scope):** `verificationId` binding still dead (accepted, never enforced); password server floor still `min(1)` vs client min-8 (ASSUMPTION 1 TBD); gender values not allowlisted server-side; upload-abandon orphans (signed file never saved) need a future reconciliation sweep; max-age 120 / name-60 caps are proposed values, not business-approved.

## Repo map

Root: `C:\Users\SSD-ORLANDO\Documents\Project\jad-realty` (pnpm + Turborepo).

- `apps/web` (`:5173`) - member/public SPA (React 19 + Vite 8). Prod base `/`.
- `apps/admin` (`:5174`) - staff SPA. Prod base `/admin/`.
- `api/` - `api/router.ts` (single Vercel Function), `api/_handlers/**`, `api/_lib/**`
  (auth/rbac/router/cors/money/pipeline/emailjs/verification-code/catalog-cms-sync/…), `api/dev-server.ts` (local :3000).
- `packages/contracts` - DTO types + Zod schemas, single source; now also `contactSubmissionRequestSchema`, `contactInquirySchema`, `programCreate/UpdateSchema`, `policySlugSchema`, `replayed`, `referrerId`, plus `registration-validation.ts` (normalize-then-validate core: names/MI/phone/DOB/address), location ref schemas, phone metadata on public config.
- `api/_lib/` now also `intake-validation.ts` (phone/address guards with injected lookups) and `storage.ts` (shared storage-sync helpers: URL→key extraction, exact-key + prefix removal, best-effort/never-throw).
- `packages/config`, `packages/shared` - typed env; framework-free utils.
- `packages/mock`, `packages/ui` - test mocks/session fixtures; tokens + shared components (`Spinner`, `notify*`).
- `scripts/` - `prepare-vercel-env.mjs`, `assemble-vercel-output.mjs`.
- `vercel-static/` - assembled deploy output (gitignored).
- `supabase/migrations/` - one idempotent migration per change + header validation queries;
  `supabase/seed.ts` (now seeds `COMMISSION_CLEARING_DAYS` + `slug` + referrer-aware commissions); `supabase/seed-ph-locations.ts` (`pnpm seed:locations --file/--url [--dry-run]`, fail-closed PSGC import, chunked upserts); `supabase/security/rls_invariants.sql`
  (empty = PASS, except documented `is_staff_user` §5; Q2/Q3 findings are pre-existing managed-project state).
- `docs/` - SSOT; **never reformatted** (`.prettierignore`). Largely stale; `AGENTS.md` + this file + code are authoritative.

## Stack / conventions (do not violate)

- Money is exact-decimal **strings**; format with `@jad/shared`; no float math anywhere (including TS repair math - use integer/BigInt). `multiplyMoney` mirrors PG `round(x,2)` half-away.
- `to_char(x, 'FM…990.00')` renders zero as **`0.00`** - always use the `…990.00` mask. Bit us live on the cron endpoint (500) before the fix.
- All HTTP via typed clients (`request`/`requestList`/`requestPage`/`requestListEnvelope`) validated against `@jad/contracts`; no ad-hoc `fetch` in features.
- Authenticated users: SELECT-only RLS on identity/member tables; all writes via service-role handlers or `SECURITY DEFINER` functions. `Role` reads are restricted to `slug`/`name`.
- Money transitions are atomic DB functions (`withdraw_*`, `sale_qualify`, `commission_clear*`, `sale_delete`) - single transaction, wallet row-locked, ledger + wallet + audit in one unit; EXECUTE restricted to `service_role`. Never re-implement money state changes as sequential API writes.
- **Contact inquiries** are service_role-only (`ContactInquiry`), triaged via `cms` module (the queue, not email, is delivery).
- **Email verification codes** are service_role-only (`EmailVerification`: `code_hash` HMAC-SHA256 with `EMAIL_OTP_PEPPER` or service key, 15-min TTL, max 5 attempts, 60s cooldown, 5/hour cap; `listUsers` scan is bounded 300).
- **Program lifecycle:** `isActive` (soft retire); public list is active-only (`using ("isActive")` + handler `eq isActive=true`); `POST/PATCH /admin/programs` are `super_admin`.
- **Policy identity:** `slug` is the stable public URL key; `findPolicy` matches slug/id/`type` case-insensitively; footer/consent links hide when the slug/type is absent.
- **Sales referrer:** `Sale.referrerId` (members only) + `referrerName` snapshot; referrer pickable from `useDirectReferrals()`; payee on qualify is picked referrer → else seller's `Member.sponsorId` → else skipped; pending estimate counts both picked-referrer sales and downline-with-no-referrer sales.
- **Registration validation is normalize-then-validate, single-sourced in `@jad/contracts`** (`registration-validation.ts`): client step validators delegate to the same primitives the Zod schemas enforce; lengths/formats always apply to normalized values, never raw input or `maxlength`. Server is the boundary (client is UX-only); persisted drafts are untrusted (shape-guarded, re-validated on submit).
- **Phone:** canonical E.164 storage (`+<dial><national>`); curated per-country rules from `countries` (generic 7-15 fallback); PH = `09…`/`+639…`, 10-digit NSN starting 9.
- **Address:** legacy `address` column = street line (optional); hierarchy in `province/city/barangay_code+name` (PH, codes + server-resolved snapshots) or `region_name`/`city_name` (others); independent cities self-parent (`provinceCode == cityCode`); membership re-checked server-side on every write; `mapRegistrationRow`/`mapMemberRow` pass columns through.
- Migration discipline: one migration per change, idempotent; run the validation queries in each file header before applying; include a down note. `.sql` files are hand-formatted (no SQL prettier in repo). Apply with `pnpm db:migrate` (root `.env` `DATABASE_URL`).
- CSS Modules per component; tokens in `@jad/ui`.
- Tests colocated `*.spec.ts(x)`; web `renderWithProviders`/`mockFetchRoutes`; admin `installMockApi()` (install + `server.install()`/`restore()` per test).
- Secrets never committed; root `.env` gitignored AND excluded from Vercel uploads. Do not paste keys into chat/docs.
- Deployment is Vercel + Supabase, single-origin, one API function (Hobby cap 12); see above.

## Verification status

- `pnpm typecheck`: 8/8 workspaces pass. `pnpm exec turbo run build` + assemble OK. `pnpm dlx vercel build --yes` produces exactly **1 function**, exit 0; check `.vercel/output/config.json` routes. NOTE: the build log prints `SupabaseAuthClient` TS notes (`Property 'admin'/'getUser'/… does not exist`) - verified **pre-existing and non-blocking** (pristine HEAD prints 20 and deploys fine).
- Tests: api **579/579** (incl. new `intake-validation` (10), `locations` (9), `policies/[id]` (8), register replay/removal, resubmit enforcement, approve cleanup, purge storage); contracts 8 files pass (incl. `registration-validation` (55), `auth` + `location-ref` (26)); web **428/428** (incl. validator unit (33), `SearchableSelect` (5), generic non-PH flow (3), tampered-draft, split location states); admin: all non-CMS suites pass + policies copy updates (known **pre-existing** CMS/policy parallel-load flakes + genealogy timing flake pass in isolation - rerun those if they fail once; proven identical on pristine HEAD via stash comparison).
- `pnpm db:migrate` - idempotent; this session applied `policy_privacy_seed` + `phone_country_rules` + `ph_location_tables` + `registration_address_columns` (header queries verified: privacy=1 row, PH/US/GB/SG metadata correct, 0 orphans); `rls_invariants.sql` re-run: #1/#4/#6/#7 empty, #5 only documented `is_staff_user` (+ pre-existing trigger helpers), #2/#3 pre-existing managed grants with new tables matching the baseline pattern (SELECT-only policies, no new exposure).
- `pnpm seed:locations` - **82 provinces / 1634 cities / 42046 barangays, 0 orphans** (PSA Q4 2024 via transient `@ph-dev-utils` packages - NOT added to package.json; Manila correctly province-null).
- Live probes (local dev-server + curl): `GET /locations/provinces|cities|barangays` → 200 with real rows, contract shape; web mock + `RegisterPage` full-submit flow (hierarchy select → payload asserts) green.
- Live probes: `GET /health` → `{ok:true,db:"ok"}`; `GET /api/v1/crons/commission-clearing` → `{cleared,total,windowDays}`; `GET /api/v1/policies` → `{data[0].slug:"terms"}` (was `"policies"`). Rolled-back live test proved the full clear path (AVAILABLE + wallet + CREDIT ledger, self-healing pending recompute). `POST /sales` with `referrerId` → referrer earns; `GET /sales/:id` as referrer → 200 (not 404); orphan count 0.
- Live probes (this session, local dev-server + curl against hosted DB): `GET /locations/provinces?countryCode=PH`, `/cities?provinceCode=0128`, `/barangays?cityCode=012801` → all 200 with real PSGC rows in contract shape.
- Vercel function logs: `pnpm dlx vercel logs <deployment-url>` (exact `jad-realty-<hash>-orlando-workspace-afhomes.vercel.app` URL from `vercel ls --prod`).
- Admin queues: `GET /admin/queues` → `{"registrations":1,"salesReadyToQualify":1,"sales":…, "members":2,"withdrawals":0}`.

## Useful commands

- Local: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format`,
  `pnpm seed`, `pnpm db:migrate [--mark-existing]`, `pnpm seed:locations --file/--url [--dry-run]`.
- Local API: `pnpm exec tsx api/dev-server.ts` (:3000; Vite proxies `/api`).
- Deploy: `pnpm dlx vercel --prod` (login/link already done; `vercel ls --prod` to list).
- Single spec: `pnpm --filter @jad/admin exec vitest run <path>` (same per workspace).
- Read-only prod DB check: `node -e` with `pg` + root `.env` `DATABASE_URL` (SELECTs only; wrap write-tests in `BEGIN`/`ROLLBACK`).

## Session notes for the next agent

- **This session is UNCOMMITTED + UNDEPLOYED (45 files, code only).** The hosted DB already has migrations 003-006 + 82/1634/42046 location rows (backward-compatible: nullable columns, additive tables). Commit, then `pnpm dlx vercel --prod` to ship the registration UI + `/locations/*` endpoints.
- **PSGC refresh:** `seed-ph-locations.ts` is upsert-safe; re-run with a fresh PSA extract quarterly. Provenance this round: `@ph-dev-utils/core@0.5.0` + `@ph-dev-utils/psgc-barangays@0.1.0` (PSA Q4 2024), used transiently - NOT in package.json.
- **Login account is `jad@admin.com`** (password in root `.env`) on the deployed Supabase.
- **The `includeFiles` must remain `packages/**`** - narrowing crashes the deployed function.
- **Hobby cron limit: max 2 daily crons** - hourly schedules are rejected at deploy validation; keep `/health` + `/crons/commission-clearing` daily.
- **`VITE_WEB_URL`/`VITE_ADMIN_URL` are auto-derived** from `VERCEL_PROJECT_PRODUCTION_URL`; never set them in Vercel env, and never log into an old per-deployment URL (cross-origin loop).
- **`sale_qualify` must stay flat** `{"sale":{…}}` - the nesting bug (`sale.to_jsonb`) silently breaks every admin confirm; defensively unwrap in the handler as well.
- **Commission payee:** picked `Sale.referrerId` wins else `Member.sponsorId` (never both, referrer wins); pending estimate counts both picked and downline-with-no-referrer; sponsor-link repair must skip `referrerId IS NOT NULL` to avoid double-pay.
- **Pending pipeline is expectation-only** - a downline sale that later gets a referrer won't pay the sponsor; docs/BR-COM-002 now notes the fallback but the docs are still largely stale.
- **`sale_delete` now blocks** `AVAILABLE` commissions; deletion is not a reversal workflow for credited sales. Don't add one without a product decision.
- **Archived mapping** built with `mapMemberRow` + `?` fallbacks; ban/unban is best-effort (pre-existing JWTs stay valid until expiry) — app-layer gates are the enforcement point.
- **Cached Supabase clients** (`serviceClient()`/`anonClient()` in `api/_lib/rest.ts`) must keep call-inferred types via the unannotated `make*Client` factories - `ReturnType<typeof createClient>` breaks `.from()` typing (`never[]`); bare `SupabaseClient` is fine locally but keep the factory form (it passes both).
- **Draft persistence is v2:** `jad:register:draft:v2` with shape guard + v1 self-cleanup; test setup removes v2 in afterEach (missing this caused cross-test pollution once - check first when register specs flake).
- **rAF-timing in scroll/message tests:** assert scroll position inside `waitFor` (frames land after paint); stub rAF sync only in hook unit specs.
- **SearchableSelect contract:** free text reverts on blur, commits only listed options; focus clears a filled field to browse; highlight clamped on read (no reset effects - lint forbids set-state-in-effect, render-time sync uses state form).
- **Zod v4:** `.partial()` is forbidden on refined schemas - keep a plain base + apply `superRefine` per derivation (see `auth.ts` `registerBaseSchema`).
- **Mock `fetch` + React Query fallback race:** `usePolicyLinks`-style fallbacks render before mocked fetches resolve - settle with `waitFor` on absence/presence, and use link dumps to find duplicate sources.
- **New-handler specs need storage mocks:** `remove`/`list` must exist on mocked storage or the best-effort helpers swallow TypeErrors (tests still pass but assert nothing); `ilike` must exist where handlers use it.
- **Loading states:** `actionPending` + `InFlight` ref + `confirmDisabled/confirmLoading` + cancel/backdrop lock while pending; purge Save/Archive/Deactivate toggles all use it now; SaleDetailPage delete is `deleteMut.isPending`, Registration accept is gated, SaleFormDialog has `if (isPending) return`, MembersPage has `archivePending/restorePending`.
- **EmailJS:** server-side via `api/_lib/emailjs.ts` REST `https://api.emailjs.com/api/v1.0/email/send` (`user_id` = public key, `accessToken` = private key when present, `template_params: {to_email,to_name,verification_code,app_name,expiry_minutes}`); requires **Allow non-browser** + correct `EMAILJS_SERVICE_ID/TEMPLATE_ID/PUBLIC_KEY` (and redeploy; env changes do not apply to existing deployments).
- **Notifications:** success is a centered `toast: {position:'center'}` (`jad-swal-container` in `base.css`), errors/warnings are centered modals; success was a top-end toast that set `aria-hidden` and broke `findByRole` assertions (nowToast center avoids the `aria-hidden` trap). Guards use `min-height:70vh; place-items:center`.
- **Shared mock stores are module singletons** - tests that mutate them affect later tests; reset in `beforeEach` (added `resetRegistrationStore`/`resetMockMemberLifecycle`).
- **jsdom has no canvas:** QR upload-decode specs stub `Image` + `getContext` and use `fireEvent.change`.
- **Migrations applied (all live):** `contact_inquiries`, `email_verification_codes`, `policy_slug` + `policy_realtime` + `policy_type_normalize` → known legacy `type='policies'` → `terms`, `program_is_active`, `sale_qualify_immediate_credit` + `referrer_model` + `sale_delete_guard` + `orphan_cleanup` + `sponsor_fallback`.
- **Policy identity is `slug`:** canonical deep links `terms`/`privacy`/`guidelines`; admin `Type` is now a select (syncs slug when empty), never a free text `policies` again.
- **Catalog ↔ CMS properties** is a true bidirectional sync for linked listings (`catalogId`), exact-decimal price gate, version bump + realtime broadcast, and cross-cache invalidation (`['admin','properties']` ↔ `['cms','properties']`).
- **Backlog:** email `EMAILJS_SERVICE_ID` correctness (the 400 "service ID not found" + 403 "non-browser disabled"), `EMAILJS_PRIVATE_KEY` optional, `EMAIL_OTP_PEPPER` optional, privacy policy content, rate limiting, staging-vs-public decision, anon-key newline cleanup, service-role rotation, and making the public properties listings (currently static `content/properties.ts`) dynamic from the catalog/CMS (separate).

