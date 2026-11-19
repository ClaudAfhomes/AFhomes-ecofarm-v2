# IST and direct OST creation transaction deadline

28 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

Follow-up acceptance: the user confirmed successful IST and OST creation. The
reported follow-up was stale OST form inputs when creating the next account.
Members now mounts that dialog only while open; closing or successful creation
discards the entire form instance, while failed submissions retain input for
retry. A new real-page reopen regression reproduced the previous name/password/AA
state; all 37 Members/OST UI tests passed after the lifecycle fix. Browser retry
of the fresh-form behavior is still pending. The earlier acceptance caveat below
describes the state before the user's confirmation.

## Reproduced defect and change

The real MongoDB client configures a 15,000 ms operation timeout. The driver's
`withTransaction` inherits the client timeout as a budget for the complete
transaction when no transaction-specific timeout is supplied. Member creation
spans fresh authorization, role/department checks, identity provisioning,
profile/genealogy writes, AA allocation, optional photo metadata and audit events.
A transaction can therefore expire even when individual database operations work.
The handler returned the generic member-unavailable 503.

The shared IST/direct-OST creation transaction now has an explicit bounded
45,000 ms budget. The normal client timeout is unchanged. This remains below the
frontend request deadline and does not remove authorization or business guards.
Staff retain temporary passwords and mandatory first-login password change. OST
creation still commits an approved/accredited account directly, with no invented
registration or endorsement step.

## Proof and limits

`member-creation-deadline.mongo.spec.ts` uses a new disposable replica with a
separate 200 ms client and a controlled 350 ms fresh-authorization delay inside
the transaction. This accelerates the same inherited-deadline mechanism without
waiting 15 seconds per test. Both valid IST and OST requests failed with 503
before the fix and returned 201 afterward, with exactly one credential account,
active staff, forced password change and an active AA record of the correct kind.

PASS: 35 tests across account creation, the two deadline regressions, profile
updates, member-kind/team transfers and private photos. Existing native account
tests cover temporary-password login/change, immediate head and AA rules, direct
OST accreditation and gated public search. API TypeScript and environment
isolation passed (735 browser files, 415 server files).

All tests used disposable local data. The source/target inventory used separate
read-only connections. No real IST/OST test account was created, and no existing
administrator password, identity or assignments were changed by this fix. No
source writes, migrations, index applies, pushes or deployment occurred.

The reported browser submission has not been reproduced with its original input
or live timing. This proves and fixes the deadline failure; it does not establish
that the user's original failure had no additional cause. Browser retry is pending
the user. Do not describe this as complete live account-creation acceptance.

Next: obtain the result of the real creation retry; if it still fails, trace its
safe response category/request ID without collecting its temporary password.
Migration preparation continues under
[the one-time data migration plan](ONE-TIME-DATA-MIGRATION-PLAN.md), with no target
data import until its backup, mapping and dry-run gates are satisfied.
