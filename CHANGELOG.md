# Changelog — JA&D (JAD) Platform

> ## ⚠️ HISTORICAL — RETIRED PLATFORM
>
> This changelog documents the **JAD Realty** platform, which AF Homes Ecofarm
> replaced. It is retained for provenance only. It is **not** the changelog for
> this repository's current product, and the phases listed below were never
> implemented as written.
>
> For the current codebase, read `AGENTS.md` (authority) and
> `docs/AFHOMES-PHASE-1-PLAN.md` (scope). The JAD implementation itself is
> preserved under `legacy/`.

> **Purpose:** Maintainable, evidence-based record of meaningful project changes. This is **not** a commit log — it records new capabilities, feature modifications, architecture changes, business-rule changes, breaking changes, and migration notes that materially affect the project.
>
> **Source of truth:** entries are derived only from authoritative repository evidence — the SSOT documents under `docs/`, their in-file version headers, and the project's decision registers (ARCHITECTURE §16, BUSINESS-RULES §12, DATABASE-DESIGN §24, TESTING §20, SECURITY §20, DEPLOYMENT §20). No entry is fabricated; where evidence is insufficient, it is marked **Unknown**.
>
> **Versioning policy:** The repository is **documentation-only** (no source code, manifests, git history, or releases exist). The changelog therefore records the **documentation baseline** (documentation projects) first, and provides the structure for **implementation phases P1–P12** (ROADMAP §2) that will be appended as they are delivered. Future entries are added per phase/release using the categories below.
>
> **Date conventions:** exact creation dates are unavailable (no git history, no in-file dates). Entries cite the in-file **version headers** as evidence. Dates are recorded as **Unknown** rather than guessed.

---

## Guide

Categories used in this changelog:

- **Important Changes** — project-wide shifts, baseline establishment, delivery model changes.
- **Feature Changes** — new capabilities or significant feature modifications.
- **Architecture Changes** — structural, technology, or integration decisions.
- **Business-Rule Changes** — changes to approved business rules, invariants, or eligibility.
- **Breaking Changes** — contract-, schema-, or behavior-level breaks (none can affect runtime today: nothing is implemented or deployed).
- **Migration Notes** — database/API/config migration implications.

When a change falls into several categories, it is listed under the most relevant one and cross-referenced.

---

## [Documentation Baseline] — Documentation Projects

> This baseline is the project's complete documentation SSOT set. The repository currently contains **only** these documents (no code, no manifests, no deployment). Project numbers below are taken from each document's in-file `Version:` header. **Dates: Unknown** for all entries (no git history).

### Project 01 — Requirements & Business Analysis (Baseline v1.0)

**Evidence:** `docs/requirements/REQUIREMENTS.md`, `docs/business/BUSINESS-RULES.md` (both carry `Version: Project 01 — Requirements & Business Analysis (Baseline v1.0)`).

- **Important Changes**
  - Established the authoritative requirements baseline: FR-* functional requirements per feature group, NFR-* non-functional requirements (incl. NFR-ATOM-001/002, NFR-AUTHZ-001/002, NFR-SEC-001/002, NFR-CRYPTO-001, NFR-DATA-001), actors/roles, interaction flows (§8), acceptance criteria AC-* (§12), and assumptions (ASSUMPTION 1 auth, etc.).
  - Established the authoritative business-rules baseline: BR-* rules per domain, the role/permission matrix (§3), state models (§5), validation rules (§9), business invariants **BI-001..BI-010** (§10), explicitly prohibited behaviors (§11), and the open-decision register **OD-001..025** (§12).
- **Business-Rule Changes**
  - Confirmed **strict single-level referral** — no multi-level direct-referral commission (BR-REF-002; supersedes any implied MLM behavior, BUSINESS-RULES §13).
  - Confirmed that **purchase/sale is not required** for Active + Qualified status or sponsor eligibility (supersedes the earlier assumption, BUSINESS-RULES §13).
  - Confirmed that **no general automatic refund workflow** exists and must not be invented (BI-010; BUSINESS-RULES §13).
  - Confirmed **master voucher signing key under CTO control only** (BI-008; BR-SEC-001..004).
- **Migration Notes**
  - None — this phase created documentation only; no schema or runtime artifacts exist.

### Project 01 — Feature & Implementation Planning (Baseline v1.0)

**Evidence:** `docs/features/FEATURES.md`, `docs/roadmap/ROADMAP.md` (both carry `Version: Project 01 — Feature & Implementation Planning (Baseline v1.0)`).

- **Feature Changes**
  - Established the feature inventory FEAT-001..FEAT-071 grouped by feature group FG-* (FEATURES §3/§4).
  - Established the implementation roadmap: phases **P1..P12**, milestones M1/M5/M7/M8, feature-group sequencing, MVP definition (P1..P7, ROADMAP §7.3), MVP exit criteria (§7.4), phase exit criteria (§9), and the risk register **R-01..R-12** (§10).
- **Architecture Changes**
  - None — planning phase.
- **Important Changes**
  - Established the **approval boundary** (ROADMAP §11): OD-001..025, commission rates (PROVISIONAL 8%/4%), CTO signing service, external providers, architecture/infrastructure decisions, security-boundary changes, and destructive data operations all require explicit Owner/Stakeholder/CTO approval.

### Project 03 — Architecture & System Design (Baseline v1.0)

**Evidence:** `docs/architecture/ARCHITECTURE.md`, `docs/architecture/TECH-STACK.md`, `docs/architecture/FOLDER-STRUCTURE.md` (all carry `Version: Project 03 — Architecture & System Design (Baseline v1.0)`).

- **Architecture Changes**
  - Confirmed **modular monolith** (hexagonal within modules) — ARCH-DEC-001; microservices/serverless rejected.
  - Confirmed **NestJS** API framework — ARCH-DEC-002 (alternatives Express/Fastify only if Nest rejected).
  - Confirmed **PostgreSQL** as system of record — ARCH-DEC-003 (MySQL/SQL Server/MongoDB rejected).
  - Confirmed **Drizzle + raw SQL for ledger writes** — ARCH-DEC-004 (Prisma/TypeORM alternatives gated).
  - Confirmed **responsive web-first** member client; native mobile revisited post-MVP — ARCH-DEC-005 (native mobile = PROPOSED/REQUIRES APPROVAL).
  - Confirmed **session-based authentication with HttpOnly cookies** — ARCH-DEC-007 (JWT/hybrid rejected).
  - **Open:** deployment/infrastructure provider (ARCH-DEC-008) and NFR numeric targets (ARCH-DEC-009) — `REQUIRES APPROVAL`.
- **Important Changes**
  - Established the **technology stack SSOT** (TECH-STACK): frontend (React + Vite), backend (NestJS), database (PostgreSQL + Drizzle), auth (session-based), monorepo (pnpm + Turborepo), testing (Vitest/Supertest/Playwright), and the **prohibited-technologies list** (§16: payment gateways, money-moving wallets, floating-point money, NoSQL-for-financials, MLM libraries, auto-refund frameworks, embedded signing keys, premature distributed systems).
  - Established the **proposed monorepo folder structure** (FOLDER-STRUCTURE): `apps/api`, `apps/web`, `apps/admin`, `apps/merchant`, `packages/contracts`, `packages/config`, `packages/shared`, `infra/`, and naming/config conventions.
- **Breaking Changes**
  - None — nothing was implemented before this baseline; the decisions above become the governing contract for all later work.

### Project 04 — Product / UI / UX (Baseline v1.0)

**Evidence:** `docs/ui-ux/UI-UX.md`, `docs/ui-ux/DESIGN-SYSTEM.md` (both carry `Version: Project 04 — Product / UI / UX (Baseline v1.0)`).

- **Feature Changes**
  - Established the screen register (member/admin/merchant screens incl. SCR-MEM-018 large-tree member view), UI states vocabulary (§10), accessibility standards (§12), and the design-system token conventions (DESIGN-SYSTEM §6/§7/§8, incl. money display §9).

### Project 05 — Frontend Engineering (Baseline v1.0)

**Evidence:** `docs/architecture/FRONTEND-ARCHITECTURE.md`, `docs/development/DEVELOPMENT-GUIDELINES.md` (both carry `Version: Project 05 — Frontend Engineering (Baseline v1.0)`).

- **Architecture Changes**
  - Established the frontend architecture (app structure, feature architecture, routing, state architecture, API layer, component architecture, **client-side authorization is UX-only — never the security boundary** §8, error boundaries, performance strategy).
- **Important Changes**
  - Established development guidelines (TypeScript strictness, React conventions, state management kinds, API consumption via typed client, forms, validation, error handling, naming, imports, reusability, dependency rules, environment configuration incl. `VITE_` public vars and secret handling).

### Project 06 — Backend Engineering (Baseline v1.0)

**Evidence:** `docs/architecture/BACKEND-ARCHITECTURE.md` (`Version: Project 06 — Backend Engineering (Baseline v1.0)`).

- **Architecture Changes**
  - Established the backend implementation model: module architecture mirroring FG-*, controllers, services/use cases, repositories, validation (Zod), authentication §8, authorization §9, error handling §10, structured logging with redaction §11, transactions/isolation §12, background jobs (clearing worker, lease-based single-writer) §13, explicit **no-caching** decision §14, observability §15, API implementation rules §16, security-by-design §17, and the approval register §21 (incl. CSRF mechanism).

### Database SSOT — DATABASE-DESIGN.md

**Evidence:** `docs/database/DATABASE-DESIGN.md`. **Note:** this document carries **no in-file version/project header**; its placement is inferred from its precedence chain ({FRONTEND-ARCHITECTURE, BACKEND-ARCHITECTURE, DATABASE-DESIGN} tier). Exact project/date: **Unknown**.

- **Architecture Changes**
  - Established the database design: environment strategy (Local / Test-CI / Staging-UAT / Production, §4.2), entity model E-01..E-33, table/column definitions with sensitive-data classification (§8.3), keys, indexes, constraints incl. **DB-enforced invariants BI-001..BI-010** (§12.6), uniqueness rules, immutable audit strategy (§15), migration strategy (§18, additive-by-default, migration role), seed strategy (§19, no real PII/secrets), backup & recovery intent (§21), security architecture with least-privilege DB roles (§4.5/§22), and open decisions **DA-01..DA-22** (§24).

### Project 08 — Mobile Engineering (Baseline v1.0)

**Evidence:** `docs/architecture/MOBILE-ARCHITECTURE.md` (`Version: Project 08 — Mobile Engineering (Baseline v1.0)`).

- **Architecture Changes**
  - Established the mobile context: **Part A** documents the CONFIRMED web-first mobile experience; **Part B** documents the **conditional React Native plan that is NOT approved** (ARCH-DEC-006 native status; `REQUIRES APPROVAL`).

### Project 09 — API & Integration Engineering

**Evidence:** `docs/architecture/INTEGRATION-SPECIFICATION.md` (`Version: Project 09 — API & Integration Engineering (Baseline v1.0)`); `docs/architecture/API-SPECIFICATION.md` (`Version: Project 09 — API & Integration Engineering (Audited Baseline v1.1)`).

- **Feature Changes**
  - Added **proposed** endpoints §6.16 (#84–#89) closing evidence-backed gaps (withdrawal detail, `/me/media`, qualification-questions, referral-code introspect, audit-log browse, reopen-request) — all `PROPOSED`, require approval.
- **Architecture Changes**
  - Established the integration specification: external integrations (email, geolocation, push, object storage, CTO signing, payout record-only), consumer-first rule, failure behavior, audit vs logs, integration testing (§13).
- **Important Changes**
  - **API-SPECIFICATION audited v1.0 → v1.1:** corrected endpoint authorization annotations (#4/#5/#6 → AUTH; #31 → +FIN; #56 → MEM own-scoped; #74 note corrected; #78 → PUBLIC); clarified `SYS` as an internal service identity (not a DB role); documented the security-by-design table (§8) and the unified error envelope (§3).
- **Breaking Changes**
  - Contract-level corrections only (v1.0 → v1.1 audit). **No runtime breakage** — nothing is implemented or deployed. Future contract breaks must follow `/api/v2` versioning (API-SPECIFICATION §5.1).

### Project 10 — Testing & Quality Engineering (Baseline v1.0)

**Evidence:** `docs/testing/TESTING.md` (`Version: Project 10 — Testing & Quality Engineering (Baseline v1.0)`).

- **Feature Changes**
  - Established the testing strategy: risk-based testing (R-04 financial integrity, R-05 authorization, R-07 atomicity), testing pyramid, test levels (unit/integration/API/e2e/UI/authz/security), environments (§14), coverage expectations (§16), quality gates (§17), Definition of Done (§18), and approvals **RA-01..RA-10** (§20).

### Security SSOT — SECURITY.md

**Evidence:** `docs/security/SECURITY.md`. **Note:** this document carries **no in-file version/project header**; the security baseline it defines is the current authoritative security SSOT. Exact project/date: **Unknown**.

- **Architecture Changes**
  - Established the security baseline: security principles (§1), authentication/authorization/RBAC, input validation, output encoding, secrets management, data protection, encryption, session security, API security, rate limiting, audit logging, file-upload security, dependency security, OWASP mapping, threat model, security testing, incident considerations, and approvals **SA-01..SA-13** (§20).

### Project 12 — Engineering Quality (Baseline v1.0)

**Evidence:** `docs/development/CODE-REVIEW-GUIDELINES.md` (`Version: Project 12 — Engineering Quality (Baseline v1.0)`).

- **Important Changes**
  - Established the authoritative code-review standard: review principles, review checklist (architecture/requirements/business-rule/security/performance/maintainability/test/error/code-smell/dependency/breaking-change checks), severity model (CRITICAL/HIGH/MEDIUM/LOW/INFORMATIONAL), and approval outcomes (Approved / Approved with minor issues / Changes required / Blocked).

### Project 13 — Deployment & Operations Engineering (Baseline v1.0)

**Evidence:** `docs/deployment/DEPLOYMENT.md` (`Version: Project 13 — Deployment & Operations Engineering (Baseline v1.0)`).

- **Important Changes**
  - Established the deployment & operations baseline: environment strategy (Local / Test-CI / Staging-UAT / Production), CI/CD responsibilities and gates, build and deployment flows, environment configuration, secrets management, hosting/infrastructure (provider OPEN), monitoring/observability, logging, health checks, rollback, backup/DR (RPO/RTO TBD), scaling, incident procedures, operational security, and gaps **D-01..D-24** (§20).
- **Migration Notes**
  - No deployment exists; no migrations or releases have run. All infrastructure decisions remain `REQUIRES APPROVAL`.

### Documentation Governance — Architectural Decision Records (ADR)

- **Architecture Changes**
  - Added the ADR register under `docs/decisions/` (ADR-001..ADR-012) recording the major architectural decisions with rationale, trade-offs, and consequences (see `docs/decisions/README.md`). Decisions are sourced from the ARCH-DEC-* register and other SSOTs; Accepted ADRs reflect CONFIRMED decisions, Proposed ADRs reflect PROPOSED/REQUIRES APPROVAL items. No new decision is made — the ADRs document decisions already present in the SSOTs.

---

## [Implementation Phases] — Future

> Implementation has **not started** (repository is documentation-only). Entries below the documentation baseline will be recorded here per ROADMAP phase/release. The following structure is reserved; do not backfill entries without repository evidence.

### Unreleased / Not started

- **Phase P1 — Foundation & Platform Core** (FEAT-001..006) — **Not started** (ROADMAP §2.1).
- **Phase P2 — Members & Qualification** (FEAT-007..013) — **Not started**.
- **Phase P3 — Referral & Sponsor** (FEAT-019..023) — **Not started**.
- **Phase P4 — Customers & Catalog** (FEAT-024..026) — **Not started**.
- **Phase P5 — Commission** (FEAT-033..040) — **Not started**.
- **Phase P6 — eWallet & Ledger** (FEAT-042/043/071) — **Not started**.
- **Phase P7 — Payout & Withdrawal** (FEAT-044..051) — **Not started**.
- **Phase P8 — Vouchers & QR** (FEAT-052..059) — **Not started** (gated on CTO signing service).
- **Phase P9 — Marketing & Notifications** (FEAT-060..063) — **Not started**.
- **Phase P10 — Reporting & Genealogy** (FEAT-064..067) — **Not started**.
- **Phase P11 — Abroad Program & Geolocation** (FEAT-014..018, 068/069) — **Not started** (gated on OD-001..005, OD-014/015).
- **Phase P12 — Group Incentive** (FEAT-041) — **Not started** (gated on OD-006..012).

---

## Unknown History

The following **cannot be verified** from repository evidence and are recorded as unknown rather than invented:

- **Project 02 and Project 07** — no document in the repository carries a `Version:` header for these project numbers; their scope and content are **Unknown**.
- **Exact dates** for every documentation project — no git history, commit history, or in-file dates exist. All dates are **Unknown**.
- **Pre-baseline history** — any project activity before the earliest in-file version headers (Project 01) is **Unknown**.
- **SECURITY.md and DATABASE-DESIGN.md project numbers** — these files carry no version header; their project assignment is inferred from content/precedence and is **not** verifiable from headers.

---

## Validation

- Every entry above is traceable to an in-file `Version:` header or to a document that exists in the repository; no entry is fabricated.
- No future/planned functionality is presented as completed; all implementation phases are marked **Not started**.
- No secrets, credentials, or sensitive values are included.
- Category labels match the changelog guide; the structure is extendable by appending per-phase sections with repository evidence.