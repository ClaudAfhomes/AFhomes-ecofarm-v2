# Continue: safely release the OST work adapted to develop

> CURRENT STATE / RELEASE PREPARED, AWAITING SCOPED APPROVALS: Read
> [the release plan and commit allowlist](2026-10-17-release-plan-and-allowlist.md)
> before acting on anything below. Live has the eight `20261208000001`-`08`
> OST migrations applied from the older checkout; their bodies are frozen.
> This tree carries the reconciled implementation plus the single pending
> migration `20261208000009_afhomes_develop_transfer_integration.sql`. All
> three reproduced blockers are resolved locally and the full battery is
> green (suite 2635/2635, harness 13/13, lifecycle gate 136 checks, live-like
> upgrade probe green, typecheck and unit suites green). Nothing is
> committed, pushed, applied or deployed from this tree. See
> [the applied-eight review](2026-10-17-release-blockers-after-live-apply.md)
> for the finding record.

Checkpoint: 2026-10-17, Asia/Singapore. The user requested this continuation
and a pause. The release-safety/commit-scope review is now COMPLETED; its
output is the release plan named above. The three approvals it requests
(commit / live apply of 09 / deploy or defer) are the next gate.

## Mission and completion standard

Continue the authorized work until the OST changes can be committed, pushed,
and released live without known regressions to existing functions. Do not stop
at a plan, generated files, a build, or passing mocks. Fix identified local
blockers, prove compatibility, prepare exact release actions, and carry out the
approved actions through post-release verification. Never promise zero risk or
claim "live and working" without evidence. If approval or a business decision
is required, complete independent preparation before asking for it.

The goal is a safe live release; this checkpoint is NOT itself approval to
commit, push, merge, create a PR, apply shared-database SQL, invite real accounts,
change Vercel/Supabase settings, deploy, or promote production. The latest
authorized task was release-safety review and an exact commit-scope proposal.
Local investigation, necessary integration fixes, and disposable testing are
authorized by the preceding implementation request. Preserve these boundaries.

## Work in this checkout only

- Directory: `C:/Users/SSD-CLAUD/Documents/AFhomes-develop-ost-integration`
- Branch: `fix/develop-ost-lifecycle`
- Verified HEAD: `b64c5130807b0d2605d07a1e1b3f8382d6fedb1f`
- Last inspected remote `develop`: that same SHA. Refresh before relying on it.
- Implementation remains unstaged/uncommitted. The index was empty at checkpoint.
- The old `AFhomes-claud-develop-vscode` checkout is dirty user work: preserve it.
  Do not overwrite this newer tree with its older files or work in it by mistake.
- No task commit, push, PR, deployment, remote apply or live Auth action occurred.
- No disposable PostgreSQL or UI-fixture listener remained on ports 55432/18475.
- Five-hour usage/quota remaining: UNKNOWN. No automatic percentage trigger exists.

Read the current repository `AGENTS.md` and applicable KOS router, then:

1. [Original user implementation request](2026-10-17-ost-implementation-request.md).
2. [Develop integration handoff](2026-10-17-develop-ost-integration.md), which
   contains the detailed changes, test results, caveats and useful commands.
3. The release plan and the applied-eight review (linked at the top). Verify
   current code/state before edits.

## What must be preserved

The earlier session initially extended an older local `claud/develop` base.
Inspection then established that the user's Ready Vercel Preview
`afhomes-ecofarm-v2-49ed4th6c-afhomes.vercel.app` was built from `develop` at
`b64c513`. The implementation was adapted to that newer base in this worktree.

Keep develop's separate Create IST/Create OST screens, complete/pending OST
creation, bidirectional Members transfer route, retired-number history and lookup.
Keep existing working business flows and user changes. Do not restore a parallel
conversion UI/API from the older checkout. No dependency manifests/lockfiles
were changed; node_modules was materialized offline with a frozen lockfile and
scripts disabled. Temporary fixtures stay under ignored `.tmp-bin/`.

Required OST rules: transform `AAI` to `AAO` preserving the numeric suffix;
reject collisions and unsafe downlines; retain identity and history; renewal
continues the same account/AAO; management selects start, expiry is one calendar
year later (Feb 29 clamps), and no overlap with the prior inclusive expiry.
OST team changes require expired accreditation and approved review, rechecked
atomically before activating renewal. Keep manual active-SM sponsorship and
public VD/SSM/SM referral support. Never invent missing hierarchy or policy.

Generic staff/profile edits cannot bypass OST workflows. Auth invitations
remain external to SQL; never delete an invited identity on provisioning failure.
The existing IST creation path still uses separate writes/compensation; do not
claim all IST/OST creation is atomic. Retiring legacy flat approval remains an
unresolved business decision, not a cleanup task to perform unilaterally.

## Release-safety and commit-scope review (COMPLETED 2026-10-17)

This review now has its output: the release plan and commit allowlist linked
at the top of this file. It covered every modified/untracked file, the
contracts/UI/handlers/SQL/ACLs and the failure paths; reproduced the three
blockers; resolved them forward in migration 09; and produced the exact
allowlist, commit message and release sequence. No reviewer agents were
invoked; do not spawn optional agents unless the user or applicable
instructions explicitly request it. What the completed review covered:

1. Verify branch, HEAD, remote develop, index and every modified/untracked file.
   If develop advanced, review and integrate those changes safely before release.
2. Review the actual contracts, UI callers, handlers, SQL/ACLs, tests and failure
   paths. Report evidence with paths/lines, severity and concrete remediation.
3. Build an explicit candidate-file allowlist and exact proposed selective
   `git add` command/commit message. Exclude `.tmp-bin/`, credentials, env files,
   generated artifacts and unrelated changes. Never use `git add .` or `-A`.
   Recheck file contents and cached scope immediately before any approved commit.
4. Resolve local blockers with focused regression proof. Keep docs/schema index
   synchronized with migration-file changes. Never execute CURRENT-SCHEMA.sql.

### Compatibility concerns identified during the review (each is now resolved and proven — see the release plan)

- Migration 09 drops the deployed 11-argument transfer RPC and introduces a
  request-ID argument. The new UI/API require stable request IDs. Old code with
  new SQL can fail for a missing request ID; new code with old SQL can fail RPC
  resolution. Source inspection established the contract mismatch; no staged
  rollout/upgrade compatibility test was executed in the interrupted review.
- Migration 02 and migration 07 reference `private.ost_kind_transfer_authorized`,
  defined in migration 09. Examine writes during a per-file migration batch,
  failure halfway through, and rollback behavior. A fresh all-migrations test
  does not prove those intermediate states are safe for live traffic.
- Do not assume "deploy code, then apply SQL" or its reverse is safe. Prefer
  a backward-compatible transition with tests, or prepare a precisely scoped
  maintenance/cutover plan for human approval. Old application rollback against
  new SQL must be tested or explicitly unavailable, never guessed.
- Test upgrades from the pinned develop schema with representative pre-existing
  active/expired accounts, pending renewals, prior transfers, immutable history
  and realistic data. Fresh disposable proof alone is insufficient. Verify that
  invalid pending work can be reviewed/rejected without corrupting history.
- Live project identity, the migration history through `20261208000008` and the
  relevant live function definitions were pinned read-only on 2026-10-17
  (`.tmp-bin/release-review/live-baseline.txt`, `live-defs/`). Data
  preconditions, backup/recovery readiness, deployed env scope and
  authenticated UAT remain UNVERIFIED. Do not run a generic migration command
  that might apply unrelated history gaps.

## Nine new draft migrations: review exact scope, not a wildcard apply

Under `supabase/migrations/`:

```text
20261208000001_afhomes_ost_sponsor_contexts.sql
20261208000002_afhomes_ost_expired_genealogy.sql
20261208000003_afhomes_ost_annual_history.sql
20261208000004_afhomes_ost_ist_conversion.sql
20261208000005_afhomes_ost_install_aa_guard.sql
20261208000006_afhomes_ost_applicant_changes.sql
20261208000007_afhomes_ost_role_workflow_guard.sql
20261208000008_afhomes_ost_legacy_atomic_install.sql
20261208000009_afhomes_develop_transfer_integration.sql
```

Eight of the nine (`20261208000001`-`08`) are confirmed applied live from the
older checkout on 2026-10-17 (user report; that checkout's
`MIGRATION-APPLICATIONS.md` records the eight versions and 84 -> 92 history
entries). Their bodies are frozen; corrections are forward-only. The ninth,
`20261208000009_afhomes_develop_transfer_integration.sql`, is the only
version live still needs. Existing develop migration bodies were preserved.
The schema reference already indexes the nine and must stay in sync. Exact
filenames, hashes, prerequisites, target/history checks, apply order,
failure/rollback strategy and verification are recorded in the release plan;
any scope change requires a freshly reviewable plan.

## Previous verification evidence; not rerun merely to create this checkpoint

- API: 123 files, 2,425 tests passed; final Members handler check: 53 passed.
- Contracts: 312 passed. Targeted admin: 60 plus two new creation tests passed.
- Shared OST controls: four passed. Public registration: seven passed.
- Disposable PostgreSQL gate: 128 checks passed, including collision/late-failure
  rollback, concurrent transfer replay/conflict, expired reverse transfer,
  management-only direct creation, renewal validity and six RLS audit queries.
- Workspace and Supabase script typechecks passed. Both app builds passed,
  with existing large-chunk warnings. Relevant Prettier and diff checks passed.
- Scoped lint has four inherited errors and one warning; it is NOT green.
- Chrome exercised the newer creation component using synthetic address/sponsor
  responses: cascade, read-only ZIP, sponsor source, leap-year expiry; no console
  errors. No account submission/Auth/database in that UI fixture. This is NOT
  deployed end-to-end UAT. Earlier local UI/SQL fixture results also were bounded.

Run checks appropriate to new changes; use the handoff's commands. Do not label
prior results as freshly rerun, or repeat broad suites without a change/failure
that justifies them. Use disposable loopback PostgreSQL for local SQL proof.

## Reconciliation verification (2026-10-17, fresh for this workstream)

- Disposable PostgreSQL full suite over all nine migrations: **2635/2635
  passed, exit 0**.
- Suite harness (suite run twice, second run with the deliberate fault):
  **13/13 harness checks**; run 2 exits non-zero reporting exactly the
  injected fault, and `finally` cleanup still restores every table.
- Fresh-lifecycle gate: **136 checks passed**. Live-like upgrade probe
  (develop schema + the applied eight bodies + 09): **all scenario checks
  passed** — applied, 11-arg wrapper, replay, expiry gate, reverse transfer,
  null upline, constraint union, ACLs, rollback.
- `pnpm typecheck` (turbo 7/7 + `tsc -p supabase`) and `pnpm test` (7/7
  workspaces): green.
- Evidence (ignored, local): `.tmp-bin/release-review/` —
  `dbsuite-run.txt`, `harness-run2.txt`, `gate-run.txt`, `probe-run.txt`,
  `final-typecheck.txt`, `final-tests.txt`, `live-baseline.txt`,
  `draft-vs-applied.diff.txt`.

## Continue through release, with scoped approvals

The reviewed files, commit message, exact push/merge target and what Vercel
will do are presented in
[the release plan and commit allowlist](2026-10-17-release-plan-and-allowlist.md);
the three approvals requested there (commit, live apply of `20261208000009`,
deploy/promote or defer) are the current gate. Obtain explicit approval before
staging/commit/push/merge/PR. Never force-push or include the old checkout's work.
Preserve develop's latest changes; do not assume its branch is production.

Separately obtain approval for exact shared-database changes and any maintenance
window, test data/Auth actions, deployment or production promotion. Verify the
existing single Supabase project and exact Vercel project/environment; no new
project, secret export, credential/config changes or speculative remote writes.
Vercel MCP previously returned 403 for this team; existing scoped CLI read-only
inspection worked. Do not install tools or reauthenticate just to repeat it.

After approved actions, verify commit/remote ancestry, actual deployment SHA,
build/runtime logs and authorized authenticated workflows: IST/OST creation,
conversion, renewal with/without transfer, role/expiry denial paths, retained
AA numbers, reload persistence, and adjacent customer/sales/payment/points,
genealogy and permissions behavior. Use controlled approved test records and
preserve operational history. Investigate regressions and stop unsafe rollout.
Do not call a Ready deployment proof of working business behavior.

Completion means the approved intended environment is live at the reviewed
commit, exact migrations are verified, end-to-end/adjacent checks pass, and
remaining risks are explicitly reported. If blocked, record the exact blocker,
evidence, safe next action and required human decision; do not invent success.
At a checkpoint or usage boundary, update this file with current SHA/status,
changed scope, completed proof, unverified items and the next exact task.
