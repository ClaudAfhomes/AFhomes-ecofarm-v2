# SESSION.md — Chat Handoff Context

> **Protocol:** This file holds the latest handoff only. When the user says
> `handoff context to @SESSION.md`, REPLACE this entire file with the new
> session's context (do not append; delete stale sections). Keep it dense:
> decisions, patterns, open threads, and verification state. No prose essays.

## Stack (unchanging)

pnpm + Turborepo. `apps/web` (:5173, `/` + `/customer/**` + `/ost/**`) |
`apps/admin` (:5174, `/admin/`) | single Vercel Function `api/router.ts` →
`api/_lib/router.ts` → `api/_handlers/**` → Supabase Postgres + Auth.
`packages/contracts` (Zod SSOT, `schemas/lifecycle.ts` owns all statuses) |
`packages/shared` (BigInt money) | `packages/config` (`VITE_`-only) |
`packages/ui` (tokens + primitives). `docs/security/` deletions in working
tree are PRE-EXISTING user changes (do not touch). Branch: `claud/develop`.
Session work UNCOMMITTED (list below).

## Standing user preferences (apply without asking)

- Single 45-column company membership template only: `GET template/xlsx|csv`
  serves `membership-template.*`. No parallel/duplicate template buttons.
- Exact company header text/order/duplicates preserved verbatim in code.
- Never invent business semantics (no name-splitting, no money/status value
  translation, no hierarchy inference from name columns).
- Prettier: only `--write` files whose HEAD version is clean (verified via
  `git show HEAD:<file>` + `--check`); repo has pre-existing CRLF warnings
  (`sales.ts`, `customers.ts`, CSS modules) — leave untouched.
- New guards proven by failing-first evidence (new specs assert 403/409 +
  zero number calls + no row; transcription bugs caught by `test:db:local`).
- Flakes: app/jsdom timing tests + zip-bomb timeout flake under parallel
  load; solo re-runs green; `--maxWorkers=2` reduces them. Never adjust
  assertions to force a pass.

## This session's work (UNCOMMITTED)

### A. Business-rules documentation program (Phases 1–8, read-only + 2 slices)

- `docs/business-rules/`: INDEX (67 rows: 55 rules + 12 code-observed),
  STATUSES, AGENT-GUIDE, CONFLICTS (CF-01…06, CF-06 resolved-by-hierarchy),
  OPEN_QUESTIONS (Q1–Q12), CHANGELOG, 14× `BR-*.md` (54→55 rules),
  IMPLEMENTATION-GAP-MATRIX, ROADMAP, TEST-PLAN, CONFORMANCE-EVIDENCE
  (all 55 IDs explicit), SOURCE-DECISIONS, DEPENDENCY-GRAPH.
- `docs/system-audit/`: architecture audit, traceability audit, doc plan,
  Phase 1–8 reports, membership plan + implementation report.
- Source: `C:/Users/SSD-ORLANDO/Documents/AF Homes Document/Business Rules.zip`
  (19 entries = 18 files; C3–C7 + D1–D7 absent; C2 mtime 2026-10-11 anomaly;
  no "Master List" exists — Q5 open). Workbook internals read via
  `unzip -p` streams to approved temp (never extracted into repo):
  `QualFormula` + `FreezeSaleRates` bodies, `ParamInfo` 30 cases, Control
  Panel A23–A35 history, Reference R44–R63, 25 A2 sheets enumerated.
- Central finding: Generator payroll model (BA/PA/PB, DSC/DRI, QP/EP,
  Equivalent TCP, Close Month) vs v2 card/points model do not meet — Q1
  presidential ruling blocks Lane 4; Q3/Q2 block W1; Q4/Q5/Q6/Q7 doc gaps.
- Statuses: MATCH 1 (BR-RATE-06), MISMATCH 1 (BR-QLF-02, 25% vs 100% gate),
  PARTIAL 15, NOT_IMPLEMENTED 32, BLOCKED 4, OUT_OF_SCOPE 2, NOT_ASSESSED 2
  (CUT-01/02, matrix lens).
- Slices implemented: S1/BR-RATE-01 ordering (seller before number,
  `sale-creation-order.spec.ts` 4 tests); S2/BR-RATE-06 (scheme validation
  before `next_sale_number`, `sales.ts` reorder); S3/BR-RATE-06 extension
  (duplicate gov-ID/email pre-check before `next_customer_number`,
  `customers.ts` + `customer-creation-order.spec.ts` 3 tests).
- Verified ledger: api 2131–2146, web 245, admin 799 (+flakes, all
  solo-green), shared 41, contracts 226, `test:db:local` 2464/2464,
  `check:env` PASS, tsc clean (api/contracts/admin).

### B. Membership 45-column company template (this session's build)

- Single template: `template/xlsx|csv` serve 45-col `membership-template.*`
  (retired old builders deleted; UI keeps one button pair + note).
- Contracts: `MEMBERSHIP_TEMPLATE_COLUMNS` (verbatim, duplicates kept) +
  `MEMBERSHIP_TEMPLATE_POSITION_MAP` (41 mapped / 4 dropped: FULL NAME ×2,
  AGE ×2) + `COMPANY_IMPORT_EXTRA_COLUMNS` (29 verbatim keys, remap-path
  only; established customer template untouched).
- Import: positional remap (duplicates can't collide) + dropped-header
  warnings naming exact headers; validators reuse established schemas;
  FULL NAME never split (rows fail safe); unknown tier/scheme/status fail
  rows, never corrupt.
- Migration `20261130000001_afhomes_membership_company_fields.sql`: 37
  nullable verbatim columns on customers (personal, 12 supplementary,
  8 related-person, 9 `stated_*` package/payment); both import RPCs persist
  (`company` object; CREATE inserts, UPDATE preserve-when-blank); gender
  CHECK shared; TIN write-only (no browser grant, masked read, never
  audited); no new grants, RLS posture unchanged.
- Manual API: create/update schemas + handler mapping + masked reads
  (`tinNumberMasked`, `supplementaryTinNumberMasked` via `maskGovernmentId`);
  portal profile unchanged (explicit selects exclude new fields).
- UI: CustomerDetailPage 4 exact-label read sections (AGE derived, never
  stored); Import/Export template panel per-format cards (xlsx/csv guidance
  + 45-column meta) on existing tokens.
- Specs: `membership-template` (3), `customer-company-fields` (2),
  `phase33` structural incl. surgery-preservation tripwires (6),
  DetailPage +10th test, ImportExportPage card test. All green.
- Transcription-bug saga (recorded so it isn't repeated): full-body
  `CREATE OR REPLACE` of the import RPCs initially clobbered (a) the
  20261021 widened membership-number regex + guarded setval and (b) used
  nonexistent `p_job_id` in the row-commit audit. `test:db:local` caught
  both (2 failures in sections 46–47); fixed + tripwired; re-run 2464/2464.

## Open threads (need user/stakeholder input)

- Q1 model authority, Q3 gate/product, Q2 cutover scope, Q4 missing 12
  files, Q5 Master List, Q6 C2 authority, Q7 VIP DSC figure (exhaustively
  searched: B8, B2-ParamInfo, Control Panel, guides — absent).
- FULL NAME split rule (bulk name imports fail safe until decided); RA/STATUS
  value sets, RF, price/discount/total semantics, package/terms vocabularies
  stored verbatim uninterpreted; related names carry no hierarchy semantics.
- AF-RES/AF-CSALE/AF-CC issuance audited conformant (random/inline claim);
  no action.
- Next unblocked verification: per-rule DB conformance mapping; next build:
  W1 on Q3+Q2. Lane 4 closed without Q1. Further phases without answers can
  only re-verify.

## Verify (from root)

```sh
pnpm --filter ./api exec vitest run _handlers/membership-template.spec.ts _handlers/customer-company-fields.spec.ts _handlers/phase33-membership-company-fields.spec.ts _handlers/customer-creation-order.spec.ts _handlers/sale-creation-order.spec.ts
pnpm test:db:local   # disposable loopback PG; proves migration + 2464 checks
pnpm --filter ./api exec tsc --noEmit && pnpm --filter ./packages/contracts exec tsc --noEmit && pnpm --filter ./apps/admin exec tsc --noEmit
# Prettier: HEAD-clean files only; sales.ts/customers.ts/CSS warn pre-existing (CRLF), leave alone.
```
