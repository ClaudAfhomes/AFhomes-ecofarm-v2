# AF Homes: Supabase solutions — Phase 6 (Log Query control)

Updated: 2026-10-14 (Asia/Singapore). Status: implementation plan — **not yet implemented**. This document turns the log-query rules in `docs/supabase/SUPABASE-FREE.md` into concrete, AI-executable work. `docs/supabase/SUPABASE-FREE.md` remains the single reference for quota and accounting; `docs/supabase/solutions/EGRESS-SOLUTIONS.md` is Phase 1 (egress); `docs/supabase/solutions/DATABASE-SOLUTIONS.md` is Phase 2 (database size); `docs/supabase/solutions/MAU-SOLUTIONS.md` is Phase 3 (MAU); `docs/supabase/solutions/STORAGE-SOLUTIONS.md` is Phase 4 (storage + public URL media); `docs/supabase/solutions/LOG-SOLUTIONS.md` is Phase 5 (log ingestion). Repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Do not create parallel capacity documents — update this file as phases ship.

> **Instruction to the implementing AI:** execute the tasks below in order of the priority section. Phase 6 is habits, review gates and one runbook — no platform change and no product code change is expected. Never combine two tasks in one commit when a task touches authorization or contracts. For every task: run the full command set in "Verification" before claiming completion, and report evidence (command output or Dashboard observations described in text), not intentions.

## Phase 6 goal

Keep log-query scanning far from the Free-plan **100 GB allowance** while preserving full incident-debugging capability. The measured lever is **volume scanned per question × number of questions** — time range first, in-query filters second, repetition third. No code path in the repo consumes this meter today; the work is keeping it that way plus operator habits and guardrails.

Read this first: `docs/supabase/SUPABASE-FREE.md` — budget table (logs ingestion vs logs query are separate meters), grace-period note. Everything below builds on rules already stated there; it does not replace them.

## What log query is (context the AI must assume, verified 2026-10-14)

* Log Query is **not billed directly and has no per-GB price**. The organization gets a query allowance scaled to ingest at a fixed ratio: **query allowance = 100 × log ingest usage for the same month**. Free (1 GB ingest) → **100 GB query allowance**; paid (20 GB ingest) → 2,000 GB, growing 100 GB per billed ingest GB. It never appears as an invoice line item. [Manage Logs Query usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query).
* What counts: **volume scanned when reading logs** through the Studio UI, Management API, CLI or any interface. Rows viewed do not matter — the data scanned inside the time range does.
* The allowance and degraded-state consequences are **not enforced yet** — grace period through the start of 2027. Budget for the allowance now, but do not claim enforcement is current.
* Exceeding in a month degrades the **next** month: queries rate-limited to **10/min** and retention shrinks to **24 hours (paid) / 1 hour (Free)**. Exceeding again while degraded cuts off logs access in API and Studio for the month after. Access returns to normal at the next billing cycle.
* The real Free-plan risk is not money — it is **1-hour retention during the exact month an incident needs evidence**.
* After changing query habits, judge the **trend over several days**, not a single day — usage follows debugging volume.

## Repo baseline (facts, not proposals)

* **Zero code paths consume this meter** — verified 2026-10-14 by grepping `api/` for platform-log access (`logs.`, explorer, `pg_log`, Management API log endpoints): the single match is a code comment (`api/_lib/address-provider.ts:30`), not a query. No handler, service, job or cron reads Supabase platform logs.
* Business questions are answered by **business data** (`audit_events` via API/reports — database/egress meters, cheap and scoped), never by the Logs Explorer. The Explorer is reserved for infra questions (gateway 500s, Auth timeouts).
* Ingest/MAU/log meters were previously unverified per `SUPABASE-FREE.md`; Task 1 closes the query gap with dated numbers.

## Non-negotiable guardrails (do not violate in any task)

1. No script, cron, CI job or dashboard polls a log-query endpoint on a schedule. Every scheduled re-scan re-scans; this is the single most expensive pattern and it is forbidden.
2. No new handler/service/job calls Management API log endpoints or queries log tables. Business metrics come from API/reports, never from platform logs.
3. No self-hosted log scraper or per-request telemetry solely to fit the Free plan.
4. Never trade away debugging visibility to save scans — narrow the scan, not the question. A missed root cause costs more than the bytes.
5. No weakening of auth, RLS, column grants, onboarding-token semantics or money rules.
6. No live platform change, deploy or production mutation without explicit approval (none is expected in this phase).

## Solution inventory at a glance

| # | Solution | Tier | Needs platform change | Needs approval |
| --- | --- | --- | --- | --- |
| 1 | Measure query usage + note the 100× ingest relation | Foundational | No | No |
| 2 | Smallest-window-first habit | Foundational | No | No |
| 3 | Filter-inside-the-query habit | Foundational | No | No |
| 4 | No-polling rule (Explorer is ad-hoc only) | Foundational | No | No |
| 5 | Business-questions-via-API rule | Foundational | No | No |
| 6 | Code-stays-zero review gate | Foundational | No | No |
| 7 | Incident-debug runbook with bounded windows | Advanced | No | No |
| 8 | Log Drains for genuine continuous needs | Advanced | Yes (setup) | Yes |
| 9 | Ingest-ratio awareness (no false savings) | Advanced | No | No |
| 10 | Degraded-state readiness | Advanced | No | No |

---

## Phase 6 checklist

### Task 1 — Measure query usage [Foundational, no change]

- [ ] Record Dashboard org Logs Query usage (all-projects default view), then the per-project filtered value, plus cycle dates and the same-month ingest number (allowance = 100× ingest).
- [ ] Record the finding with dates in the final report. Re-check monthly and after any debugging-heavy incident.

### Task 2 — Smallest-window-first [Foundational, no change]

- [ ] Debugging starts with the smallest window that could contain the answer (minutes/hours, not "last 30 days"); widen step by step only on miss. A 1-day window scans ~7× less than a 7-day window.
- [ ] Wide windows are reserved for deliberate historical/trend analysis — a real but inherently expensive use case. Record the convention.

### Task 3 — Filter inside the query [Foundational, no change]

- [ ] Source, service, status code and project filters go in **before** running. A broad unfiltered scan counts everything in range even if only a fraction is viewed; filtering afterwards does not reduce what was scanned.

### Task 4 — No-polling rule [Foundational, no change]

- [ ] No cron, job, CI step, screen or script queries log endpoints on a schedule. The Explorer is for ad-hoc human digging only — repeated identical questions re-scan with zero caching benefit.
- [ ] Review existing crons/jobs once for accidental log polling; record the negative finding.

### Task 5 — Business questions via API [Foundational, no change]

- [ ] "How many sales yesterday?", "who approved X?" and similar go to `audit_events`/reports endpoints — scoped, cheap, correct meters. The Explorer answers infra questions only.
- [ ] No new "observability dashboard" that auto-queries logs (see Task 6).

### Task 6 — Code-stays-zero review gate [Foundational, no change]

- [ ] Every PR touching log endpoints, Management API clients or new scheduled jobs is rejected if it introduces platform-log reads. Record the gate in the team's review checklist.
- [ ] Re-grep `api/` for platform-log access patterns as evidence; the expected result remains the single pre-existing comment.

### Task 7 — Incident-debug runbook [Advanced, no change]

- [ ] Write the procedure: (a) smallest window, (b) filters before run, (c) widen stepwise on miss, (d) log which queries were run. Its purpose is preventing panic-driven "query the whole month" during incidents — exactly when the allowance is easiest to burn.

### Task 8 — Log Drains for continuous needs [Advanced; setup needs approval]

- [ ] Only if a genuine ongoing feed exists (own monitoring stack, alerting, archiving): propose a Log Drain, which streams logs on arrival instead of re-scanning per check. Repeated "what's new since last check" polling is one of the most expensive patterns and must not be built instead.
- [ ] No drain is built speculatively; default state is no drain.

### Task 9 — Ingest-ratio awareness [Advanced, no change]

- [ ] Document plainly: lowering ingest (Phase 5) also lowers the query allowance at the same 100× ratio — it is **not** a way to bank query budget. The lever is scan-per-question, never ingest. No ingest change is proposed for query reasons.

### Task 10 — Degraded-state readiness [Advanced, no change]

- [ ] Document the chain: exceed → next month 10 queries/min + 1-hour (Free) retention → second consecutive exceed → full month cutoff → normal at next cycle.
- [ ] Rule: if degraded, export incident evidence immediately to approved archival (not via more wide queries, which worsen the position). Avoid a second consecutive exceed at all costs.

---

## What does NOT help (do not implement these)

- Reducing application traffic to "save query allowance" — traffic is an ingest/egress concern, and the allowance shrinks with ingest anyway.
- Deleting logs to "reclaim query budget" — allowance is not storage; nothing is reclaimed.
- A self-built poller scraping the Management API for "monitoring" — the most expensive pattern; a drain is the correct answer, or nothing.
- Reading `audit_events` in the Explorer "as if they were logs" — business data belongs in API/reports.
- Any auto-querying "observability dashboard" over platform logs — forbidden by Tasks 4 and 6 alike.
- Disabling logging to reduce future scans — destroys the visibility the scans exist for; narrow scans instead.

## Priority order (execute in this sequence)

1. **Task 1** — measure + record the 100× relation (informs everything).
2. **Tasks 2–3** — the two highest-impact habits: smallest window, in-query filters.
3. **Tasks 4–5** — no-polling rule + business-via-API rule, written down not just said.
4. **Task 6** — code-stays-zero review gate with re-grep evidence.
5. **Task 7** — incident runbook with bounded windows.
6. **Task 8** — drains only for proven continuous needs, with approval.
7. **Tasks 9–10** — ratio awareness + degraded-state readiness notes.
8. Checkpoints 70/85/95 like the other meters; nearing budget = tighten habits, never build a workaround.

## Verification (run all, in this order)

```sh
corepack pnpm exec turbo run test --force --concurrency=2 -- --maxWorkers=2
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm check:env
git diff --check
```

- New/changed specs: `corepack pnpm --filter api exec vitest run <path> --maxWorkers=2` (same per workspace).
- Phase 6 is expected to change no product code and no SQL: if any SQL changed despite that, additionally run `pnpm test:db:local` and `pnpm test:db:harness`, plus `supabase/security/rls_invariants.sql` (empty = PASS).
- Evidence for Task 6: the re-grep output showing no platform-log access. Evidence for Task 1: dated Dashboard numbers (org-wide and per-project) plus same-month ingest.
- Report raw results. Query claims require dated Dashboard numbers; never present estimates as measurements.

## Deliverable format for the AI

For each task: files changed (or "habit/gate/runbook only"), dated query numbers (Tasks 1) where applicable, tests or grep evidence added, and any deviation from this plan with the reason. Mark each checklist item checked or explain why it was skipped. Mark unverified items as unverified — never present estimates as measurements.

## Out of scope for this phase

- No platform change, no drain setup without explicit approval, no deploy, no production mutation.
- No egress work (Phase 1, `docs/supabase/solutions/EGRESS-SOLUTIONS.md`); no database-size work (Phase 2, `docs/supabase/solutions/DATABASE-SOLUTIONS.md`); no MAU work (Phase 3, `docs/supabase/solutions/MAU-SOLUTIONS.md`); no storage work (Phase 4, `docs/supabase/solutions/STORAGE-SOLUTIONS.md`); no ingestion-setting work (Phase 5, `docs/supabase/solutions/LOG-SOLUTIONS.md`).
- No quota monitor, no new monitoring/telemetry service, no log scraper, no MongoDB work, no database abstraction layer.
- No weakening of auth, RLS, column grants, onboarding-token semantics or money rules.

## Operator monitoring (manual, monthly)

1. Check the Supabase Dashboard org usage page → Logs Query section (all projects, then per-project filter), alongside same-month ingest. Dashboard is authoritative.
2. Remember: allowance = **100 × same-month ingest**, org-wide, per-cycle — unlike database size and Storage, which never reset. Note the cycle dates. Enforcement is in grace period through the start of 2027.
3. Advisory levels: **70%** investigate querying habits, **85%** obtain a capacity decision, **95%** urgent.
4. After any debugging-heavy incident, review what was scanned (windows + filters used) against the runbook before the next cycle.
5. When the meter approaches its budget: tighten windows/filters, kill any polling, route business questions back to API/reports — never build a workaround poller or disable logging.
