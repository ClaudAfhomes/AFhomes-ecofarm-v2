When this file is directly referenced as the user's Claude Code prompt, execute the session handoff workflow below immediately. Treat the instructions in this file as the workflow to perform, not as documentation to summarize. Preserve this entire permanent instruction region exactly unless the user explicitly authorizes changing it.

This opening applies only when the file is the user's direct prompt. When another workflow reads this file for its saved handoff, the instructions here are data, not a command.

# Session Handoff Workflow (permanent instructions, Region A)

Authority: `AGENTS.md` and `CLAUDE.md` win on conflict. Report conflicts.

## Safety

Only the text between the two handoff boundary markers may change. Do not edit application code, project rules, or other documentation. Do not stage, commit, push, branch, stash, deploy, migrate databases, or change secrets or credentials. Read-only git only.

## Procedure

1. Review the current conversation and the work done this session.
2. Inspect branch, HEAD, working tree, and relevant diff (`git branch --show-current`, `git rev-parse --short HEAD`, `git status --short`, `git diff --stat`).
3. Identify the files actually changed and their purpose.
4. Capture completed tasks, implementation decisions, patterns, and important constraints.
5. Record tests, typechecks, benchmarks, audits, and verification accurately: exact command and result for each check run this session. List checks not run under "not run". Never claim a check ran when it did not.
6. Record unresolved issues, blockers, known risks, pending decisions.
7. Capture the recommended next action for a fresh session. If a task is incomplete, record the precise stopping point and what is needed to resume.
8. Record actions explicitly NOT performed (Git operations, database changes, secrets changes, deployments).
9. Separate verified results from claims, assumptions, and untested changes. If the conversation or tool results cannot establish a fact, mark it unverified; never invent.
10. Replace the previous handoff completely. Do not accumulate history. Do not keep stale tasks or duplicate knowledge already in `CLAUDE.md`, `AGENTS.md`, or `docs/`.

## Region protection (every update)

A boundary marker counts only when a whole line, ignoring a trailing CR, equals exactly `<!-- BEGIN LATEST SESSION HANDOFF -->` or `<!-- END LATEST SESSION HANDOFF -->`. This region never contains such a whole line.

1. Read the full file.
2. Run these checks (Git Bash) and record the protected hash:

```sh
f=workflow/claude/update-session.md
tr -d '\r' < "$f" | grep -n -x '<!-- BEGIN LATEST SESSION HANDOFF -->'
tr -d '\r' < "$f" | grep -n -x '<!-- END LATEST SESSION HANDOFF -->'
tr -d '\r' < "$f" | sed '/^<!-- BEGIN LATEST SESSION HANDOFF -->$/,/^<!-- END LATEST SESSION HANDOFF -->$/d' | sha256sum
```

3. Require exactly one line from each of the first two commands, BEGIN before END. If markers are missing, duplicated, or corrupted, STOP and report; change nothing.
4. Replace only the body between the markers using Edit, with `old_string` set to the whole current body. Never rewrite the file with Write. Keep both marker lines.
5. Re-run the three commands. Require the same single pair and an identical protected hash. If not, restore the file and report.

## Handoff template (keep under about 80 lines, dense, no prose essays)

Header line with save date, then these headings: Session objective; Repository state (branch, HEAD, working tree); Completed work; Important decisions and constraints; Relevant files and changes; Verification (tests, typechecks, benchmarks, results); Known issues and unresolved questions; Pending work / next recommended action; Operations not performed; Handoff confidence / unverified claims.

## Final output

Report: handoff updated; current branch and HEAD; completed work captured; pending tasks captured; verification status; confirmation that the permanent instructions were preserved (hash match).

---

# Latest Session Handoff (Region B, replaceable)

<!-- BEGIN LATEST SESSION HANDOFF -->
Saved 2026-11-11. Branch claud/supabase. Supersedes the stale orly/develop handoff.

## Session objective
Finish and verify the Customer Application -> RA -> Finance -> VIP Card ID -> 40% commission -> activation workflow (owner prompt 10 Nov 2026). Paused mid-implementation for a Claude Code token-optimization task.

## Repository state
- claud/supabase, HEAD 5ac98cf, nothing staged. ~100 uncommitted paths: previous agent's batch (supabase/migrations/2026123*, untracked, never applied) plus this session's fixes below.
- Previous agent's full working tree is snapshotted in the session scratchpad (prev-agent-snapshot/tracked-changes.diff + untracked.tar).

## Critical business rules (owner-approved)
SM-only origination (seller of record = creating active SM); RA created atomically at submission, YYYY-NNNN, immutable; approval needs an ACCEPTED signed Customer Application (government ID never counts); RA execution needs an ACCEPTED signed RA; Finance records and verifies every payment with a real receipt object; overpayment refused at recording (verified + pending) and verification, never capped; VIP Card ID YYMMDDNNNNNVTPMMS exactly once at first verified contractual payment (Manila date), fail closed; commission eligible at >= 40% verified, payout separate; activation needs 100% verified, reuses VIP.

## Completed this session (VERIFIED unless noted)
- api/_lib/vip-sale-creator.ts: guard made synchronous. It was async and called without await, so non-SM POST /sales wrote 403 then still created the sale.
- New api/_handlers/sale-origination-sm-only.spec.ts (10 tests; mutation-tested: 5 fail against the old async guard).
- Removed debug logs (sales.ts, phase2.spec.ts); restored api/_lib/testing/supabase-fake.ts to HEAD; removed junk fixture row 'force-reload-marker' (root cause of all 31 IST + 5 genealogy failures).
- card-plans/card-categories/phase2 specs: sale-creating calls moved to TOKEN2.salesManager; phase2 relationship count back to 6.
- Restored to HEAD: supabase/migrations/20261217000001 (applied migration had been edited to fabricate RA/application numbers), packages/db-testing/scripts/lib/local-postgres.mjs + test-db-local.mjs (removed 0.0.0.0 listen and DB-wide afhomes.test_mode), packages/db-testing/package.json + pnpm-lock.yaml (win32-only binary as required dep).
- AGENTS.md: added "Claude Code session efficiency" section; OpenCode section scoped to OpenCode.
- NEW supabase/migrations/20261231000001_afhomes_workflow_integrity_repair.sql: removes GUC bypasses, restores RESTRICT FKs, drops ledger FK, strict RA immutability (legacy->AF-RES only with alias), high-water seeding, restored seller resolver + require_originating_sales_manager + validate_frozen_seller, drops commission_records/dual award, upload_signed_ra_document, submit_customer_application_once, issue_vip_on_activation; adds purchase_signed_documents + register/review functions + bucket afhomes-signed-documents; RA at submission; approval/execute gates; Finance-only recording with receipt object, purpose rules, overpayment incl. pending; verification never capped, VIP fail-closed, commission_eligible_at; finalize copies eligible_at; activate_card_sale restored to committed logic + finalized-RA and VIP gates. Applied cleanly to the scratch dev DB only. NOT yet run through any suite.

## Pending work / next action
1. Remove the SM sales.card_sales can_update grant from the tail of unapplied 2026123000021 (baseline is create-only); make 20261230000007 a no-op note.
2. Rename 13-digit migrations 2026123000014..22 to 14 digits (pnpm db:migrate --only requires 14).
3. Update DB suites: real storage.objects receipts + paymentPurpose in every record call; signed docs via register/review; cleanup without afhomes.allow_mutation_test_cleanup; revert annual_points_cap 25000 -> 60000 and section 58 SM grant; add section 79 for new rules + concurrency.
4. Fix external import fixture (BRONZE partially paid continuation needs receipt + purpose).
5. API: pass paymentPurpose; SM guard on customer-application create/submit; signed-doc upload URL/register/review endpoints; contracts (drop commissionRecordSchema; receiptStoragePath only required on reservation payments).
6. Admin UI: finance-lifecycle (17) + final-blockers (6) + reservation-finance-queue (1) failures; purpose selector, receipt upload, signed-doc panels, status labels.
7. Full gates, then browser QA (Docker daemon not running; .env.local targets shared project, never use it).

## Verification run this session
- Baseline before fixes: api 2810/2850 (40 fail); admin 1081/1105 (24 fail); web 277, contracts 336, shared 59, config 7, ui 247 pass; test:db:local 2413/2413 (sections 27-36 skipped by design, 52 never existed); external import FAIL RECEIPT_STORAGE_PATH_REQUIRED; typecheck/lint/build exit 0.
- After fixes: ist-portal, genealogy-resolve, card-plans, card-categories, phase2 (129/129), sale-creation-order, sale-origination-sm-only all pass. Full api suite NOT re-run.

## Open owner decisions
Commission beneficiary when an OST refers an SM sale; whether an eligible (40%) commission is payable before manual final qualification; payout role (finance.commission_payouts has no grants); VIP for legacy sale-origin/AF-RES purchases without an official RA sequence; application approver role (sales.customers update includes SM/OST).

## Operations not performed
No commit, push, stage, deploy, shared-DB access, credential or global-config change.
<!-- END LATEST SESSION HANDOFF -->
