# AF Homes: Supabase solutions — Phase 3 (Monthly Active Users control)

Updated: 2026-10-14 (Asia/Singapore). Status: implementation plan — **not yet implemented**. This document turns the MAU rules in `docs/supabase/SUPABASE-FREE.md` into concrete, AI-executable work. `docs/supabase/SUPABASE-FREE.md` remains the single reference for quota and accounting; `docs/supabase/solutions/EGRESS-SOLUTIONS.md` is the Phase 1 plan for egress and bandwidth; `docs/supabase/solutions/DATABASE-SOLUTIONS.md` is the Phase 2 plan for database size; `docs/supabase/solutions/STORAGE-SOLUTIONS.md` is the Phase 4 plan for File Storage + public URL media; `docs/supabase/solutions/LOG-SOLUTIONS.md` is the Phase 5 plan for Log Ingestion control; `docs/supabase/solutions/LOG-QUERY-SOLUTIONS.md` is the Phase 6 plan for Log Query control. Repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Do not create parallel capacity documents — update this file as phases ship.

> **Instruction to the implementing AI:** execute the tasks below in order of the priority section. Phase 3 is mostly policy, measurement and hygiene — no SQL migration is expected. Never combine two tasks in one commit when a task touches authorization or Auth settings. For every task: run the full command set in "Verification" before claiming completion, and report evidence (command output or Dashboard screenshots described in text), not intentions.

## Phase 3 goal

Keep Monthly Active Users far from the Free-plan **50,000 MAU** quota without weakening authentication, onboarding integrity or the staff/customer authorization models. The measured lever is **distinct user IDs that sign in or refresh a token during the billing cycle** — not request volume, not session count, not polling frequency.

Read this first: `docs/supabase/SUPABASE-FREE.md` — budget table and company direction. Everything below builds on rules already stated there; it does not replace them.

## What MAU is (context the AI must assume, verified 2026-10-14)

* MAU = **distinct count of user IDs that sign in or refresh their token during the billing cycle**, including password and social logins. One user signing in 100 times = **1 MAU**. Sign-out does not remove the count for that cycle. [Manage MAU usage](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users).
* The count **resets at the start of each billing cycle** (org billing cycle, e.g. Jan 1–31 in the docs example).
* MAU is **org-wide**: the Dashboard usage page shows all projects by default, with an optional per-project filter. Other projects in the organization share the quota.
* Quotas: Free **50,000**, Pro/Team **100,000**, overage **$0.00325 per MAU** on paid plans. On Free (or with Spend Cap enabled), exceeding quota triggers a **notification to the billing email and a grace period** under the Fair Use Policy — not an automatic charge. [Billing FAQ / Fair Use](https://supabase.com/docs/guides/platform/billing-faq).
* A live session that keeps refreshing its token (kiosk, shared, always-on device, long-lived mobile session) can count its user each cycle even with no visible activity.
* Service-role API traffic has no user and counts no MAU. Deleting inactive `auth.users` rows does not reduce the current cycle count. Shortening JWT expiry does not reduce distinct users — it only shifts refresh volume (an egress concern, not MAU).

## Non-negotiable guardrails (do not violate in any task)

1. Preserve the invite-only / token-gated onboarding model. Staff enter through `staff_invitations` (expiry, revoke); customers activate through single-use expiring onboarding tokens (`claim_customer_onboarding_token`). **No open public signup** as a side effect of any task.
2. Never weaken Auth (email confirmation, token handling, password recovery flow) or authorization (staff permissions re-resolved per request; customer ownership separate) to reduce MAU.
3. Never build a custom auth system to dodge MAU. That is a company architecture decision with security, maintenance and ownership-model costs — not a backend optimization.
4. No CAPTCHA, MFA, Auth-setting or rate-limit change without explicit approval and a controlled Preview validation.
5. Tests and load runs never touch managed Auth. The repo pattern is offline unit suite + in-memory Supabase fake + disposable local PostgreSQL (`pnpm test:db:local`). Keep it that way.
6. No deletion of `auth.users` rows to "reclaim MAU" — it does not work and destroys auditability.
7. Never remove the customer login or gate product features purely to suppress MAU. That is a product/security downgrade, not a capacity fix.

## Solution inventory at a glance

| # | Solution | Tier | Needs migration | Needs approval |
| --- | --- | --- | --- | --- |
| 1 | Measure MAU on the Dashboard (org-wide + per project) | Foundational | No | No |
| 2 | Preserve invite-only / token-gated onboarding, no open signup | Foundational | No | Yes (to change) |
| 3 | Keep CI/QA/load tests off managed Auth | Foundational | No | No |
| 4 | No anonymous sign-ins; public pages stay logged-out | Foundational | No | Yes (to change) |
| 5 | One account per person (recovery, not re-registration) | Foundational | No | No |
| 6 | Bot and abuse controls before any new auth surface | Foundational | No | Yes |
| 7 | Ghost-session hygiene (kiosk sign-out, global sign-out) | Foundational | No | No |
| 8 | Org-level audit for other projects sharing the quota | Advanced | No | No |
| 9 | Keep staff/customer audiences separate and measurable | Advanced | No | No |
| 10 | Capacity checkpoints and plan decision at scale | Advanced | No | Yes |

---

## Phase 3 checklist

### Task 1 — Measure MAU on the Dashboard [Foundational, no migration]

- [ ] Open the organization usage page → Monthly Active Users section. Record the current-cycle MAU with the default "all projects" view.
- [ ] Apply the per-project filter and record the AF Homes project contribution separately.
- [ ] Record the billing-cycle start/end dates — the reset follows the org cycle, not the calendar month necessarily.
- [ ] Note per `docs/supabase/SUPABASE-FREE.md` that MAU meters were previously unverified; this task closes that gap with dated numbers in the final report.
- [ ] Re-check monthly and after any auth-surface change (Tasks 2/4/6).

### Task 2 — Preserve invite-only / token-gated onboarding [Foundational]

- [ ] Confirm staff onboarding still flows through `staff_invitations` with pending/accepted/expired/revoked states — no unauthenticated staff creation path.
- [ ] Confirm customer activation still flows through the hashed, single-use, expiring onboarding token redeemed by `claim_customer_onboarding_token` — the customer sets their own password via the Supabase-hosted flow; no server-known password exists.
- [ ] Any proposal for self-service signup is a **capacity decision** (Task 10), not a feature task. Do not implement it here.

### Task 3 — Keep CI/QA/load tests off managed Auth [Foundational, no migration]

- [ ] Verify no test, seed, load or CI job signs in against the managed project Auth. Unit tests use the in-memory fake; DB tests use the disposable local PostgreSQL.
- [ ] If QA needs live checks, use a small fixed set of QA accounts and disable them afterwards. Never generate distinct accounts per run.
- [ ] `pnpm seed:demo` refuses the production project — confirm that guard stays intact.

### Task 4 — No anonymous sign-ins; public pages stay logged-out [Foundational]

- [ ] Confirm anonymous auth is not enabled for guest browsing. Public/marketing content renders without creating an auth user.
- [ ] If a future "try as guest" flow is proposed, flag it as MAU-bearing (every distinct anonymous user counts) and route it through Task 10.

### Task 5 — One account per person [Foundational, no migration]

- [ ] Support flow for locked-out users is password recovery/reset through the Supabase-hosted flow — not "create a new account".
- [ ] De-duplicate by process, not by deletion: never delete `auth.users` rows to fix duplicates; resolve through support with an audit trail.

### Task 6 — Bot and abuse controls before any new auth surface [Foundational; changes need approval]

- [ ] API-layer rate limiting on auth-adjacent endpoints (login, activation, invite accept) stays in place; any new auth-adjacent endpoint ships with limits from day one.
- [ ] Email confirmation stays enforced for any email-based flow that has it.
- [ ] CAPTCHA on Auth (Supabase Auth settings) and any Auth-setting change is **proposed only** here — implementation needs explicit approval plus Preview validation, and must not mutate shared Auth config as a side effect.
- [ ] The single-use onboarding token is itself an abuse control (no token, no activation) — preserve its expiry and single-use semantics.

### Task 7 — Ghost-session hygiene [Foundational, no migration]

- [ ] Sign out on shared/kiosk/always-on devices when the shift or session ends; do not leave perpetual logged-in sessions refreshing.
- [ ] For lost, stolen or abandoned devices, use global sign-out ("sign out all users" for that account) to kill every session of the affected user.
- [ ] Document the procedure in the operator runbook section of the final report — who runs it, on what trigger, with what audit entry.

### Task 8 — Org-level audit for other projects [Advanced, no migration]

- [ ] Because MAU is org-wide, list every other project in the organization and record each one's MAU contribution from the usage page.
- [ ] If another project dominates the meter, report it as an org-level finding — do not attempt cross-project fixes from this repo.

### Task 9 — Keep staff/customer audiences separate and measurable [Advanced, no migration]

- [ ] Preserve the architectural split: staff authorization (`staff_users` → roles → permissions) and customer ownership (`customers.auth_user_id` → customer → membership) never meet. No shared auth path is introduced.
- [ ] When reporting growth, attribute it to staff vs customer audiences so a future capacity decision (Task 10) has real numbers.

### Task 10 — Capacity checkpoints and plan decision at scale [Advanced; decision needs approval]

- [ ] Adopt the advisory levels: **70%** investigate growth, **85%** obtain a capacity decision, **95%** urgent. No new monitoring service, no quota-monitor job.
- [ ] If the meter approaches quota: the decision is a plan change (Pro raises quota to 100,000; overage $0.00325/MAU) or a product/architecture decision — never silent auth weakening, never a workaround project, never deletion of users.
- [ ] At current AF Homes scale (small staff + token-gated customers), 50,000 MAU is distant. Record that assessment with the Task 1 numbers; this phase is monitoring plus anti-inflation hygiene, not an emergency.

---

## What does NOT help (do not implement these as "optimizations")

- Deleting inactive auth users — they are not counted; zero MAU effect.
- Reducing polling or API call volume — sign-in/refresh events only.
- Shortening JWT/session lifetimes to "save MAU" — same distinct users; breaks sessions for nothing.
- Service-role traffic shaping — no user, no MAU.
- Asking the same person to log in less — still 1 MAU.
- Removing customer login — product and security downgrade; forbidden by the guardrails.

## Priority order (execute in this sequence)

1. **Task 1** — measure (closes the unverified-meter gap).
2. **Tasks 2–5** — preserve onboarding gates, test hygiene, no anonymous auth, one-account process.
3. **Task 6** — abuse controls on every auth surface (propose; implement only with approval).
4. **Task 7** — ghost-session procedure.
5. **Task 8** — org audit for other projects.
6. **Task 9** — audience attribution in reporting.
7. **Task 10** — checkpoints and plan decision if growth ever warrants it.

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
- Phase 3 is expected to change no SQL: if any SQL changed despite that, additionally run `pnpm test:db:local` and `pnpm test:db:harness`, plus `supabase/security/rls_invariants.sql` (empty = PASS).
- Auth-setting or rate-limit changes (Tasks 6–7) additionally require a controlled Preview validation with dated evidence — never against production Auth.
- Report raw results. MAU claims require dated Dashboard numbers (org-wide and per-project); never present estimates as measurements.

## Deliverable format for the AI

For each task: files changed (or "policy only"), behavior delta, tests added, dated MAU numbers (Task 1, Task 8) where applicable, and any deviation from this plan with the reason. Mark each checklist item checked or explain why it was skipped. Mark unverified items as unverified — never present estimates as measurements.

## Out of scope for this phase

- No SQL migration expected; no Storage cleanup; no image compression; no egress work (Phase 1, `docs/supabase/solutions/EGRESS-SOLUTIONS.md`); no database-size work (Phase 2, `docs/supabase/solutions/DATABASE-SOLUTIONS.md`).
- No quota monitor, no new monitoring service, no custom auth system, no MongoDB work, no database abstraction layer.
- No deploy, no production Auth change, no MFA/CAPTCHA enablement without explicit approval.
- No weakening of auth, RLS, column grants, onboarding-token semantics or money rules.

## Operator monitoring (manual, monthly)

1. Check the Supabase Dashboard org usage page → MAU section (all projects, then per-project filter). Dashboard is authoritative.
2. Remember: MAU is **org-wide** and **resets each billing cycle** — unlike database size and Storage, which never reset. Note the cycle dates.
3. Advisory levels: **70%** investigate growth, **85%** obtain a capacity decision, **95%** urgent.
4. Attribute growth to staff vs customer audiences (Task 9) and to projects (Task 8) before proposing any action.
5. When the meter approaches its budget: first remove phantom auth (tests, bots, duplicate-account creation, unnecessary login walls, ghost sessions), then obtain company approval for a plan/product decision. Never silently weaken authentication or delete users.
