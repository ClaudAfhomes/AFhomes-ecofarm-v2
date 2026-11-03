# AFHomes MongoDB Completion Implementation Plan

> Execute inline with `superpowers:executing-plans`. No optional agents, commits,
> pushes or deployment. Maintain the task ledger below as work progresses.

**Goal:** Complete the remaining authorized MongoDB workflows, source parity,
migration preparation and verification without changing AFHomes business rules.

**Architecture:** Keep the current React/contracts/API structure and official
MongoDB driver. Port source transactions and immutable provenance explicitly;
never substitute current genealogy for historical attribution. Existing target
data and the bootstrap administrator survive all setup and migration steps.

**Tech Stack:** React/Vite, TanStack Query, TypeScript/Zod, MongoDB, Better Auth.

**Spec:** `docs/mongodb/CONVERSION-PLAN.md`,
`docs/mongodb/ONE-TIME-DATA-MIGRATION-PLAN.md`, and the user's completion request.

## Global constraints

- Workspace `AFhomes-ecofarm-v2`, branch `claud/mongodb-conversion`; preserve dirty work.
- Reports, CMS, Services and Redemption remain disabled; CMS stays last.
- Staff use temporary passwords/forced change, never invitations; VIPs use activation codes/links.
- Preserve administrator identity/password/assignments and immutable business history.
- Tests use disposable loopback databases. No credentials, private exports or file bytes in reports.
- Prepare exact manifests and verified dry runs before requesting target permission/index/data applies.

## Review focus

Saved denials and restrictions; existing owner/email collisions; legacy bcrypt;
historical payment/points evidence; partial/interrupted retries and rollback.

## Task ledger

- [x] **Permission parity implementation.** Define exact grants from later source migrations;
  update new-role setup; add a digest-bound read-only plan/operator apply for
  missing rows. Preserve existing grants/restrictions and test rollback/replay.
  Prepared/tested; 13 missing rows applied after explicit user approval.
  Post-apply read-only plan reports zero missing rows, without changing saved grants.
- [ ] **Imports.** Inspect the certified and legacy RPC paths; port parsing,
  confirmation, source continuation, immutable settlement/membership/points
  evidence, historical reporting and account visibility. Prove native transactions,
  authorization, stale review, idempotency and rollback in real local replicas.
  Native account/list/commission visibility and portal/analytics integration pass;
  certified guided-workbook parsing and native historical continuation review
  now pass 57 focused tests, API typecheck, targeted lint and environment isolation.
  Ruling: enable review evidence only until historical transactions are proven;
  no approval, payment, commission or membership is synthesized by preview.
  Certified transaction implementation now has native HTTP proof for all six
  stages, rollback, concurrency, exact historical values, commission cutover and
  replay-safe membership/points restoration. Full API suite: 3,089 passed.
  Ruling: Atlas writes stay fail-closed until separately approved historical
  schema exists. Read-only plan: three missing collections, six unique indexes;
  digest and scope are in HISTORICAL-IMPORT-TRANSACTION-REPORT.md. No target apply.
  29 October update: the user separately approved that historical schema; all
  three empty collections/six unique indexes were applied and verified. Fresh
  read-only canonical schema and listed integrity checks pass. No business data
  migrated or modified; browser acceptance remains pending.
  Flat Pending CSV/XLSX create and non-member metadata updates now have native
  transaction/HTTP proof, including downloaded CSV-template confirmation. 180
  relevant tests and static checks pass; no Atlas apply or data write. See
  LEGACY-PENDING-IMPORT-REPORT.md. Legacy member UPDATE now has native source-parity
  proof for lifecycle transitions, history preservation, rollback, denied access
  and stale identity/tier checks (184 focused tests). See
  LEGACY-MEMBER-UPDATE-REPORT.md. Flat member CREATE for Active VIP/Suspended/Expired
  now preserves full settlement, dates, identifiers and opening points with native
  rollback/concurrency/replay proof (26 confirmation tests). See
  LEGACY-MEMBER-CREATE-REPORT.md. Non-member financial CREATE now derives native
  state from verified money, correcting the source status mismatch: fully paid
  imports reach the activation queue; partial imports complete normal Finance
  recording/verification before separate activation. See
  LEGACY-FINANCIAL-IMPORT-REPORT.md. Browser acceptance and legacy edge cases
  remain unfinished, so this task stays open.
- [ ] **Migration compatibility.** Implement source/target schema manifests,
  explicit identity/reference mapping, private exports, password compatibility,
  restartable transforms and file checksums. Test owner preservation, round-trip
  reconciliation and interrupted-run retry in a disposable target before apply.
  An unmounted explicit-manifest business mapper now proves owner/reference
  aliases, immutable JSON, exact money, fail-closed conflicts, canonical exports
  and repeated/interrupted planning using synthetic data/native loading. See
  MIGRATION-MAPPING-DRYRUN.md. Ruling: this is mapping preparation only; retain
  the gate until complete schema/domain adapters, credentials, files, receipts
  and real-source reconciliation have independent disposable proof.
- [ ] **Performance.** Measure representative workloads on disposable data;
  optimize scoped queries/projections/aggregation, verify compound index plans,
  validate cache invalidation and add reviewed application collection validators.
  Keep permission reads fresh and preserve frozen commercial values.
  Six read indexes benchmarked against 10,000-row disposable workloads;
  three ready on existing target collections, three deferred until import setup.
  Three target indexes applied after explicit user approval; three import indexes
  initially deferred, then applied during the separately approved five-collection
  import initialization. Read-only canonical setup and core data checks pass;
  validators and recovery remain incomplete. See DATABASE-READINESS-2026-10-28.md.
- [ ] **Recovery.** Implement and verify private database/file backup and restore
  against disposable targets, retaining a manifest and restoring independently
  from the existing target. No destructive restore into afhomes_dev.
  Local rehearsal now captures encrypted BSON/schema/private-file manifests and
  restores onto newly provisioned loopback servers. It verifies type fidelity,
  source-offline restoration, indexes/validators, credentials and file integrity;
  tampered archives/unsupported metadata fail closed. See RECOVERY-REHEARSAL.md.
  Ruling: keep this task open because the rehearsal has an ephemeral key, bounded
  quiescent synthetic data and no durable real-backup/key/maintenance workflow.
- [ ] **Acceptance.** Full available tests/typechecks/lint/build; role-by-role
  browser purchase/Finance/activation/points/lookup/access-denial flows; private
  upload/download; staff first login/recovery; public IST/OST eligibility/privacy.
- [ ] **Target review.** Present the exact tested permission/index/validator and
  migration plans for approval. Record real target outcomes separately from
  disposable verification. No deployment or push.

## Current ruling

The user's “do all that” authorizes completion work across these phases. Existing
repository apply boundaries still require a concrete reviewed target manifest;
do not interpret completion work as permission to overwrite live identities or
financial history. Continue independent local work while an apply is pending.
