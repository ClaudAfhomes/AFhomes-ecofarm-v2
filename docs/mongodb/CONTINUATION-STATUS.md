# AFHomes MongoDB Conversion - Continuation Status

## Latest continuation: Phase 5 remains IN PROGRESS

**Current checkpoint:** [Phase 5 integration report](PHASE5-INTEGRATION-REPORT.md).
Customer directory/create/update, advanced portal points/ledger/rotation and real
cookie staff/RBAC integration now have local replica-set/HTTP proof. Explicit
Mongo browser mode and a disposable local launcher exist; browser acceptance is
pending. The older descriptions below are historical, not the current status of
the repaired staff resolver or customer factories. No production cutover occurred.

The existing administrator is already bootstrapped; preserve its identity,
password and assignments. No bootstrap/reset/replacement is authorized.

New local work: `api/_lib/catalog.mongo.ts`, `customer-activation.mongo.ts`, and
`customer-handlers.mongo.ts` provide unmounted catalog, VIP activation and
ownership-scoped portal factories. A fresh disposable **replica set** fixture
verifies actual transactions, Better Auth login and loopback cookie requests.
See `PHASE5-REPORT.md` for exact evidence and remaining work.

Do not interpret older checked phase boxes below as integration acceptance:
the older `local-mongodb.mjs` still starts standalone MongoDB; the existing
Mongo staff resolver converts UUIDs to ObjectIds and its session verifier calls
unavailable provider APIs. Active router/browser paths still use Supabase.
The new factories are deliberately not mounted through that unverified boundary.
Next: complete customer directory/create/update parity and advanced portal
points/ledger/credential rotation, then resolve the staff/session integration
gate and prove actual UI flows. Do not add DELETE catalog operations or a
customer self-edit endpoint: those were inaccurate ledger entries, now corrected.

**Date:** 25 October 2026
**Branch:** `claud/develop` (tracking `origin/claud/develop`)
**Target Repository:** `https://github.com/ClaudAfhomes/afhomes-mongodb`
**Source Repository (READ-ONLY):** `https://github.com/ClaudAfhomes/AFhomes-ecofarm-v2`, branch `develop`, snapshot `f512c1416550feaf0c79a6bb204c51d08fa990f6`
**Source Inspection Clone:** `C:\Users\SSD-CLAUD\afhomes-mongodb-source-inspect` (clean working tree)

---

## Phase 0: Protect and Establish the Baseline — COMPLETE

### Boundary Checks ✅

| Check | Status | Evidence |
|-------|--------|----------|
| Target/source Git separation | PASS | Target on `claud/develop` at initial commit `5bfa6f02`; source clone clean, no source remotes in target |
| `.env.local` ignored | PASS | `.gitignore` contains `.env.local`; never staged or committed |
| No Supabase credentials printed | PASS | Phase 1 ping logs only static status; driver errors suppressed |
| No Atlas writes | PASS | Phase 1 ping is read-only `{ ping: 1 }`; auth factory guarded to `afhomes_dev` |
| Feature flags respected | PASS | `packages/shared/src/features.ts` has `redemption: false`, `services: false`; router respects via `isFeaturePathEnabled` |

### Environment & Tooling ✅

| Tool | Version | Status |
|------|---------|--------|
| Node.js | 24.19.0 | Compatible (>=20.19.0 required) |
| Corepack pnpm | 11.22.0 | Working |
| MongoDB driver | 7.7.0 | Pinned in `api/package.json` |
| Better Auth | 1.7.12 | Pinned with `@better-auth/mongo-adapter@1.7.12` |

### Verification Commands (Fresh Runs) ✅

| Command | Result | Notes |
|---------|--------|-------|
| `corepack pnpm --filter api exec vitest run --maxWorkers=2` | **2,762 PASS** (146 files) | Exit 0, no timeouts |
| `corepack pnpm typecheck` | **PASS** | All 7 workspaces + operator TypeScript |
| `corepack pnpm lint` | **PASS** | 0 errors; 29 admin warnings, 8 web warnings (pre-existing) |
| `corepack pnpm build` | **PASS** | Both SPAs; existing chunk-size warnings |
| `corepack pnpm check:env -- --built` | **PASS** | 701 browser + 305 server files + built assets |

### Runtime Entry Points Identified ✅

| Entry Point | File | Status |
|-------------|------|--------|
| Vercel Function (production) | `api/router.ts` | Single catch-all; dispatches via `api/_lib/router.ts` |
| Local Dev Server | `api/dev-server.ts` | Port 3000; Vite proxy `/api` → `localhost:3000` |
| Admin SPA | `apps/admin` | Port 5174; base `/admin/` |
| Web SPA (public + customer portal) | `apps/web` | Port 5173; base `/` |
| Health Probe | `GET /health`, `/api/v1/health` | Currently probes Supabase `modules` table |

### Authentication State ✅

| Component | File | Status |
|-----------|------|--------|
| Better Auth Config/Factory | `api/_lib/auth.ts` | **Unmounted** - explicit factory, validated options, UUID string callback |
| Raw Node Transport | `api/_lib/auth-transport.ts` | **Unmounted** - allowlisted endpoints, bounded body, separate `Set-Cookie` headers |
| Private Identity Provisioner | `api/_lib/auth-provisioning.ts` | **Unmounted** - admin-plugin instance, server-only `createUser`, handler never exposed |
| Supabase Auth (current runtime) | `api/_lib/auth-verify.ts`, session providers | **Active** - browser SDK, service-role verification, MFA/assurance checks |

### Feature Flags & Disabled Modules ✅

| Flag | Value | Affected Paths (blocked by `isFeaturePathEnabled`) |
|------|-------|----------------------------------------------------|
| `redemption` | `false` | `/admin/redemption`, `/admin/member-lookup`, `/customer/redemptions`, `/redemptions`, `/reports/redemptions` |
| `services` | `false` | `/admin/points`, `/customer/refunds`, `/earning`, `/customer/points` (non-API) |

**Preserved Source:** All redemption/services implementation files remain in place; tests explicitly enable flags in isolated fixtures.

### Parity Ledger Baseline ✅

No enabled feature can disappear unnoticed. The following domains are **enabled** and must be preserved through conversion:

- **Sales & Finance:** Card products/plans, customers, sales lifecycle, payments, activation, memberships, commissions
- **Customers/VIP Activation:** Customer directory, onboarding tokens, activation code/link, customer portal (dashboard, card, points, profile)
- **IST/OST & Sales Network:** Registrations, accreditation, renewals, referrals, genealogy, team transfers, public verification
- **Organization & RBAC:** Departments, staff, roles, permissions, deny-only restrictions, system-role protections
- **Applications/Reservations/Forms:** Application wizard, purchase terms, reservation agreements, official forms, document generation
- **Imports/Files:** Customer/member/OST workbooks, identity documents, receipts, CMS media
- **Reports/Analytics:** All scoped reports, audit log, exports
- **CMS:** Public marketing pages, media, settings, history

**Disabled (explicitly held):** Redemption, Operational Services — source retained, navigation/API/routes hidden/denied.

### Current Blockers

| Blocker | Description | Resolution Path |
|---------|-------------|-----------------|
| No disposable local MongoDB replica set | Phase 2 requires a loopback-only test harness for real adapter round trips, transactions, indexes | Create `packages/db-testing` MongoDB equivalent; never fall back to Atlas |
| Auth/RBAC cutover not started | Better Auth factory exists but unmounted; Supabase still powers all live workflows | Phase 3: replace passwordless experiment with authorized temporary-password flow |
| Health probe uses Supabase | `/health` checks `modules` table via Supabase service client | Phase 11: update to MongoDB probe without credential leakage |
| Browser session providers use Supabase SDK | `apps/admin/src/lib/session.tsx`, `apps/web/src/lib/customer-session.tsx` | Phase 11: replace behind existing providers/API clients |
| No MongoDB collections/indexes/validators created | Phase 1 ping creates nothing; adapter may create indexes on first use | Phase 2: explicit operator step for setup against disposable local instance |

### Phase 5 — Catalog, customers, VIP activation and customer portal (IN PROGRESS)

**Exact Next Step:** Port enabled card categories/plans/products, exact pricing/payment-scheme rules, customer directory/detail/search/profile and existing eligibility checks. Preserve confidential field projections and document access restrictions. Complete staff-issued VIP activation code/link, customer password choice, atomic linking, audit history, issue/reissue/revoke/expiry behavior from source. Port existing enabled customer dashboard/card/membership/payment-history and read-only points surfaces. Disabled redemption/service paths stay disabled. Test activation through UI/API/real DB, refresh persistence, already-linked and cross-customer cases.

---

## Phase Checklist

- [x] **Phase 0** — Protect and establish the baseline
- [x] **Phase 1** — Build the complete functionality parity ledger
- [x] **Phase 2** — Local MongoDB integration and integrity foundation
- [x] **Phase 3** — Correct authentication and the two account flows
- [x] **Phase 4** — Organization, permissions and account lifecycle (CORE COMPLETE)
- [ ] **Phase 5** — Catalog, customers, VIP activation and customer portal (IN PROGRESS)
- [ ] **Phase 6** — IST/OST and Sales Network
- [ ] **Phase 7** — Applications, reservations and official forms
- [ ] **Phase 8** — Sales, Finance, memberships and commissions
- [ ] **Phase 9** — Imports, files, background jobs and recovery
- [ ] **Phase 10** — Reports, analytics, exports, audit and CMS
- [ ] **Phase 11** — Finish frontend integration and remove runtime Supabase coupling
- [ ] **Phase 12** — Full end-to-end parity and failure verification
- [ ] **Phase 13** — Prepare the reviewable handoff; protect remote boundaries

---

## Evidence Files (Local, Ignored)

- `.phase1-*.log` — Phase 1 raw check logs
- `.phase2a-api-tests.log`, `.phase2a-typecheck.log`, `.phase2a-build.log`, `.phase2a-env.log`
- `.phase2b-focused.log`, `.phase2b-api-tests.log`, `.phase2b-typecheck.log`, `.phase2b-build.log`, `.phase2b-env.log`, `.phase2b-lint.log`
- `.phase2-mongodb-tests.log` — Phase 2 MongoDB integration test logs (30/30 sections passing)
- `.phase2-mongodb-harness.log` — Phase 2 MongoDB harness test logs (needs fault injection support)

No credentials, temporary passwords, or environment values in any evidence file.
