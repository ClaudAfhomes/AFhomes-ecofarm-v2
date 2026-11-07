# Release plan and commit allowlist: OST lifecycle reconciled with develop (DRAFT — nothing here is executed)

2026-10-17, Asia/Singapore. Branch `fix/develop-ost-lifecycle`, HEAD
`b64c5130807b0d2605d07a1e1b3f8382d6fedb1f`, all changes uncommitted. This file
is the reviewable artifact for scoped approval: exact commit scope, exact
apply steps, expected output and fail-closed conditions. No commit, push,
apply, deploy or maintenance action has been taken.

## Where things stand

- Live (`ikaevepedpqygdlipsei`) has the eight `20261208000001`-`08` OST
  migrations applied on 2026-10-17 from the older checkout. That checkout's
  `MIGRATION-APPLICATIONS.md` records exactly those versions and 84 -> 92
  history entries; live was not independently queried in this work.
- This tree carries the reconciled implementation: fresh-install files for the
  same eight versions, plus one new version,
  `20261208000009_afhomes_develop_transfer_integration.sql`, which is the only
  file live still needs. Applied bodies stay immutable; every correction for
  the already-applied database is delivered forward in 09.
- The three reproduced blockers (transfer workflow vs. applied guards,
  narrowed `mutation_requests_operation_check`, lineage/rollout
  compatibility) are resolved. The full local battery is green; see
  [the applied-eight review](2026-10-17-release-blockers-after-live-apply.md).
- Nothing is committed, pushed, applied or deployed from this tree. The older
  checkout remains untouched user work with its unpushed commits.

## The nine migrations

| Version | Purpose | Live status |
|---|---|---|
| `20261208000001_afhomes_ost_sponsor_contexts.sql` | Sponsor contexts, referral-code broadening (hierarchy sellers + admins) | applied from older checkout |
| `20261208000002_afhomes_ost_expired_genealogy.sql` | Expired-genealogy transfer guards | applied; guard corrections re-delivered in 09 |
| `20261208000003_afhomes_ost_annual_history.sql` | Annual validity + renewal history guards | applied; standard fix re-delivered in 09 |
| `20261208000004_afhomes_ost_ist_conversion.sql` | IST -> OST conversion plumbing | applied; shape reconciled by 09 |
| `20261208000005_afhomes_ost_install_aa_guard.sql` | AA-number install guard | applied |
| `20261208000006_afhomes_ost_applicant_changes.sql` | Applicant-change workflow | applied; operation-check union restated by 09 |
| `20261208000007_afhomes_ost_role_workflow_guard.sql` | OST role workflow guard (conversion ledger required) | applied; guard corrections re-delivered in 09 |
| `20261208000008_afhomes_ost_legacy_atomic_install.sql` | Legacy atomic direct install | applied |
| `20261208000009_afhomes_develop_transfer_integration.sql` | **The only pending version** — see below | pending this approval |

File hashes (SHA-256, first 16 hex) of the files this plan would commit:

```text
20261208000001  A82122FF1CCDA3CD    20261208000006  3041696422A366C6
20261208000002  CA5CCBFB880FCDCC    20261208000007  B3D147D1C9D5E457
20261208000003  A7FBBA4C1793638C    20261208000008  E5BEA37D1656A3B7
20261208000004  4E03A52E40091759    20261208000009  C867F8EC3E2DC477
20261208000005  43172827FF8AD803
```

### What 09 does

1. `mutation_requests_operation_check` becomes the **union** of the thirteen
   live operations and `sale_team.transfer` (drop + add, idempotent; the old
   draft's narrowed five-operation list is gone).
2. Corrected guard re-deliveries, because live recorded the originals and
   skips them: `private.ost_kind_transfer_authorized`,
   `private.assert_ost_genealogy_transfer`, `private.guard_ost_role_workflow`,
   `private.guard_ost_renewal_history` (this one also allows `renewal_number`
   renames on terminal rows — without it the sanctioned legacy-ID conversion
   `20261027000001` aborts on the first renewal), plus
   `private.sync_ost_renewal_accreditation` and
   `public.install_direct_ost_accreditation`.
3. Shape reconciliation for the already-applied database:
   `private.ost_ist_conversions.from_upline_staff_id` becomes nullable and
   `public.ost_members_origin_required` is rewritten. Both statements are
   no-ops on a fresh database.
4. The **12-argument** `public.transfer_sale_team_member` (new
   `p_request_id` at position 5, deliberately without a default so PostgREST
   named calls stay unambiguous) plus the **11-argument transitional
   wrapper** for callers deployed before it. The wrapper derives the request
   id deterministically from the normalized payload, so old-code retries
   replay instead of double-writing. Both forms are `service_role`-only.

## Compatibility matrix (all rows proven, not assumed)

| Deployed code | SQL state | Result |
|---|---|---|
| current (11-arg call) | current live | production state today |
| current (11-arg call) | plus 09 | **works** — wrapper path; probe `WRAPPER`/`REPLAY`/`ROLLBACK` checks. 09 may be applied under traffic before any deploy |
| new (12-arg call) | plus 09 | suite + gate + probe green |
| new (12-arg call) | without 09 | **refused — never deploy before 09**; the RPC would not resolve |
| rolled-back code | plus 09 | **works** — code-only rollback is always available; the old handler ignores the RPC result payload |

## Verification battery (all local; disposable loopback PostgreSQL)

- Fresh full DB suite (all nine migrations on an empty database):
  **2635/2635, exit 0** (`.tmp-bin/release-review/dbsuite-run.txt`, and run 1
  of `.tmp-bin/release-review/harness-run2.txt`).
- Suite harness (runs the suite twice; second run arms the deliberate
  fault): **13/13 harness checks**. Run 1 = 2635/2635; run 2 exits non-zero
  reporting exactly the injected fault, the abort is reported as a failed
  check, and `finally` cleanup still restores every table
  (`.tmp-bin/release-review/harness-run2.txt`).
- Fresh-lifecycle gate (transfer/collision/rollback/expiry/RLS):
  **136 checks passed** (`.tmp-bin/release-review/gate-run.txt`).
- Upgrade probe on a live-like baseline (develop schema + the applied eight
  bodies + 09): `APPLIED / WRAPPER / REPLAY / EXPIRY GATE / REVERSE /
  NULL UPLINE / CONSTRAINT / ACL / ROLLBACK` all pass
  (`.tmp-bin/release-review/probe-run.txt`, script `postfix-compatibility.mjs`;
  the original blocker reproduction is `applied-eight-compatibility.mjs`).
- `npx pnpm typecheck` (turbo 7/7 + `tsc -p supabase`) and `npx pnpm test`
  (7/7 workspaces): `.tmp-bin/release-review/final-typecheck.txt` /
  `final-tests.txt`.

## Findings recorded for the record

- **42725 "could not choose a best candidate function"** can hit raw,
  untyped positional `$n` test calls now that two `transfer_sale_team_member`
  overloads exist. PostgREST named-argument calls are safe by design; test
  call sites were given explicit casts.
- **42P13 drives the wrapper's shape**: an SQL-language body validates at
  CREATE (so the wrapper is created after the 12-arg function) and defaults
  must be trailing (so `p_request_id` sits at position 5 and has no default;
  a defaulted 12th parameter would make 11-key named calls ambiguous).
- **The AA allocator consumes test literals**: a reverse transfer draws a
  fresh number from `private.next_sale_team_aa_number`, so fixtures must not
  reuse consumed values (`AAI26100100` was consumed; the probe roots at
  `AAI26100150`).
- **Re-registration ceiling (pre-existing, not our regression)**: develop's
  own `ost_applications_email_status_key` unique(email, status) makes a
  second approved application for the same email impossible; a re-register
  attempt surfaces a raw 23505. Present on develop before this work; recorded
  here, not silently changed.
- **Cross-migration defect found by execution**: 03's renewal-history guard
  froze `renewal_number`, which blocks `20261027000001`'s legacy-ID
  conversion for every unconverted renewal. Fixed forward in 09 (item 2
  above); section 55 of the suite proves conversion now succeeds.
- **Harness second-run cleanup gap (test-side only)**: converted literal
  customer fixtures left `private.business_id_aliases` rows behind; a second
  suite run on the same database then tripped the conversion's fail-loud
  `LEGACY_ID_ALIAS_MISSING` fuse. Cleanup now deletes those aliases; harness
  run 2 is down to exactly the injected fault. No production code involved.
- **`packages/db-testing/scripts/test-sale-team.mjs`** carries a stale
  non-annual renewal fixture. The script is not wired into any
  `package.json` script (referenced only from `docs/supabase/SUPABASE-FREE.md`)
  and was deliberately left untouched.
- **`MIGRATION_SEEDED_GRANTS`** gained the 04-seeded
  `network.ost_registrations` `senior_sales_manager` grant; section 38 derives
  its counts from that constant, never hardcoded.

## Commit allowlist (proposed — selective, no wildcards)

Group A: implementation, contracts, UI, tests. Group B: the nine migrations.
Group C: continuity docs (optional — recommended, since they document the
release; drop this group if session notes should stay untracked).

```powershell
$files = @(
  # Group A - API, contracts, UI, tests
  'api/_handlers/address.spec.ts',
  'api/_handlers/address.ts',
  'api/_handlers/admin/afhomes.spec.ts',
  'api/_handlers/admin/afhomes.ts',
  'api/_handlers/members.spec.ts',
  'api/_handlers/members.ts',
  'api/_handlers/ost.spec.ts',
  'api/_handlers/ost.ts',
  'api/_handlers/ost-accreditation.spec.ts',
  'api/_handlers/ost-accreditation.ts',
  'api/_handlers/referral-contexts.spec.ts',
  'api/_lib/address-provider.ts',
  'api/_lib/ost-address.spec.ts',
  'api/_lib/ost-address.ts',
  'api/_lib/ost-direct-create.ts',
  'api/_lib/ost-import.spec.ts',
  'api/_lib/ost-sponsor.spec.ts',
  'api/_lib/ost-sponsor.ts',
  'api/_lib/psgc-cloud-provider.spec.ts',
  'api/_lib/psgc-cloud-provider.ts',
  'api/_lib/testing/supabase-fake.ts',
  'apps/admin/src/features/address/useOstAddress.ts',
  'apps/admin/src/features/network-members/CreateOstDialog.spec.tsx',
  'apps/admin/src/features/network-members/CreateOstDialog.tsx',
  'apps/admin/src/features/network-members/TransferMemberDialog.tsx',
  'apps/admin/src/features/ost/OstAccreditationPages.tsx',
  'apps/admin/src/features/ost/OstApplicantUpdate.tsx',
  'apps/admin/src/features/ost/ost.spec.tsx',
  'apps/admin/src/features/ost/services.ts',
  'apps/web/src/features/ost/OstRegisterPage.tsx',
  'apps/web/src/features/ost/OstRenewalPage.tsx',
  'apps/web/src/features/ost/ost-register.spec.tsx',
  'apps/web/src/features/ost/useOstAddress.ts',
  'packages/contracts/src/schemas/member.spec.ts',
  'packages/contracts/src/schemas/member.ts',
  'packages/contracts/src/schemas/ost-accreditation.spec.ts',
  'packages/contracts/src/schemas/ost-accreditation.ts',
  'packages/contracts/src/schemas/role-baseline.ts',
  'packages/db-testing/scripts/test-ost-lifecycle.mjs',
  'packages/ui/src/components/OstAddressFields.spec.tsx',
  'packages/ui/src/components/OstAddressFields.tsx',
  'packages/ui/src/components/OstOfficialFields.spec.tsx',
  'packages/ui/src/components/OstOfficialFields.tsx',
  'packages/ui/src/index.ts',
  'docs/supabase/CURRENT-SCHEMA.sql',
  'supabase/db-integration.ts',
  'supabase/ost-accreditation-integration.ts',
  # Group B - migrations (new files)
  'supabase/migrations/20261208000001_afhomes_ost_sponsor_contexts.sql',
  'supabase/migrations/20261208000002_afhomes_ost_expired_genealogy.sql',
  'supabase/migrations/20261208000003_afhomes_ost_annual_history.sql',
  'supabase/migrations/20261208000004_afhomes_ost_ist_conversion.sql',
  'supabase/migrations/20261208000005_afhomes_ost_install_aa_guard.sql',
  'supabase/migrations/20261208000006_afhomes_ost_applicant_changes.sql',
  'supabase/migrations/20261208000007_afhomes_ost_role_workflow_guard.sql',
  'supabase/migrations/20261208000008_afhomes_ost_legacy_atomic_install.sql',
  'supabase/migrations/20261208000009_afhomes_develop_transfer_integration.sql',
  # Group C - continuity docs (optional)
  'docs/handoffs/2026-10-17-ost-implementation-request.md',
  'docs/handoffs/2026-10-17-develop-ost-integration.md',
  'docs/handoffs/2026-10-17-release-blockers-after-live-apply.md',
  'docs/handoffs/2026-10-17-release-plan-and-allowlist.md',
  'docs/handoffs/CONTINUE-SESSION.md'
)
git add -- $files
git status --short   # recheck the cached scope matches this list, nothing more
```

Excluded on purpose: `.tmp-bin/**` (ignored local evidence), every `.env*`,
credentials, generated output, and anything outside this list. No `git add .`
or `-A` in any variant of this plan.

Proposed commit message (Conventional Commits, matching repo history):

```text
feat(ost): adapt OST lifecycle to develop with forward migration 09

- reconcile the nine 20261208 migrations with develop's sale-team,
  IST/OST creation and Members transfer flows
- keep the deployed eleven-argument transfer RPC working via a
  transitional wrapper while the new twelve-argument request-ID form
  takes over (deterministic replay for old-code retries)
- add PSGC address capture for OST registration and applicant updates,
  official fields, expired-genealogy and annual-history guards,
  legacy-ID conversion compatibility, and the operation-check union
- proof: db suite 2635/2635, lifecycle gate 136 checks, harness 13/13,
  live-like upgrade probe green, typecheck + unit suites green
```

## Release sequence (each step needs its own approval)

1. **Commit** exactly the allowlist (recheck `git status --short`, scan the
   staged diff for secrets, confirm the index was empty beforehand). A
   commit is still local until pushed.
2. **Push** to `develop` (or open a PR — decide at approval time). Vercel
   builds previews; promotion is separate.
3. **Apply SQL** — from this tree:
   `npx pnpm db:migrate -- --check` (connection-free preflight), then
   `npx pnpm db:migrate -- --approve-production --only=20261208000009`.
   The runner refuses anything but `ikaevepedpqygdlipsei`, prints what it will
   apply and what it skips, and applies each migration in its own transaction
   with its history row. Expected: exactly `20261208000009` applied; the eight
   reported already applied; and the earlier repo versions live has never
   recorded (the ten tracked in `MIGRATION-APPLICATIONS.md` from 2026-10-16)
   reported as `SKIPPED ... never applied` — skipping is not applying. The
   connection string comes from the operator's existing migration
   configuration and is never printed.
4. **Post-apply read-only verification**: both `transfer_sale_team_member`
   signatures present (11-arg + 12-arg); `mutation_requests_operation_check`
   contains the full union; `ost_ist_conversions.from_upline_staff_id`
   nullable; `ost_members_origin_required` matches the 04 shape; guard
   function bodies match the committed files; both transfer forms
   `service_role`-only; `supabase/security/rls_invariants.sql` returns zero
   violations.
5. **Deploy/promote** the reviewed commit in Vercel (only after steps 3-4
   pass; new code must never run against SQL without 09).
6. **Bookkeeping** (separate, small docs commit after the apply): add a new
   dated section to `docs/supabase/MIGRATION-APPLICATIONS.md` recording the
   eight (as observed in the older checkout log and re-verified read-only)
   and `20261208000009`, with the observed live history before/after and the
   verification results — same shape as the existing 2026-10-16 entry.

## Approvals requested (fresh and scoped)

- **A. Commit** exactly as listed above (trim Group C first if wanted).
- **B. Live apply** of `20261208000009` only, from this tree, with the
  guarded runner commands in step 3 and the read-only checks in step 4.
- **C. Deploy/promote** the reviewed commit (or defer until after B).

Nothing else is requested here. ADR 0001's business questions remain open,
no seed/bootstrap/UAT mutations are proposed, and no other version or
unrelated history is touched.
