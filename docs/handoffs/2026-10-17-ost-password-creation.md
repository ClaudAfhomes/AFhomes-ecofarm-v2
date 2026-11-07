# OST direct creation: password and simplified layout

Local implementation, 2026-10-17, Asia/Singapore. Not deployed or live-applied.

> UPDATE: User subsequently approved migration 10 subject to safety checks.
> It was applied and verified at 20:49 SGT on 2026-10-17. History 93 -> 94;
> only the new service-role-only RPC was added. Existing functions, table
> catalogs and business row counts were unchanged in the apply transaction.
> RLS invariant queries returned zero rows. The initial TLS trust failure
> was resolved using the existing Supabase root CA, with certificate verification
> enabled; no TLS bypass. Both application builds subsequently passed via
> direct pnpm scripts (Turbo could not locate its package-manager binary).
> The initial no-remote-action/credential and draft-status statements below
> describe the earlier implementation checkpoint, not this approved apply.
> No stage, commit, push or deployment followed. Managed Auth/browser UAT
> remains unverified. See `docs/supabase/MIGRATION-APPLICATIONS.md`.
Worktree: `C:/Users/SSD-CLAUD/Documents/AFhomes-develop-ost-integration`.
Starting HEAD: `b7c11aa`; branch: `fix/develop-ost-lifecycle`.

## User-approved scope

- Make the OST form similar to IST's layout, without making the workflows identical.
- Manual management creation selects an active SM only.
- Use a temporary password and confirmation, with forced change at first sign-in.
- No invitation email for completed direct management creation.
- Offer automatic or manual AAO numbering; validate format and duplicates.
- Remove the Region selector from this creation form. Verify province, locality,
  barangay and postal reference on the server. Public forms keep their Region UI.

## Implementation and boundaries

The existing direct submission/signature evidence and annual validity remain.
Pending applications still create no login. Public sponsored approval, IST
creation, renewals and transfers retain their existing workflows.

New additive RPC: `install_direct_ost_password`, migration
`20261208000010_afhomes_direct_ost_password.sql`. It creates active staff with
`must_change_password=true`, no invitation row, and atomically installs the
OST role, genealogy, term and automatic/manual accreditation. Admin/Super Admin
authority, active-SM validation, immutable issued numbers and service-role-only
execution remain enforced. Existing applied migrations were not edited.

Only an Auth identity newly created by this request may be cleaned up after
a confirmed SQL rejection and an absent installed member. Uncertain outcomes
preserve the identity and require administrator review; no automatic reuse of
existing identities or password resets. Passwords are not persisted in the
application form, returned in responses, or written to audit records.

## Local verification

- API member/address/sponsor/OST suites: 135 tests passed.
- Contracts member/OST accreditation suites: 54 tests passed.
- Admin Create OST/Members suites: 32 tests passed; jsdom reports its existing
  unimplemented `scrollTo` warning in Members tests.
- Disposable PostgreSQL lifecycle: 155 checks passed, including auto/manual AA,
  active/password-change status, no invitation, retry, rollback and ACL checks.
- Workspace typecheck and Supabase TypeScript check passed.
- Schema context regenerated: 105 migrations, 60 public tables.

No managed Auth sign-in, live authenticated browser UAT or full build performed
for this change. Local form submission tests use synthetic mocked services.

## Release boundary

Migration 10 is a LOCAL DRAFT and must be approved and applied before this API.
Do not deploy using only the earlier nine-migration approval. Fresh target
preflight and migration review remain required. Do not rerun applied versions.
No stage, commit, push, remote query/write, Auth invitation or deployment was
performed during this task. No credentials were loaded.

Eventual commit/push target: `claud/develop` / `origin/claud/develop` only, after
approved integration and fresh ancestry verification. Never push `develop`,
`main`, or `fix/develop-ost-lifecycle`; never force-push. Preserve the older
checkout's unrelated user edits.
