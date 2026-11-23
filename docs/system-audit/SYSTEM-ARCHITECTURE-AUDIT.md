# System Architecture Audit — AF Homes Ecofarm v2

- Date: 2026-10-14 (UTC)
- Scope: read-only familiarization + architecture audit. No code, config, migration, or data changes made.
- Sources: direct file reads (root config, `vercel.json`, `docs/` listing, `api/_lib/router.ts`) plus read-only subagent probes of `api/_lib/`, `api/_handlers/`, `packages/*`, `supabase/migrations/`, `docs/`.
- Not inspected: `Business Rules.zip` (unavailable in repo), live Supabase project, git history, test execution.
- Convention: findings marked VERIFIED (directly read), INFERRED (probe-reported, not line-reverified), UNKNOWN (no evidence).
- Standing warning: code behavior below is observed behavior, **not** approved company policy.

## A. Executive Summary

The system is a membership-card business platform: staff sell VIP/membership cards, collect verified payments, activate memberships with QR credentials, accrue/spend points, pay single-level commissions, and manage the OST network, genealogy, and a CMS marketing site.

Architecture: React 19 + Vite 8 SPAs (`apps/web` public + customer portal, `apps/admin` staff console) → TanStack Query → a single Vercel Function (`api/router.ts` → `api/_lib/router.ts` → `api/_handlers/**`) → Supabase Postgres + Auth + Storage. All writes go through service-role handlers or narrow `SECURITY DEFINER` RPCs; browser roles are SELECT-only. Money is exact-decimal text + BigInt; only `verified` payments count; sales are frozen snapshots; commissions qualify manually; credentials rotate, never recover.

Biggest findings: no `docs/business-rules/` exists; business rules live split across `api/_lib/commerce.ts` (preview) + SQL RPC bodies (authoritative) + `packages/contracts` (validation/lifecycle) with no rule-ID tracing; no CI (`.github/` absent per probe — INFERRED); the production project is live but the prior readiness verdict predates it, so re-verify before any migration.

## B. Verified Technology Stack

| Tech | Version | Evidence |
|---|---|---|
| pnpm / Node | 11.22.0 / >=20.19.0 | `package.json:6-8` VERIFIED |
| Turborepo / TypeScript | ^2.10.11 / ~5.9.3 | `package.json:35-36` VERIFIED |
| React + React-DOM | ^19.2.8 | `apps/web`, `apps/admin` package.jsons VERIFIED (probe) |
| Vite / plugin-react | ^8.2.1 / ^6.0.5 | `apps/*/vite.config.ts`, package.jsons VERIFIED (probe) |
| react-router / TanStack Query | ^7.18.2 / ^5.101.4 | `apps/*/package.json` VERIFIED (probe) |
| zod | ^4.4.3 | `api`, apps, `packages/contracts` package.jsons VERIFIED (probe) |
| supabase-js | 2.117.2 pinned | `package.json:29` VERIFIED |
| Tailwind | ^4.3.3 | `apps/web` only VERIFIED (probe) |
| recharts / jsqr / motion | 3.10.1 / ^1.4.0 / 13.2.0 | `apps/admin` (charts+QR), `apps/web` (motion) VERIFIED (probe) |
| nodemailer / pg / tsx | 10.0.10 / ^8.23.0 / ^4.23.12 | `api/package.json`, root `package.json:32-34` VERIFIED |
| vitest / jsdom / testing-library | ^4.1.11 / ^30 / ^16 | app package.jsons VERIFIED (probe) |
| embedded-postgres | ^18.4-beta | `packages/db-testing` only VERIFIED (probe) |
| Supabase Postgres+Auth+Storage, Resend/SMTP, Vercel Functions+Cron | — | `supabase/migrations/*`, `api/_lib/*`, `vercel.json:6-16`, `.env.example` key names VERIFIED (names only, values never read) |
| Mobile app | none observed | repo root listing VERIFIED, no `mobile/` dir |

INFERRED: Vite dev ports 5173/5174 + `:3000` dev-server proxy (probe-read configs).

## C. Repository Map

```text
apps/web/src/            public SPA + /customer/** portal + OST + marketing/
  main.tsx, app/, features/customer|ost|staff, marketing/, lib/api/client.ts
apps/admin/src/          staff console, base /admin/ (+/staff,/employee,/finance,/hr,/sales aliases)
  App.tsx (React.lazy per feature), app/navigation.ts,
  features/business|redemption|documents|genealogy|memberships|ost|cms|reports|...
api/router.ts            single Vercel Function → api/_lib/router.ts (BUSINESS_FAMILIES)
api/_lib/                afhomes-access.ts, customer-access.ts, identifier.ts, commerce.ts,
                         handler-kit.ts, envelope.ts, router.ts, customer-onboarding-email.ts
api/_handlers/           ~30 handlers (cards, sales, memberships, commissions, points, redemptions,
                         referrals, genealogy, analytics, reports, ost, cms, documents, queues, ...)
packages/contracts/src/schemas/  ~25 Zod contracts; lifecycle.ts = lifecycle SSOT, input.ts, money.ts
packages/shared/src/money.ts      BigInt money helpers (single impl)
packages/config/         loadPublicEnv (VITE_-only Zod)
packages/ui/             tokens + Select/TextField/DateField/...
supabase/migrations/     73× `*_afhomes_*.sql` (20260926–20261129) VERIFIED pattern (probe count)
supabase/                apply-migrations.ts (rejects non-afhomes_), seed.ts, db-integration.ts,
                         db-testing/supabase-shim.sql (test fixture, never prod),
                         security/rls_invariants.sql
docs/                    supabase/SUPABASE-FREE.md + solutions/, security/,
                         AFHOMES_V2_ID_GENERATOR_BUSINESS_RULES.md
                         NO docs/business-rules/ VERIFIED (docs/ read)
scripts/                 prepare-vercel-env, assemble-vercel-output, check-env-isolation
vercel.json / turbo.json / pnpm-workspace.yaml  deploy + build + workspaces VERIFIED
Business Rules.zip       not observed in repo root VERIFIED (root listing); contents UNKNOWN
```

## D. Architecture and Data Flow

Entry points VERIFIED: `apps/web|admin/src/main.tsx` → Vite; `api/router.ts` → `routeRequest()` in `api/_lib/router.ts:235-259`; `api/dev-server.ts` reuses the same router locally; `vercel.json:17-51` rewrites `/api/v1/*→/api/router`, `/health→router`, `/admin/*→admin/index.html`, marketing statics, fallback `/index.html`; cron only `/health` daily.

Flow: SPA `request()/requestList()` (`apps/*/src/lib/api/client.ts`, Zod-validated vs `@afhomes/contracts`) → `BUSINESS_FAMILIES` prefix dispatch (`router.ts:55-177`) or `admin/afhomes/*` pre-dispatch → handler: `authorizeAfHomes()` (staff) or customer-ownership resolve → input normalize → service-role Supabase query or `SECURITY DEFINER` RPC → audit row → Zod response. Browser → PostgREST direct reads are SELECT-only + RLS; all money moves inside SQL transactions with row locks.

```mermaid
flowchart LR
  WEB[apps/web<br/>public + /customer portal] -->|request() Zod /api/v1| ROUTER
  ADMIN[apps/admin<br/>staff console] -->|request() Zod /api/v1| ROUTER
  ROUTER[api/router.ts<br/>single Function] --> SEL[selectHandler<br/>BUSINESS_FAMILIES + admin/afhomes]
  SEL --> H[handlers<br/>authorize + normalize + validate]
  H -->|staff: authorizeAfHomes<br/>customer: ownership only| RPC[(Supabase Postgres<br/>RPC txn + RLS)]
  H --> AUTH[(Supabase Auth)]
  H --> STOR[(Storage: 4 private + 1 public buckets)]
  H --> MAIL[Resend SMTP<br/>onboarding only]
  RPC --> AUDIT[audit_events append-only]
```

## E. Business Modules Inventory

| Module | Purpose | Entry points | Depends on |
|---|---|---|---|
| Card products/categories | plans, pricing snapshots | `GET\|POST /card-products`, `/card-categories`, admin `business/` | cms media |
| Customers | directory, onboarding tokens, imports | `/customers`, `/customer-imports`, `POST /auth/customer/activate`, portal `/customer` | address (PSGC), documents |
| Sales + payments | quotes, schemes, record/verify, cancel | `/sales`, `/sales/:id/payments\|verify\|activate\|cancel`, `/sales/:id/summary` | card-products, customers, commissions |
| Activation queue | full-verified → membership mint | `POST /sales/:id/activate`, admin Activation Queue | payments, memberships |
| Memberships + points accounts | card, ledger, reissue | `/memberships/:id`, `/points`, `/customer/membership\|points` | sales |
| Redemption (staff) | QR scan → catalog → spend | `GET /redemptions/resolve`, `POST /redemptions`, `/redemptions/items` | identifier, points_accounts |
| Earning / services / points engine | purchases, quotes, tier discounts, peso-value | `POST /earning/purchases/:id/payments\|quote`, `/earning/claims` | card tier, promotions |
| Commissions | flexible rules, qualify, payout marker | `/commissions/rules`, `/commissions/:id/qualify\|pay` | sales, referrals |
| Referrals / genealogy | upline correction, tree | `/referrals`, `/genealogy` | customers, sales |
| OST registration/accreditation/renewal | manual submit/approve/endorse/reject | `/ost`, `/ost-accreditation`, web `features/ost` | customers |
| Documents / OCR | ID upload, suggestion-only extraction, review queue | `/documents`, admin `documents/` | storage private buckets |
| Reports / analytics / queues | 10 scoped reports + audit, dashboards, payment/activation queues | `/reports`, `/analytics`, `/queues` | all |
| CMS + marketing | pages/media/settings, public site | `/cms`, web `marketing/` | `afhomes-cms-media` (public) |
| Official forms / address | purchase flow forms, PSGC lookup | `/official-forms`, `/address` (read-only) | customers |
| Admin foundation | session, roles, departments, staff, dashboard, health | `/admin/afhomes/*`, `/health` | — |

INFERRED (probe-mapped, not line-reverified): exact route verbs per handler; admin screen paths.

## F. Business Logic Inventory

Authoritative = SQL RPC; TS `commerce.ts` = preview/validation mirror. Client sends no figures (ids+qty+refs only).

| # | Rule | Observed behavior | Source | Tests | Conf |
|---|---|---|---|---|---|
| F1 | Money format+math | `^\d+(\.\d{1,2})?$`, rates 4dp; BigInt cents, `multiplyMoney` half-away, `divideMoneyExact` throws on remainder; `private.money`=round→text | `contracts/schemas/money.ts:12-19`, `shared/money.ts:14-149`, `...phase2_rpc.sql:20-32` | `money.spec.ts`, `commerce.spec.ts` | VERIFIED |
| F2 | Verified-only money | `recorded`≠money; `remaining=max(price-verified,0)`, `overpaid=max(verified-price,0)`, `fullyPaid=verified>=price` | `commerce.ts:50-114`, `phase2_rpc.sql:78-132` | `commerce.spec`, `phase26-finance.spec` | VERIFIED |
| F3 | Frozen sale | `cash_price/minDP/points/rate/expected_commission` snapshots; never recompute from `card_plans` | `commerce.ts:193-201`, `sales.ts:496` | `commerce.spec:27-56` | VERIFIED |
| F4 | Commission = price×rate; flexible rules | account→role-default→0 precedence; 0% legal; Bronze 4%→0 prospectively | `commerce.ts:33-35`, `...flexible_commission_rules.sql:6-122` | commissions specs | VERIFIED |
| F5 | Spot-cash 7d | starts first VERIFIED, `deadline=start+7d UTC`; `fully_paid` overrides | `commerce.ts:123-140`, `constants.ts:10`, `verify_card_payment:292-303` | `commerce.spec` | VERIFIED |
| F6 | Sellability | reject inactive cat/product, `price<=0`, `minDP>price` | `commerce.ts:173-184` | `commerce.spec` | VERIFIED |
| F7 | VIP schemes frozen | spot_cash/move_a/install4/move_b1(40%)/b2(25%); inexact→`INEXACT_SCHEDULE`; Bronze B1/B2→`SCHEME_NOT_ALLOWED`; no chaining (`SCHEME_FROZEN`) | `commerce.ts:289-383`, `lifecycle.ts:181-190` | `vip-payment-schemes.spec` | VERIFIED |
| F8 | Seller resolution | selling roles list; omitted→self; supplied only if active+selling+downline (super_admin bypass) | `commerce.ts:416-464` | `commerce.spec` | VERIFIED |
| F9 | Record→verify→activate | `recorded→verified\|rejected` (reason req); fullyPaid→sale `payment_verified`, commission→`payment_verified`; activation re-sums, `verified<price→SALE_NOT_FULLY_PAID`, idempotent, mints `MBS-######`, QR+fallback hashes, `expires=now+validity(12mo)`, creates points account+ledger | `phase2_rpc.sql:140-503` + Phase5 fix | `sale-payments.spec`, `phase2.spec` | VERIFIED |
| F10 | Commission lifecycle manual | `pending→payment_verified→final_qualification_pending→earned→paid`; `earned` only explicit gated+audited+notes; no auto-earn exists | `lifecycle.ts:48-56,237-246`, `commissions.ts:362,426` | `authorization.regression.spec` | VERIFIED |
| F11 | Staff redemption txn | lock membership→customer→item→account; re-validate staff; require active+unexpired+item active; price from DB; `total=cost×qty` bigint, `INSUFFICIENT_POINTS` guard; snapshots frozen; idempotent per `(redeemed_by,key)` after locks | `...phase4_redemption.sql:208-434` | `redemptions.spec`, `redemption-pos/catalog.spec`, `phase4-migration.spec` | VERIFIED |
| F12 | Points integers/caps | `0..1e9` int; BRONZE 25k/SILVER 40k/GOLD 60k caps; `spendable=max(0,bal-debt)`; earning pays debt first | `contracts/points.ts`, `...points_rebuild.sql:68-222` | `points.spec`, `db-integration §65` | VERIFIED cap source; debt-first INFERRED |
| F13 | Service discounts | per-(service,tier,window) `0<rate≤100`; `net=gross-tier-points`; stacking forbidden unless `allowDiscountStacking`; peso-value from `point_redemption_rules` | `...service_tier_discounts.sql`, `...operational_service_payments.sql:202-277` | `phase26-finance`, `points.spec` | VERIFIED formula; gating INFERRED |
| F14 | Lifecycle maps | customer/sale/payment/membership/commission/application/reservation transition tables; adjacent-only upline | `lifecycle.ts:204-317` | `phase9-customer-lifecycle.spec` | VERIFIED |
| F15 | Input normalization | names Unicode-only, PH `09→+63`, email lower, money exact, birth past+≤120y | `input.ts:26-106` | `input.spec`, `input-normalization.spec` | VERIFIED |

UNKNOWN without stakeholder refs: actual approved rates, thresholds, effective dates, tax/payout method, renewal SLAs.

## G. Roles and Permissions

Staff (authoritative backend `api/_lib/afhomes-access.ts`, RLS `private.has_permission()`): `auth.users → staff_users(active) → assignments → roles(active) → role_permissions(view/create/update/delete per 24 module keys in `contracts/schemas/afhomes.ts:17-56`) MINUS `staff_permission_restrictions` (deny-only). Resolved per-request, no cache; `super_admin`=all; invariants A–H regression-tested (`authorization.regression.spec.ts`). Frontend `navigation.ts: canViewModule/navItemsForPermissions/RequireRole` is UX-only; longest-match fix for `/admin/redemption*` VERIFIED (probe).

Customer (separate, `customer-access.ts`, imports nothing staff): `JWT → customers.auth_user_id → one customer` (ownership, no module keys, `has_permission` cannot express it). Suspended/cancelled: profile readable, membership/points refused; `reissue_membership_credentials` re-checks in SQL. Identifiers (`identifier.ts`): SHA-256 hash match only, no PII in resolve response, fallback normalized, QR not case-folded; resolution ≠ authorization.

Gaps: per-table RLS/column-grant matrix only in migration bodies (no single doc); platform default `auth.users` SELECT exposure noted in AGENTS.md as unverified on the live project; MFA only for admin/super_admin paths.

## H. Database and Data Integrity

Entities: Phase-1 21 tables (departments→audit_events) + `referral_relationships, points_accounts/ledger, onboarding_tokens, redemption_items/redemptions, cms_*, ost_*, identity_documents, service_*`, etc. (73 migrations VERIFIED pattern).

Integrity VERIFIED (probe + AGENTS.md + router read):

- Money TEXT + `~ '^(0|[1-9]...)(\.[0-9]{1,2})?$'` CHECKs; `numeric`+`private.money()` in PG; no floats.
- Frozen snapshots on `card_sales`; `recorded≠verified`; activation re-checks inside txn; idempotency keys on redemption/mutations.
- UIDs: `MBS-######`, QR 32B base64 + `AFH-XXXX-XXXX` fallback, both SHA-256 hashed, rotated-not-recovered, plaintext-once.
- Gov IDs write-only (column grants narrow, `governmentIdMasked` in `customers.ts:77-79` per probe); never in audit payloads.
- `private.has_permission()` for RLS; browser roles SELECT-only; `rls_invariants.sql` 6 zero-row checks; append-only `audit_events`.
- Lock orders fixed (redemption: membership→customer→item→account; claim: token+customer `FOR UPDATE`); `memberships.points_balance` is a cache — `points_accounts` authoritative.
- Buckets: 4 private (signed URLs server-side) + `afhomes-cms-media` public read-only.

Risks: runner skips recorded migration versions (never edit an applied file — Phase 5 lesson); denormalized balance drift; no prod DB touched in this audit.

## I. Testing and Quality Controls

Counts per probe (INFERRED — not recounted): 249 `*.spec.*` (api handlers 69, api lib 33, admin 77, web 18, contracts 17, ui 25, shared 4, config 1); only 2 `vitest.config.ts` (contracts, ui); root `test`=turbo; single-spec via `pnpm --filter <ws> exec vitest run <path>`.

DB suite: `supabase/db-integration.ts` ~16k lines, 72 sections (1–72; 22–24 customer RLS impersonation, 37 Phase-5 reconcile, 65 points position); satellites `activation/idempotency/ost-accreditation/purchase-*/reservation-*`; `test:db:local` (disposable loopback PG + shim — never prod) + `test:db:harness` (proves fail-closed non-zero exit) + `test:security:db`; guards refuse prod ref / missing URL / remote injection. Fake Supabase in `api/_lib/testing/` supports unique/defaults/error-injection, excluded from Vercel.

Quality gates: `typecheck` (incl. `tsc -p supabase`), `lint`, `check:env` (VITE_ split), `route-coverage.spec`, `apply-migrations.spec`, `migration-safety`. CI: none observed (`.github/` absent per probe).

Executed in this audit: **none** — read-only constraint. No pass/fail claimed. Appears covered: money math, commerce previews, lifecycle, sale/verify/activate, redemption txn, commission qualify/pay, auth invariants A–H, RLS sections. Appears gapped: live managed-stack behavior (PostgREST/GoTrue/Storage), effective-date/overlap edges, OCR accuracy, spreadsheet-vs-app parity (no spreadsheet seen).

## J. Documentation and Source-of-Truth Assessment

Exists: `AGENTS.md` (declared authority) VERIFIED; `README.md`, `SESSION.md`; `docs/supabase/SUPABASE-FREE.md` (quota SSOT) + 6 solutions; `docs/security/SECURITY-CHECKPOINT-A` + evidence/repros; `docs/AFHOMES_V2_ID_GENERATOR_BUSINESS_RULES.md` (sole business-rule-like doc — provenance vs `Business Rules.zip` UNKNOWN); SQL header comments + `lifecycle.ts`/`input.ts` as de-facto SSOTs; `route-coverage`/`rls_invariants` as executable guards.

Missing/weak: **no `docs/business-rules/`** VERIFIED; no rule-ID/version/effective-date convention; rules duplicated across SQL comments ↔ TS mirror ↔ Zod ↔ tests with no trace links; agent instruction is generic (AGENTS.md authority), not "read rule X before touching logic Y"; capacity docs ≠ RLS/grant matrix.

Recommendation (not a decision): one file per rule domain (`BR-###`), each with ID, version, effective date, source ref (workbook+sheet+cell/guide page), formula, eligibility, inputs/outputs, code pointers, test pointers, open questions; index + changelog; forbid new business logic without a rule ref.

## K. Risk Register

| Sev | Risk | Evidence | Impact |
|---|---|---|---|
| P0 | Managed-stack behavior unverified on live project (`auth.users` SELECT default, bucket policies, pooler) | AGENTS.md readiness note VERIFIED | PII leak / bypass if defaults open |
| P0 | No CI — RLS/typecheck/harness opt-in; stale cron keeps firing till next deploy | no `.github/` (probe), `vercel.json:11-16` VERIFIED cron | broken deploy ships silently |
| P1 | Rule provenance gap — code treated as truth; `Business Rules.zip` uncompared | no `docs/business-rules/` VERIFIED | "fix" may enshrine wrong rule |
| P1 | Dual implementation (SQL authoritative vs TS preview) drift | `commerce.ts` vs `*_rpc.sql` VERIFIED split | preview says ok, DB refuses (or worse) |
| P1 | Denormalized `points_balance` cache drift (recurrence of Phase-4 class) | `identifier.ts:authoritativeBalance` (probe) | wrong balance shown/spent |
| P2 | 73 forward-only migrations; edited-applied-file silently skipped | Phase-5 migration VERIFIED pattern | prod misses fix, stays broken |
| P2 | Identifier/legacy-alias resolution order + rotation invalidation | `identifier.ts` + `resolve_membership_code` (probe) | old code still works / wrong member |
| P2 | Hard-coded-adjacent values (caps 25/40/60k, 7d, 12mo, rates) in SQL bodies | F12/F5/F9 VERIFIED locations | rule change needs multi-file hunt |
| P3 | Polling-only freshness (5–30s) + no Realtime; logout clears cache | AGENTS.md conventions | stale ops lists, double-submit pressure |

## L. Business Rules Documentation Readiness

Not ready for enforcement yet — ready for scaffolding. Preserve: `lifecycle.ts` as lifecycle SSOT, `input.ts`/`money.ts` as validation SSOT, `commerce.ts` pure-preview layering, SQL-txn authority, SELECT-only browser roles, frozen snapshots, client-sends-no-figures, per-request auth, `afhomes_` idempotent migrations + `rls_invariants` + `test:db:local/harness`.

To introduce `docs/business-rules/`: (1) reference rule docs from AGENTS.md + handler file headers (rule-ID comments only, no formula duplication); (2) agent discovers via `docs/business-rules/INDEX.md` (ID→file→code→test map) and cites the rule ID in PRs touching `commerce.ts|*_rpc.sql|contracts/|identifier.ts`; (3) traceability = rule ID in SQL comment + TS docblock + spec name (`br-###-*`); (4) prevent unapproved change via CODEOWNERS on `docs/business-rules/` + a coverage-style check failing when logic files change without a rule ref; (5) IDs stable (`BR-SALE-001`), versions + `effective_from/to` per rule, `OPEN_QUESTIONS.md` for conflicts — never resolve by vote, only stakeholder sign-off; (6) single definition per rule, others link — no copy-paste formulas.

## M. Missing Information and Stakeholder Questions

Technical (answerable with approved safe access): git history/divergence of `claud/develop`? live-project `auth.users`/bucket defaults? actual CI state? `Business Rules.zip` manifest (workbooks/sheets/version)? which of the 73 migrations are applied to prod? OCR provider + accuracy bar? Resend deliverability scope?

Business-policy (president/authorized stakeholder only): approve each rate/cap/threshold (commission %, 25/40/60k caps, 7-day spot-cash, 12-mo validity, VIP scheme splits, peso-per-point)? final-commission-qualification criteria (code deliberately has none — keep manual or define)? refund/reversal/compensation policy? redemption void policy (columns exist, unwritten)? payout method/schedule/tax handling (explicitly non-existent — confirm out-of-scope)? renewal/overdue/suspension rules? ID-data retention + who may view unmasked? promotion-stacking authority?

## N. Recommended Next Steps

1. Freeze scope: confirm `Business Rules.zip` version + manifest; no logic changes till mapped.
2. Scaffold `docs/business-rules/` (index + template + `OPEN_QUESTIONS.md`).
3. Extract rule candidates F1–F15 with IDs, each pointing to code+tests, marked UNVERIFIED vs workbook.
4. Stakeholder walkthrough of workbooks → sign each rule (effective dates included).
5. Add traceability (rule-ID comments) + CI check (logic change requires rule ref) + CODEOWNERS.
6. Backfill regression specs for unsigned/edge behavior (overlap windows, caps, debt-first, inexact schedules).
7. Re-verify live project (auth defaults, buckets, guards) + `rls_invariants.sql` + `test:db:local/harness` before any migration.
8. Only then controlled workflow/UX improvements, one rule domain at a time.

## Self-Review

- No project source files modified for the audit itself; this file is the only new artifact, created on request.
- No dependencies installed; no migrations, deploys, or branch changes. No secrets read or printed (`.env.local` untouched; `.env.example` key names only).
- Key conclusions carry paths+lines; VERIFIED vs INFERRED vs UNKNOWN labeled; code ≠ policy stated throughout.
- Skipped: deep line-reverification of all 73 migrations and running any tests (read-only scope, no approval). Risk: probe-reported counts and CI absence must be re-verified before deploy decisions.
