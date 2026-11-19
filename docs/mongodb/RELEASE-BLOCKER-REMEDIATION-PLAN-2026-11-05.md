# Release blocker remediation implementation plan

**Goal:** fix the reviewed local release blockers while preserving business rules and deployment integration boundaries.
**Spec:** owner-approved remediation priorities; `PHASE-10-RELEASE-READINESS-2026-11-05.md`.
**Architecture:** improve existing native read paths and trusted proxy handling; authoritative transactional financial decisions and fresh RBAC remain unchanged. Preserve production's client-IP/media options when integrating; do not merge the production branch or overwrite it wholesale.
**Stack:** existing TypeScript, official MongoDB driver, Better Auth, React/Vite and Vitest; no new dependencies.

Constraints: no Atlas writes, credential/account changes, commits/pushes, deployment or service actions. Preserve U8/U11, U10 visibility, issued IDs, local edits and disabled modules. Use only new disposable loopback databases for test writes. No new shared indexes. Do not raise timeouts to hide slow reads.

- [ ] Trusted IP: trace every public-search/auth caller; add failing separate-visitor/spoof/token-binding checks; implement explicit loopback proxy trust with default denial. Files: `sale-team-search.ts`, `sale-team-public-search.ts`, native sale-team/runtime/hosted callers and adjacent specs.
- [ ] Quality gates: reproduce the Admin dropdown fixture failure; supply the required canonical address without weakening holder validation. Remove only the introduced unused parameter. Run adjacent Admin specs and scoped lint.
- [ ] Sales/history: capture page/history command counts and exact payloads in disposable MongoDB; batch referenced customers/products/staff and payment totals while keeping mutation-session behavior unchanged. Files: `sales.mongo.ts`, native sales specs and read-performance regression.
- [ ] Finance: eliminate repeated queue joins/count work and per-row staff reads with equivalent filtering, ordering, orphan handling and pagination. Preserve all verified-money calculations. Files: `queues.mongo.ts`, real-Mongo parity/performance regression.
- [ ] Analytics: reduce avoidable collection reads/work without losing global counts, legacy fallbacks, sale-time attribution or exact money. Files: `analytics.mongo.ts`, `analytics-hybrid.mongo.ts` and parity/performance specs.
- [ ] Resets/timeouts: retain attempted/completed/failed request counts, sanitized error codes/routes/socket state and actual production driver/HTTP settings. Diagnose after query fixes; prove safe handling without blind financial retries.
- [ ] Verification: targeted regressions, API/Admin tests, typechecks, lint, env isolation, hosted build and quiet representative mixed benchmarks. Use synthetic browser QA; report any credential handoff or unavailable actual-Droplet resource proof as BLOCKED/NOT VERIFIED.
- [ ] Final report: each priority FIXED/OPEN/BLOCKED with commands, measurements and limitations. Stop after verification.

Review focus: missing referenced records; recorded/rejected money; unauthorized and masked fields; transfers/retired edges; reconnect/retry behavior when response delivery is uncertain. No stored summary/cache/backfill is assumed approved.
