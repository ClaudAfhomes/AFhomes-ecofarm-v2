# OST team transfer, distinct from accreditation conversion

Migration 11 was explicitly approved and applied on 2026-10-17 at 21:47 SGT
(13:47 UTC), history 94 -> 95. Only that migration was executed. Scoped commit
and push to `origin/claud/develop` are approved; no production deployment or
promotion is authorized. See the migration application log for live evidence.

## Explicit user requirement

An OST moves from one VD/SSM/SM team to another and remains an OST. The user
confirmed: **Keep expiry + management approval**. A team move does not renew
the accreditation, replace its AA number, create an identity or change roles.
The separated ID type/number fields in the IST conversion form must also be
grouped, using the UI/UX patterns already used for direct creation.

## Result

- OST's Members action is `Transfer team`; IST's is `Convert to OST`.
- OST team dialog selects a different active SM. That SM's existing authoritative
  SSM/VD ancestry determines the new team; no hierarchy roles are invented.
- Current term must be expired and management must explicitly approve with a
  reason. The API retains the Members-update permission gate; SQL reuses the
  existing `ost_reviewer` management permissions and `ost_scope` boundaries for
  both current and destination teams. No new role hierarchy is introduced.
- The original application, term dates, role and accreditation are preserved.
  The former genealogy edge becomes inactive, one new active edge is installed,
  and the old/new sponsors and actor/reason enter immutable approval history.
- Pending renewals block standalone team moves. The shared member-first lock
  serializes approval with renewal and concurrent team-transfer retries.
- The new API is `POST /members/:id/team-transfer`; it calls `transfer_ost_team`,
  never the accreditation-kind conversion RPC.
- Existing explicit kind-conversion API/SQL remain for compatibility. The OST
  Members action no longer presents OST-to-IST conversion as a team transfer.
- OST current-head reads use authoritative genealogy even without an IST profile.
- Conversion ID fields use the grouped design-system form. Region is omitted
  from manual conversion address selection; server hierarchy checks remain.

## Migration and approval boundary

Only new migration:
`supabase/migrations/20261208000011_afhomes_ost_team_transfer.sql`.

SHA-256:
`22D873A390E25C483317F1358639AB5B2E71BFFB346FEDE00986567392792FDC`.

It creates a private, RLS-enabled immutable `ost_team_transfers` approval ledger,
an immutable-history trigger, a service-role-only `transfer_ost_team` RPC, and
extends `private.assert_ost_genealogy_transfer` to accept an approval produced
in the same transaction. Existing renewal and legacy conversion allowances are
retained. It adds no new mutation operation constraint, public table, account,
Auth setting, data backfill, credential or dependency.

Live preflight verified project `ikaevepedpqygdlipsei`, verified TLS, history
94 through migration 10, the exact current guard, and absence of 11/new objects.
DDL, permission checks, invariants and the single history insert committed
atomically. Post-commit history is 95, with only 11 added. Existing function and
table ACLs and business/Auth/Storage row counts were preserved in the transaction;
the new ledger is empty and RLS invariant queries returned zero rows. No
business RPC or customer/account test ran against the shared database.
Migration 11 is now applied and immutable; its draft header is historical.
Do not replay 01-11 or apply other pending migrations under this approval.

The new API requires migration 11 BEFORE deployment; that prerequisite has
now been approved, applied and verified.
Rollback can return to the prior application build while retaining immutable
history; do not delete approval rows or undo historical genealogy to roll back.

## Local verification

- API member/OST/address/sponsor suites: 138 tests passed.
- Admin Members/Create OST/transfer suites: 36 tests passed. Existing jsdom
  `scrollTo` warnings are unrelated to these assertions.
- Real disposable PostgreSQL lifecycle: 177 checks passed, including full role,
  accreditation and current-term equality before/after a team move, old
  application sponsor retained, old edge retained, one new edge, replay,
  changed-payload denial, active-term and non-SM denial, management authority,
  immutable history, direct bypass denial, observed concurrent lock wait,
  pending-renewal denial, browser ACLs and existing RLS invariants.
- Workspace typecheck, API typecheck, scoped admin lint and both application builds passed.
- A later fork-worker startup timed out before running tests. The final UI rerun
  with one threads worker passed all 36 tests.
- Local Chrome with synthetic records verified the OST team title, retained AA,
  loaded SM options, absent IST-conversion button, explicit approval requirement
  and no horizontal dialog overflow. This is not live authenticated acceptance.
- Context schema index regenerated: 106 migrations, 60 public tables.

No authenticated managed-Auth/browser persistence or live business transfer
has been verified for this change. Unit UI tests use synthetic mocked services.
No claim of a live feature or zero release risk is made.

Approved commit/push target is `claud/develop` / `origin/claud/develop` only.
Preserve the original checkout's 11 unrelated changes and the integration
worktree's already-published but uncommitted earlier implementation copies.
