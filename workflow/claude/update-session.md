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
Saved 2026-11-05. Migrated from the root `SESSION.md` working copy; no new work verified in this save.

## Session objective
Commission settings (`/admin/commissions/settings`): Round 1 roster-backed rates (API and contracts), Round 2 UI. Committed by the user in `3f995abc`. Also this session: replaced root `SESSION.md` with the `workflow/claude/` session workflows.

## Repository state
- Branch `orly/develop`, HEAD `3f995abc`.
- Working tree at save: `SESSION.md` deleted, the two new workflow files, and reference edits in `CLAUDE.md`, `AGENTS.md`, `workflow/graphidian/{00-guide,01-explore,03-build,05-release}.md`. Nothing staged.

## Completed work
Round 1 (touches API and contracts):
- `packages/contracts/src/schemas/finance.ts`: roster query/member/position/roster schemas, `bulkCommissionRuleSchema` (open-ended, 1-200 unique members), shared `commissionRateSchema` (0-1) on create/update/bulk.
- `api/_lib/commissions.mongo.ts` (Mongo only): `GET /commissions/rules/roster`, `POST /commissions/rules/bulk` (atomic, `sales-write` lock, end-dates earlier personal rule or disables same-day one, audit per rule); rules list returns `targetName`.
- `resolveCommissionRule` in `api/_lib/commission-model.ts`, used by `sales.mongo.ts`, `purchase-terms.mongo.ts` and the roster (behaviour unchanged; Mongo `ost` target type never resolved, hidden in UI).
- Specs: `commission-model.spec.ts`, `commission-roster.mongo.spec.ts`, contracts `commission-roster.spec.ts`, `format.spec.ts` (`percentToRate`).

Round 2 (UI only, `apps/admin/src/features/business/`):
- Tabs via `?tab=` (Sellers default, Position rates, All rules); inactive panels stay mounted and hidden. Components: `CommissionSettingsPage`, `CommissionSellersTab`, `CommissionPositionRates`, `CommissionRulesTab`, `CommissionRuleHistoryDialog`, `CommissionSkeletons`; CSS `CommissionSettingsPage.module.css`.
- Page and tab skeletons, per-action `Button loading`, busy table on refetch.
- `notifySuccess`/`notifyError` for every mutation; `notifyConfirm` only for bulk Set rate and Disable; errors keep the dialog open.

## Important decisions and constraints
- Rates entered as percent (`percentToRate`/`rateToPercent` in `format.ts`).
- Past sales frozen at 0% stay 0%. "Set their rate" selects max 100; bulk max 200.
- Mongo-only endpoints: a Supabase-backed admin gets 404s; parity needs a SQL migration (not authorized).
- Admin login needs a real Turnstile token (`action="login"`); automation cannot sign in. A browser pass needs the user to sign in at `http://localhost:5184/admin/login`.

## Verification (all REPORTED by the previous session, not re-run)
- Admin full suite 1045 pass (112 files); `tsc`, eslint (0 errors), admin build, `pnpm check:env` pass. API typecheck pass; commission/sales/purchase specs pass.
- An earlier overlapping `pnpm test` showed 3 admin failures in `finance-lifecycle.spec.tsx` and `reports-audit.spec.tsx` (load-related; passed alone). An isolated full `pnpm test` ran in background task `bjpfvwiun`; its result was never read: UNVERIFIED.
- Not run: browser pass at desktop/tablet/mobile; `pnpm test:db:harness` (known failures: section 77, also 48 and 58).
- Focused commands:

```sh
pnpm --filter api typecheck
pnpm --filter api exec vitest run _lib/commission-model.spec.ts _lib/commission-roster.mongo.spec.ts _lib/sales.mongo.spec.ts --maxWorkers=1
pnpm --filter @afhomes/admin exec vitest run src/features/business/CommissionSettingsPage.spec.tsx --maxWorkers=1
pnpm --filter @afhomes/admin exec tsc --noEmit
pnpm check:env
```

## Known issues and unresolved questions
- Hidden tabs still fetch Rules data on load.
- Not built: auto-assign on first sale, tiers by sales count (needs a new settings model and a sale-creation change; plan first).

## Pending work / next recommended action
1. Re-run `pnpm test` in isolation to settle the unread `bjpfvwiun` result.
2. Browser pass at three widths (needs the user to sign in).
3. Plan, then build, auto-assign and tiers only if the user wants them.

## Operations not performed
No git stage/commit/push/branch/stash, no database or migration changes, no deploy, no secrets or `.env.local` changes. No tests run while writing this handoff.

## Handoff confidence
Commission-work facts are REPORTED from the old `SESSION.md`; only the HEAD and branch were VERIFIED at save time. Verification results above are not re-checked.
<!-- END LATEST SESSION HANDOFF -->
