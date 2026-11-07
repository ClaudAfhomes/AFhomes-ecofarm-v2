# Continue: OST changes adapted to current develop

2026-10-17, Asia/Singapore. Local only, unstaged and uncommitted.

Work in `C:/Users/SSD-CLAUD/Documents/AFhomes-develop-ost-integration`, branch
`fix/develop-ost-lifecycle`, based on `develop` commit
`b64c5130807b0d2605d07a1e1b3f8382d6fedb1f`. Read this repository's AGENTS.md
and the [original user request](2026-10-17-ost-implementation-request.md).
The old `AFhomes-claud-develop-vscode` checkout and its user changes are preserved.
Do not resume implementation there or overwrite current develop with that old tree.

## What was reconciled

The earlier work was verified on the older local `claud/develop` working tree.
Fresh read-only inspection confirmed the user's Vercel preview is from current
`develop` at the base commit above. Its newer Members creation/transfer UI was
missing from that local base. This work ports the OST fixes onto the newer base.

- Retains separate Create IST/Create OST screens, direct complete/pending OST
  creation, bidirectional `/members/:id/transfer`, retired AA-number history and
  historical-number lookup. No parallel conversion UI/API was ported.
- Retains develop's IST creation implementation. It still uses separate writes
  and compensation, not the new atomic OST installer. No claim of cross-system
  Auth/Postgres atomicity is made.
- Reuses the existing transfer RPC. IST -> OST preserves the complete AAI suffix
  under AAO, rejects collisions and active downlines, retains identity and old
  number history, and records a one-year OST term. The selected active SM is
  validated; a VD's genuinely absent former head remains null in history.
- Adds stable request IDs and transactional retry/conflict handling for both
  transfer directions. The reverse OST -> IST workflow is preserved with an
  expired-term check, management authorization, history and atomic retirement of
  the OST footprint. Generic profile/staff role edits cannot bypass these paths.
- OST renewal enforces the user-approved policy: management chooses start,
  expiry is one calendar year later (Feb 29 clamps to Feb 28), no overlap with
  the prior inclusive expiry. OST sponsor changes require expired accreditation
  and approval, rechecked inside the same transaction before renewal activation.
- Renewal also refreshes the current accreditation lookup's validity; earlier
  terms and retired-number history remain frozen.
- Newer direct creation/transfer screens use the shared address cascade and
  read-only reference ZIP. Fixed their sponsor-picker bug: the old generic
  "head of SM" query returned SSMs; the dedicated OST sponsor endpoint returns
  the eligible SM list. API/SQL validate independently of the picker.
- Preserves controlled applicant corrections and frozen renewal snapshots,
  public VD/SSM/SM referral support, and the local legacy approval hardening.
  Legacy approval's SQL writes are atomic; Auth identities are never deleted on
  SQL failure. Direct complete-approval replay avoids another invite/signature
  write and revalidates its committed term through SQL.
- Nine NEW draft migrations, `20261208000001` through `00009`. Existing develop
  migration bodies were not edited. Schema reference regenerated: 104 migrations,
  60 public tables. Never execute CURRENT-SCHEMA.sql as a migration.

## Local verification

- Full API suite: 123 files, 2,425 tests passed. The final manual-sponsor check
  was additionally verified by all 53 Members handler tests.
- Contract suite: 21 files, 312 tests passed.
- Targeted admin suites: 60 existing tests passed; two new Create OST tests
  passed for the address cascade, eligible sponsor source and leap-year expiry.
- Shared OST controls: four tests passed. Public OST registration: seven passed.
- Real disposable PostgreSQL lifecycle/transfer gate: 128 checks passed,
  including AA collision rollback, late audit rollback, concurrent transfer
  replay/conflict, expired reverse transfer, direct creation without fabricated
  endorsement, initial-AA authority, renewal/history and six RLS audit queries.
- All workspace typechecks, Supabase script typecheck and both app builds passed.
  Build warnings remain for chunks over 500 kB.
- Scoped lint retains four errors and one warning already present in the base
  files: unused `db`, `_omitted`, `submittedApp`, existing `self = this`, and
  unused no-console suppression. Lint is not green; no unrelated cleanup.
- Chrome checked the actual newer Create OST component with synthetic address/
  sponsor responses: cascade, reference ZIP, disabled expiry, Feb 29 -> Feb 28,
  and no console errors. No form submission, Auth or database was used by that
  UI fixture. It is not deployed or managed-stack UAT.

Useful commands, from this worktree:

```powershell
corepack pnpm --filter api exec vitest run --maxWorkers=2
node packages/db-testing/scripts/test-ost-lifecycle.mjs
corepack pnpm -r --if-present typecheck
corepack pnpm exec tsc --noEmit -p supabase
corepack pnpm -r --if-present build
git diff --check
git status --short
```

Dependencies were materialized offline from the existing store with a frozen
lockfile and scripts disabled. No dependency manifests or lockfiles changed.
Temporary fixtures and baseline comparisons remain under ignored `.tmp-bin/`.

## Boundaries / next step

Review this worktree's diff and nine draft migrations, then plan a separately
authorized release. The transfer RPC now requires request IDs; API/UI and SQL
must be released together rather than assuming old callers remain compatible.
No commit, push, PR, deployment, shared database apply, live Auth invitation,
Vercel configuration or credential change occurred. No release approval is
implied. Managed Auth, real PSGC availability, email delivery and deployed UAT
remain unverified. Retiring the legacy flat approval path remains a business
decision; it was not removed. Usage quota remaining is UNKNOWN.
