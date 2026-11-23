# Release review: reconcile the applied eight with develop

2026-10-17, Asia/Singapore. Read-only repository review plus disposable loopback
compatibility proof. No live database query, apply, push or deployment this session.

> **UPDATE, later the same day: all three blockers below are resolved locally;
> nothing is committed, pushed or applied.** The corrections are delivered
> forward in new migration
> `20261208000009_afhomes_develop_transfer_integration.sql` (operation-check
> union, corrected guard re-deliveries, already-applied shape reconciliation,
> 12-argument transfer RPC plus an 11-argument transitional wrapper for
> deployed callers). The original reproduction is
> `.tmp-bin/release-review/applied-eight-compatibility.mjs`; the post-fix
> upgrade proof is `.tmp-bin/release-review/postfix-compatibility.mjs`
> (all checks pass). Exact scope, evidence and the release sequence are in
> [the release plan and commit allowlist](2026-10-17-release-plan-and-allowlist.md).
> The review below is kept as the finding record; its "release is BLOCKED"
> conclusion is superseded by that plan.

## New state reported and locally verified

The user reports eight migrations applied to `ikaevepedpqygdlipsei`. The older
checkout's MIGRATION-APPLICATIONS.md records exactly those eight versions and
84 -> 92 history entries. Live state was not independently queried here.

Local Git inspection confirms `57cdfc6` (62 files) and `09a8416` are on the older
`claud/develop` checkout. It retains exactly the eleven previously preserved
unrelated dirty paths. The adapted worktree is still uncommitted on
`fix/develop-ost-lifecycle`, based on `b64c513`. These are different implementations.
Migration versions 02, 04, 06 and 07 have differing file bytes between checkouts.

Treat the eight committed/applied migration bodies as immutable. Do not replay,
replace or rewrite their live versions to make the integration tree agree.

## Reproduced blockers

1. **Applied guards conflict with develop's existing transfer workflow.**
   `develop`'s Members API calls `transfer_sale_team_member`; its deployed SQL
   updates the role assignment without inserting the conversion ledger required
   by migration 07's `guard_ost_role_workflow`. In a disposable database, the
   eleven-argument IST -> OST call succeeds on the develop baseline. After
   applying the eight file bodies from the committed checkout, the identical
   call fails with `OST_ROLE_WORKFLOW_REQUIRED`. Its SQL changes roll back and
   the original IST number remains intact. This disproves the blanket statement
   that applying those guards cannot affect old API behavior. It does not prove
   a real user has attempted or experienced that failure live.

2. **Integration draft 09 repeats the narrowed-operation constraint defect.**
   Its `mutation_requests_operation_check` lists five operations. On the
   develop baseline plus the corrected eight bodies, inserting synthetic
   `payment.verify` idempotency history succeeds; applying draft 09 then fails
   with SQLSTATE 23514 on that check constraint. The failed transaction was
   rolled back. If no conflicting history existed, that narrowed constraint
   could instead install and reject future operations. Preserve the complete
   applied thirteen-operation set and the additional `sale_team.transfer`
   operation; prove the full union, not just a count.

3. **Migration lineage and rollout compatibility remain unreconciled.**
   The integration draft 04 differs structurally from the reported applied 04;
   applied 04 adds conversion origins and a public converter. Draft 09 changes
   the transfer RPC signature and requires request IDs. Fresh-build tests do
   not establish that it upgrades the actual applied-eight schema or remains
   compatible with current API and cached browser clients. Do not assume a
   code rollback will work against changed SQL.

## Evidence and limits

Command, exit 0:

```powershell
node .tmp-bin/release-review/applied-eight-compatibility.mjs
```

The ignored probe boots develop's schema before version `20261208000001`, seeds
synthetic roles and a seller, proves the original transfer, applies exactly the
eight committed-file bodies, reproduces the transfer failure, seeds a preserved
operation and reproduces draft 09's constraint failure. The server is stopped in
finally. It loads no env file or live credentials. This is a local compatibility
reproduction, not a mirror of live's intentionally different migration history.

## Next authorized local work

- Finish the release-safety review against this new applied-eight baseline.
- Reconcile current develop with the committed application changes; preserve
  the newer creation/transfer screens and every existing business operation.
- Use new forward migration version(s) for additional corrections, preserving
  the exact eight applied files. Decide how to retire or bridge the two
  conversion paths without bypasses or fabricated signatures/endorsement.
- Prove upgrade, current API/new SQL, new API/current SQL, existing history,
  concurrent retries, failure rollback, and the proposed deployment rollback.
- Rebuild the exact commit allowlist and release/apply plan after corrections.

No push, deployment, live correction, commit or staging approval is inferred
from the user's status report. The prepared actions — commit scope, live apply
of `20261208000009` only, and deploy/promote — are written out with their
evidence in [the release plan and commit allowlist](2026-10-17-release-plan-and-allowlist.md),
which requests the three approvals separately. Until those approvals nothing
leaves this working tree; the local blockers themselves are resolved and
proven, not merely planned.
