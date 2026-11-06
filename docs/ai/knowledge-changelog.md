# Knowledge changelog

Significant, approved knowledge changes only. Newest first. No secrets, customer data or logs.

## 2026-11-05 — Approved relationship indexes installed
- D21 / U12: the two reviewed relationship read indexes were approved, applied to `afhomes_dev` and verified; 184 to 186 indexes, 69 collections unchanged.
- Four relationship documents and all existing index definitions were unchanged. Both hinted lookups use IXSCAN; all 19 reviewed plan entries are present.
- Added `RELATIONSHIP-INDEX-APPLY-2026-11-05.md`. No account/data changes, deployment, restart, commit or push; live traversal activation and other Phase 10 blockers remain unverified/open.

## 2026-11-05 — Deployment status correction and authorized checkpoint
- Owner confirms an existing DigitalOcean deployment and authorizes commit/push to `claud/mongodb-conversion`.
- Fresh fetch verified production entry point/release tooling on `develop` and `release/v2.0`; old staging branch removed. D20 supersedes the previous undeployed status.
- Running server revision/configuration was not inspected. The production runtime options interface differs from this branch; preserve it during any separately requested integration. No merge, deployment, service action, credential change or database write authorized here.

## 2026-11-05 — Phase 9 (final performance pass, stress testing; local only)
- Test stability: the five Phase 8 timeouts were caused by running the suite alongside benchmarks and
  review agents; the suite passes on a quiet machine with one and two workers (no timeout changed).
- Genealogy indexed traversal behind an index-presence gate (U12); relationship indexes added to the
  guarded plan (not installed). Referral opt-in pagination; leaner paged Member filtering.
- Verification note: the random generator shared by the Phase 6-9 fuzzers cycled after ~1,000 draws;
  all fuzzers were re-run with a 32-bit generator against the original snapshots (0 differences).
- Added `docs/mongodb/PHASE-9-PERFORMANCE-STRESS-2026-11-05.md` (results, bottlenecks, GO/NO-GO).
- Updated `RELATIONSHIP-INDEX-PLAN-2026-11-04.md` (final guarded plan), `LIST-PAGINATION-DESIGN-2026-11-04.md`;
  decision register U12, U13. No Atlas write, deployment, credential change or git operation.

## 2026-11-04 — Phase 8 (security, session indexes, pagination)
- U8 resolved locally; decision D18 (auth session indexes applied to Atlas `afhomes_dev`).
- Added `docs/mongodb/RELATIONSHIP-INDEX-PLAN-2026-11-04.md` (proposal only); session index record appended to
  `ATLAS-INDEX-APPLY-2026-11-04.md`; Members opt-in pagination recorded in the pagination design.

## 2026-11-04 — Security remediation checkpoint
- Added `docs/mongodb/SECURITY-REMEDIATION-2026-11-04.md`; decision register U8 (referral visibility defect),
  U9 (credential rotation pending), U10 (ost-contacts upline policy).
- Eight credential-bearing untracked scripts quarantined outside the repository; exact-path `.gitignore` entries.
- `ost-contacts` scoped to the caller genealogy view with regression tests. No Atlas write, rotation or git operation.

## 2026-11-04 — Customer summary risks documented (deferred)
- Added `docs/mongodb/CUSTOMER-SUMMARY-CONSISTENCY-RISKS-2026-11-04.md`: design review only; stored
  per-customer summaries remain unapproved and unimplemented.

## 2026-11-04 — Atlas read-index apply recorded
- Added `docs/mongodb/ATLAS-INDEX-APPLY-2026-11-04.md` and decision D17: nine read indexes in
  `afhomes_dev` (172 → 181), plan fingerprints, query-plan verification, no removals or document
  writes, six development auth sessions, backup status unverified.
- `docs/agents/mongodb-conversion-log.md` left byte-identical (archive of 26 Oct – 3 Nov).

## 2026-11-04 — Owner rulings on U1–U7
- Decision register: added D12 (customer ID format), D13 (not deployed; historical deployment info
  non-authoritative), D14 (VIP tiers B1/S1/G1), D15 (IST→OST date, OST annual renewal, IST no renewal,
  immutable expiry history, form + hierarchy approvals).
- U2, U3, U4 resolved; U7 closed as legacy. Still open: U1 implementation (generator review),
  U5 MongoDB implementation verification, U6 identifier policy.
- Documentation only. No code, schema or generator change. Skills and `docs/AFHOMES-BUSINESS-RULES.md`
  not updated (some skill "unverified" notes now predate D14/D15).

## 2026-11-04 — AI knowledge optimization (owner-approved)
- `AGENTS.md` shortened from 1,244 to 205 lines for the MongoDB branch: current owner decisions,
  approval boundaries, "past approvals are not standing authorization", not-deployed status,
  invariants, A–H authorization tests, conventions, environment, version control.
- Original text archived verbatim (CRLF, byte-identical; SHA-256 `9df3435b…c9fa` reproduced) in
  `docs/agents/mongodb-conversion-log.md` (lines 1–444), `docs/agents/supabase-legacy-reference.md`
  (445–1205, reference only) and `docs/agents/knowledge-vault.md` (1206–1244). Not auto-imported.
- `CLAUDE.md` now imports `AGENTS.md` once (first line) and keeps navigation only.
- Skills `afhomes-orientation` and `afhomes-token-efficiency` point to `docs/agents/`; Graphify
  staleness warning and an approval-gated refresh procedure added.
- `docs/ai` references updated to archive paths; U3 resolved; U1, U2, U4–U7 remain open.
- Restored `graphify-out/cache/last_query_stamp` to HEAD (query timestamp only). No code, data or git
  history changed.

## 2026-11-04 — Claude Code knowledge & skills initialization
- Added root `CLAUDE.md` (map; defers to `AGENTS.md`), six `.claude/rules/` files (one global,
  five path-scoped), eleven `.claude/skills/afhomes-*` skills (deployment manual-only), and `docs/ai/`.
- Recorded verified stack: Mongo driver 7.7 (no Mongoose), Better Auth 1.7, React 19/Vite 8,
  feature flags redemption/services/reports/cms = false.
- Recorded conflicts U1–U7 in `decision-register.md` (customer-number format, deployment facts,
  AGENTS.md stack description, VIP tier mapping).
- No application code, schema, environment or git state changed.
