# Communications preflight — 2026-10-07

Classification: **READY FOR HUMAN SPEC REVIEW.** BLOCKED for implementation/release pending written-spec approval and baseline failure resolution. No communications feature code or new migration has been written.

This turn was documentation-only: the written spec was reviewed for completeness, one live migration fact and three wording gaps were corrected, both documents were committed and the feature branch was pushed. No code, migration, schema or shared database change.

## Branch and release ancestry (report items 1–4)

- Current branch: `feature/afhomes-communications`.
- Base branch fetched: `origin/claud/develop`.
- Base and HEAD: `ce19f95ddfade2e8eaf3c2ac730289c506b5dc28`.
- `git merge-base --is-ancestor origin/claud/develop HEAD`: exit 0.
- `git merge-base --is-ancestor 790e6a83a62420a2832bd7849c1e5334bc878ad9 HEAD`: exit 0.
- `git merge-base --is-ancestor ce19f95ddfade2e8eaf3c2ac730289c506b5dc28 HEAD`: exit 0.
- Customer/GSD release present: YES; both required recovery commits present, none missing. No integration needed.
- Initial and new-branch working trees were clean. No unrelated branch was modified.

## Baseline (items 5, 43–50)

Locked dependencies installed with `corepack pnpm install --frozen-lockfile`; no package/lockfile edits. Windows temporary ignored `.tmp-bin/pnpm.cmd` forwards to Corepack so Turbo can find pnpm. Commands use `corepack pnpm run <script>` to explicitly execute package scripts.

First attempts hit missing pnpm PATH, then sandbox `spawn EPERM`/`chmod EPERM`. Build/test/disposable DB commands were retried outside the sandbox with approval. These are execution-environment failures, not communications regressions.

| Check | Exit | Result |
| --- | --- | --- |
| typecheck:deploy | 0 | 7/7 Turbo tasks |
| typecheck | 0 | 7/7 Turbo tasks plus Supabase scripts tsc |
| lint | 0 | 0 errors; 18 existing warnings: web 8, admin 10 |
| build | 0 unrestricted | 2/2 tasks, web/admin; existing chunk/plugin timing warnings |
| test | 1 unrestricted | API 81 passed / 3 failed files; 1,766 passed / 3 failed tests (1,769 total). Turbo stopped before complete UI/web/admin summaries |
| test:db:local | 0 unrestricted | 1,543/1,543 checks; 38 migrations applied to disposable loopback database |
| test:db:harness | 0 unrestricted | 13/13 harness checks. Normal run 1,543/1,543; deliberate fault run 1,033 passed / 2 failed out of 1,035 and non-zero exit; cleanup verified |
| check:env | 0 | 462 browser + 158 server source files; isolation PASS |
| git diff --check | 0 | PASS |

Evidence provenance: every count above was produced by those runs on this branch. This turn's diff is documentation-only, so the suite was deliberately NOT re-run — no source file changed, so a re-run could not produce new signal. `git diff --check` WAS re-run this turn (docs only) and passes. The three API failures below remain open.

Completed unit workspace counts from the root run: contracts 152/152 tests across 11 files; config 6/6 across 1 file; shared 24/24 across 2 files.

Standalone baseline suites: admin 561/561 tests across 53 files (exit 0); UI 125 passed / 1 failed out of 126 across 19 files (exit 1, mobile hamburger test timed out at 5s); web 193 passed / 1 failed out of 194 across 14 files (exit 1, homepage login lazy form Email label not found). Isolated one-worker reruns: UI responsive file 8/8 (exit 0), web home-login file 5/5 (exit 0). These isolated passes do not overwrite the failed full-run results.

Full one-worker reconciliation (`corepack pnpm --filter <workspace> exec vitest run --pool=threads --maxWorkers=1`): UI 126/126 tests, 19/19 files, exit 0; web 194/194 tests, 14/14 files, exit 0. No source changes between these runs. Parallel-only UI/web failures remain recorded as test stability concerns.

Combined complete workspace results using the reconciled UI/web runs: 2,829 passed / 3 failed out of 2,832 tests; 181 passed / 3 failed out of 184 files. Root `pnpm test` still failed and was not rerun or claimed green. API owns all three unresolved failures. Contracts/config/shared/admin/UI/web have completed passing results.

Baseline API failures, before implementation:

1. `customer-security.spec.ts`: credential-pattern guard flags two URL fixtures in `api/apply-migrations.spec.ts`. No matching values copied into this report. Test fixtures require review; no allowlist/pattern was weakened.
2. `phase2-migration.spec.ts`: comment-stripping regex fails on CRLF, retaining the word `real` in comment text. A runnable Node probe confirmed current SQL CRLF and the regex behavior. No money-type product change made.
3. `phase4-migration.spec.ts`: lock-order assertion expects literal LF fragments, while SQL uses CRLF. Probe confirmed CRLF fragment matches and LF fragment does not. Real PostgreSQL checks pass. No historical SQL edited.

These failures remain unresolved and cannot be attributed to communications code. No unit-suite PASS or release PASS claimed.

## Design/reference status (items 6–41)

Written spec: `docs/superpowers/specs/2026-10-07-afhomes-communications-design.md`, DRAFT, not approved.

It includes the requested JadRealty comparison (remote develop inspected), proposed entities/API/RPC boundaries, grants/RLS posture, direct/group/genealogy/history/pagination/polling policies, announcements/audiences/permissions, notifications/ownership/unread behavior, all requested role policies, UI flows, and separate import seller-validation migration/test design.

Architecture is proposed, not implemented. Tables/functions/RPCs/new migrations created: NONE. UI/chat/announcement/notification changes: NONE. Seller-validation fix and new import tests: NOT IMPLEMENTED. Customer access unchanged. No final-architecture or approval claim.

Four items are recorded in the spec as **OPEN DECISION** and need a reviewer answer rather than a silent implementation choice: employee/GSD recipient scope; OST initiation direction (upline-only); the group-creation predicate versus the current-group-manager condition; and whether member removal sends a notification. Every other item in the required review checklist is answered in the spec, and the #19 status was corrected to ALREADY APPLIED / immutable historical state.

## Security and UAT (items 42, 61–63)

New communications/import security tests: not yet written or run. Existing DB unit/integration results are baseline evidence only. AUTHENTICATED UAT — PENDING. PHYSICAL CAMERA UAT — PENDING. No browser workflow proof or deployment readiness claimed.

Remaining: approve the written spec; write/review implementation plan including targeted resolution of baseline harness/fixture failures; implement/test; prepare separate commits; push feature and verify Preview. Managed communications UAT requires an approved schema target; shared migration application remains separately gated.

## Shared database and release safety (items 51–60)

Read-only Supabase migration-list and exact SQL query on `ikaevepedpqygdlipsei`:

- #19 / `20261013000001`: ALREADY RECORDED AS APPLIED, contrary to supplied request status. Not touched, applied, renamed, reverted or used as a communications dependency this turn.
- `20261024000001`: absent from recorded history and current local migration directory; not applied wholesale.
- `20261029000001`: recorded as applied. This confirms history only, not live function-body/operational UAT.
- `20261030000001`, `20261031000001`, `20261031000002`: absent from recorded history.
- Shared-production migration applied this turn: NO. Disposable local harness applied local files, including existing #19; no shared target changed.
- Shared-production migration applied in any earlier phase of this branch: NO. Applying communications or import-seller migrations to any shared/production database remains a FUTURE, SEPARATELY APPROVED action.
- Files changed this turn: 2, both documentation. `docs/superpowers/specs/2026-10-07-afhomes-communications-design.md` and `docs/AFHOMES-COMMUNICATIONS-PREFLIGHT.md`.
- Commit: `docs: add AF Homes communications design spec` (SHA recorded in the push report below / git history of this branch).
- Feature branch: `feature/afhomes-communications`; pushed to `origin` with no force push. The remote branch was created by this push (it did not exist before).
- Preview URL/status: none created for this feature; not verified.
- Production deployment: NO.

## Skills/work modes actually used

- Superpowers brainstorming: architectural written-spec approval gate.
- Superpowers systematic-debugging: reproduce baseline text/parallel failures without editing product code or weakening guards.
- Evidence First Engineer: trace current authorization, contracts, imports and remote reference before design.
- Architecture Guardian: retain SPA/contracts/router/auth separation and canonical infrastructure.
- Ponytail full: reuse existing dependencies, permission matrix, audit and idempotency; small release scope.
- Caveman full: concise evidence and limitations; no optional telemetry/runtime configuration.
- Secure Database Engineer and Supabase: read-only history checks, grants/transaction design and protected migration boundaries.
- Security Reviewer (skill, inline; no agent): membership/ownership/IDOR/customer separation review.
- Verification Gate and Superpowers verification-before-completion: fresh exit codes/counts, distinguish baseline from new work/UAT.

Writing-plans/TDD/implementation/finishing-branch skills are deferred until their prerequisites are met. No subagents spawned, plugins reinstalled or remote settings changed.
