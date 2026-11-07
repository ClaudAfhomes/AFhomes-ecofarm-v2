# AF Homes: Supabase solutions — Phase 5 (Log Ingestion control)

Updated: 2026-10-14 (Asia/Singapore). Status: implementation plan — **not yet implemented**. This document turns the log-ingestion rules in `docs/supabase/SUPABASE-FREE.md` into concrete, AI-executable work. `docs/supabase/SUPABASE-FREE.md` remains the single reference for quota and accounting; `docs/supabase/solutions/EGRESS-SOLUTIONS.md` is Phase 1 (egress); `docs/supabase/solutions/DATABASE-SOLUTIONS.md` is Phase 2 (database size); `docs/supabase/solutions/MAU-SOLUTIONS.md` is Phase 3 (MAU); `docs/supabase/solutions/STORAGE-SOLUTIONS.md` is Phase 4 (storage + public URL media). Repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Do not create parallel capacity documents — Phase 5 (ingestion) lives here, Phase 6 (log query) lives in `docs/supabase/solutions/LOG-QUERY-SOLUTIONS.md`; update these files as phases ship.

> **Instruction to the implementing AI:** execute the tasks below in order of the priority section. Tasks 1–6 are measurement and hygiene with no platform change; Tasks 7–10 are Postgres log-setting proposals that require explicit approval and a trend-check after each change — never apply them silently. For every task: run the full command set in "Verification" before claiming completion, and report evidence (command output or Dashboard observations described in text), not intentions.

## Phase 5 goal

Keep log ingestion far from the Free-plan **1 GB per billing cycle** without losing the visibility needed for incidents, slow-query diagnosis or security review. The measured lever is **bytes of platform log data ingested across Postgres, API gateway, Auth, Storage, Realtime and Edge Functions per cycle**. The rule from Supabase itself: *reduce the volume of a log type rather than turning it off completely.*

Read this first: `docs/supabase/SUPABASE-FREE.md` — budget table (logs ingestion vs logs query are separate meters), grace-period note, growth policy. Everything below builds on rules already stated there; it does not replace them.

## What log ingestion is (context the AI must assume, verified 2026-10-14)

* Ingestion = **total volume of log data Supabase ingests across all project services** (Postgres, API gateway, Auth, Storage, Realtime, Edge Functions, others) during the billing cycle, charged **per byte** (bytes ÷ 1,000,000,000 × $0.50 on paid plans). [Manage Logs Ingest usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs-ingest).
* Quotas: Free **1 GB included** (overage not billed — notification + grace period under the Fair Use Policy); Pro/Team/Enterprise **20 GB included**, overage **$0.50/GB**. A **grace period runs through the start of 2027** before billing begins — budget for the allowance now, but do not claim future degraded-state rules are currently enforced.
* Meter resets **each billing cycle** and is **org-wide** (usage page shows all projects by default, with per-project filter). The Dashboard is authoritative.
* Log volume scales with application traffic and behavior. After any setting change, wait **a day or two** and judge the **trend over several days**, not a single day — volume is uneven day-to-day.
* The companion meter is **Logs Query (100 GB included)**: volume *scanned while querying* logs in the Explorer, not another ingestion allowance. Narrow diagnostic queries by time/service/error; never poll broad history.

## Repo baseline (facts, not proposals)

* `audit_events` is **business data in Postgres** — it counts against **database size (Phase 2)**, not log ingestion. Minimal audit payloads still help indirectly (fewer/lighter writes → less WAL and statement volume).
* `console.error`/`console.log` in `api/_handlers/**` (~40 sites, `[api] <module>:` prefix pattern) and the per-request access logs in `api/dev-server.ts:159-180` go to **Vercel Function logs**, not Supabase ingestion. Keep them clean for hygiene, but do not expect the Supabase meter to move because of them. `dev-server.ts` logs are dev-only and must never reach the production function.
* Migrations contain **no `RAISE NOTICE/LOG/WARNING`** in any function — verified 2026-10-14. No per-call function logging exists to remove.
* `DATABASE_URL` uses the transaction pooler (`:6543`) per repo env docs — connection-log pressure is already structurally reduced. Any non-pooler client must be moved to the pooler.
* MAU, egress and log meters were previously unverified per `SUPABASE-FREE.md`; Task 1 closes the ingestion gap with dated numbers.

## Non-negotiable guardrails (do not violate in any task)

1. Reduce a log type's volume — **never disable logging outright**. A security incident or slow query missed because logging was off is worse than the bytes saved.
2. No live Postgres configuration change (Custom Postgres Configuration, CLI) without **explicit approval**; some changes require a **database restart** — batch them and schedule, never apply casually. Never mutate shared config as a side effect of other work.
3. `log_statement = all` or a low/zero `log_min_duration_statement` logs **full statement text including plaintext values such as passwords passed as query parameters**. Before enabling either, confirm queries carry no sensitive data and confirm who can access the logs and how long they are retained.
4. Never log tokens, signed URLs, credentials, ID numbers or complete document payloads — in platform-visible paths, Vercel logs or audit rows alike.
5. No per-request telemetry service, no new monitoring service, no speculative log pipeline solely to fit the Free plan.
6. No weakening of auth, RLS, column grants, onboarding-token semantics or money rules to reduce log volume.
7. No deploy, production config change or restart without explicit approval.

## Solution inventory at a glance

| # | Solution | Tier | Needs config change | Needs approval |
| --- | --- | --- | --- | --- |
| 1 | Measure ingestion + identify dominant entry type | Foundational | No | No |
| 2 | Traffic reduction via Phase 1 (free ingestion savings) | Foundational | No | No |
| 3 | Pooler enforcement for all DB clients | Foundational | No | No |
| 4 | Logs Explorer query discipline (protects Log Query meter) | Foundational | No | No |
| 5 | Application log hygiene (Vercel-side) | Foundational | No | No |
| 6 | Minimal audit payloads (indirect benefit) | Foundational | No | No |
| 7 | `log_statement` + `log_min_duration_statement` review | Advanced | Yes | Yes |
| 8 | Connection/maintenance/message settings review | Advanced | Yes | Yes |
| 9 | pgAudit review (if enabled) | Advanced | Yes | Yes |
| 10 | Post-change trend check (1–2 days, multi-day trend) | Advanced | No | No |

---

## Phase 5 checklist

### Task 1 — Measure ingestion and identify the dominant entry type [Foundational, no change]

- [ ] Record Dashboard org Logs Ingest usage (all-projects default view), then the per-project filtered value, plus cycle dates.
- [ ] Open the Logs Explorer and determine **which entry kind dominates volume** (query text, connections, auth, storage, edge) before proposing any setting change.
- [ ] Record the finding with dates in the final report. Re-check monthly and after any Task 7–9 change.

### Task 2 — Traffic reduction via Phase 1 [Foundational, no change]

- [ ] Confirm Phase 1 levers are in effect (narrow projections, 25-row pages, batched lookups, SQL aggregates, conservative polling, cancellation/deadlines). Every avoided PostgREST/Auth/Storage call is avoided gateway/service log volume.
- [ ] No duplicate work: reference Phase 1 evidence rather than re-implementing.

### Task 3 — Pooler enforcement [Foundational, no change]

- [ ] Verify every database client (API, scripts, jobs) connects through the transaction pooler (`:6543`), not a direct connection.
- [ ] Any direct-connection client found is moved to the pooler with tests — this reduces both connection-log volume and exhaustion risk.

### Task 4 — Logs Explorer discipline [Foundational, no change]

- [ ] Diagnostic queries are always narrowed by time/service/error. No dashboard, screen or job polls broad log history on an interval.
- [ ] This protects the separate 100 GB Log Query meter; record the convention in the operator notes.

### Task 5 — Application log hygiene [Foundational, code-level, no platform change]

- [ ] Keep the existing pattern: `console.error` with module prefix and `error.message` only — no payload dumps, no tokens/URLs/credentials/IDs/full documents.
- [ ] Confirm `api/dev-server.ts` access logs never ship in the production function path.
- [ ] State explicitly in the report: this task improves Vercel-log hygiene and incident readability; it is **not** claimed to move the Supabase ingestion meter.

### Task 6 — Minimal audit payloads [Foundational, Phase 2 work, indirect benefit]

- [ ] No duplicate effort: reference Phase 2 Task 3 evidence (IDs/status/reason only, no OCR/base64 duplication). Note the side benefit (lighter writes → less WAL/statement volume) without claiming it as an ingestion fix.

### Task 7 — `log_statement` + `log_min_duration_statement` review [Advanced; proposal only, approval + trend check required]

- [ ] Propose based on the Task 1 finding: if the team does not read raw query text in the Explorer (relies on Query Performance dashboard/APM/AI assistant instead) and no compliance trail requires it, propose `log_statement = none`; `mod` if only data-change records are needed; keep `all` only with a documented compliance/debug need.
- [ ] Propose raising `log_min_duration_statement` (e.g. milliseconds → 1–2 s) unless actively performance-tuning; lower only during a tuning window, then raise back.
- [ ] Include the sensitive-data check (passwords-as-parameters) and log-access/retention confirmation in the proposal. Implementation only with explicit approval, via Custom Postgres Configuration, batched with Task 8 if a restart is involved.

### Task 8 — Connection/maintenance/message settings review [Advanced; proposal only, approval required]

- [ ] `log_connections` / `log_disconnections`: propose off unless troubleshooting exhaustion/spikes or a security requirement mandates them (pooler already in place per Task 3).
- [ ] `log_autovacuum_min_duration`: propose raising or off unless diagnosing table maintenance; `log_temp_files`: propose off unless tuning sort/join memory; `log_lock_waits`: propose off unless hanging-query symptoms exist with concurrent writers.
- [ ] `log_min_messages`: read the current value; if elevated to a debug level by an old troubleshooting session, propose resetting to the `warning` default.
- [ ] Leave `log_checkpoints`, `log_recovery_conflict_waits`, `log_replication_commands`, `log_startup_progress_interval` alone unless the related feature is in use — low-volume by nature.

### Task 9 — pgAudit review [Advanced; only if enabled]

- [ ] If pgAudit is enabled, check for a broad `pgaudit.log`/`pgaudit.role` configuration — it is verbose independently of `log_statement`. Propose narrowing or disabling only with a documented reason, given the dedicated `audit_events` trail already exists at the application level.

### Task 10 — Post-change trend check [Advanced, no change]

- [ ] After any Task 7–9 change: wait 1–2 days, then compare the ingest trend over several days against the Task 1 baseline. Single-day readings do not count as evidence.
- [ ] If the trend shows no effect, report that plainly — do not stack further changes blindly.

---

## What does NOT help (do not implement these)

- Deleting `audit_events` rows — moves the database-size meter, not ingestion; and required history must never be deleted.
- Trimming Vercel `console.*` output to "lower Supabase ingestion" — different billing systems; hygiene only.
- Disabling logging entirely for a service — destroys incident/slow-query/security visibility; raise thresholds instead.
- Building a self-hosted log pipeline or per-request telemetry to dodge the meter — forbidden by the docs; cost moves, egress grows.
- Changing polling intervals and claiming an ingestion fix — polling is an egress concern; ingestion follows traffic, and Phase 1 already owns that work.
- Enabling `log_statement = all` "for better debugging" without the sensitive-data and access review — logs secrets into a billed, retained surface.

## Priority order (execute in this sequence)

1. **Task 1** — measure + identify dominant entry type (informs everything).
2. **Tasks 2–4** — traffic reduction (Phase 1 reference), pooler enforcement, Explorer discipline.
3. **Tasks 5–6** — application hygiene + audit-payload reference (no platform change).
4. **Tasks 7–9** — log-setting proposals → approval → batched change (restart-aware).
5. **Task 10** — multi-day trend check against baseline before any further action.

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
- Phase 5 is expected to change no SQL and no product code paths: if any SQL changed despite that, additionally run `pnpm test:db:local` and `pnpm test:db:harness`, plus `supabase/security/rls_invariants.sql` (empty = PASS).
- Postgres-setting changes (Tasks 7–9) additionally require: explicit approval record, the exact setting name + old → new value, restart impact stated, and a dated multi-day Dashboard trend (Task 10) — never against production without approval.
- Report raw results. Ingestion claims require dated Dashboard numbers (org-wide and per-project) plus the dominant-entry-type finding; never present estimates as measurements.

## Deliverable format for the AI

For each task: files changed (or "policy/proposal only"), setting names with old → new values where applicable, dated ingestion numbers (Tasks 1, 10), tests added, and any deviation from this plan with the reason. Mark each checklist item checked or explain why it was skipped. Mark unverified items as unverified — never present estimates as measurements.

## Out of scope for this phase

- No live Postgres configuration change, restart, deploy or production mutation without explicit approval.
- No egress work (Phase 1, `docs/supabase/solutions/EGRESS-SOLUTIONS.md`); no database-size work (Phase 2, `docs/supabase/solutions/DATABASE-SOLUTIONS.md`); no MAU work (Phase 3, `docs/supabase/solutions/MAU-SOLUTIONS.md`); no storage work (Phase 4, `docs/supabase/solutions/STORAGE-SOLUTIONS.md`).
- No quota monitor, no new monitoring/telemetry service, no custom log pipeline, no MongoDB work, no database abstraction layer.
- No weakening of auth, RLS, column grants, onboarding-token semantics or money rules.

## Operator monitoring (manual, monthly)

1. Check the Supabase Dashboard org usage page → Logs Ingest section (all projects, then per-project filter). Dashboard is authoritative.
2. Remember: ingestion is **org-wide** and **per-cycle** (resets each billing cycle) — unlike database size and Storage, which never reset. Note the cycle dates.
3. Grace period runs through the start of 2027: budget for the 1 GB allowance now, but do not claim future degraded-state rules are currently enforced.
4. Identify the dominant entry type in the Logs Explorer before proposing any change; re-check the multi-day trend 1–2 days after any approved change.
5. When the meter approaches its budget: first remove the traffic that generates logs (Phase 1 levers), then raise thresholds per Tasks 7–9 with approval — never disable logging outright or build a workaround pipeline.
