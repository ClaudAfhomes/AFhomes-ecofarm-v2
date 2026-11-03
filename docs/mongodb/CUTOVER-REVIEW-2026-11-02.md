# Cutover decisions prepared for review

Superseded scope (3 November): the owner canceled combining Supabase history
with MongoDB. Do not execute this merge plan or renumber records. Preserve both
databases and archives. See [native readiness](NATIVE-READINESS-2026-11-03.md).

This is preparation, not authorization to import, overwrite, deploy or push.
The current Atlas administrator/password/assignments and existing business rows
remain protected. Staff temporary-password onboarding, customer activation links,
OST immediate accreditation and disabled modules keep their existing behavior.

## Current facts

The 31 October encrypted source capture contains 93 tables / 595 rows / ten files.
The source-only disposable native rehearsal reconciles 418 business/history rows,
nine eligible identities, four identifier counter high-water marks and seven
profile-photo transfers. Two identity documents have separate verified transfer
proof. These rehearsals do not merge existing development business data.

The current `afhomes_dev` merge review remains blocked with **61 issues**:

| Category | Count | Why it requires an explicit disposition |
| --- | ---: | --- |
| Reference records | 55 | Five departments and three plans differ in metadata; 33 modules, ten roles, one category and three points tiers also include labels, ordering, department or cap differences. The planner does not silently replace native configuration. |
| Unique business keys | 5 | Customer/application/accreditation identities can collide despite different UUIDs. Equal numbers or emails alone do not prove equal people/history. |
| Existing record ID | 1 | Source points-ledger ID 1 is already present in the native database. Its record cannot be overwritten. |

Evidence: `NATIVE-MIGRATION-TARGET-REVIEW-2026-11-02.json` (fresh read-only check).
The three approved test-account aliases preserve their native passwords, profiles,
roles and photos. That approval does not resolve unrelated customer or AA history.

Two possible targets must not be confused:

1. **Merge into current development data:** retain all native data and resolve
   the listed conflicts explicitly before a candidate can be applied.
2. **Build a separate production candidate:** preserve the existing MongoDB owner
   credentials/identity in that candidate and reconcile which native business
   records must join the source history. The successful source-only rehearsal
   does not authorize excluding current native records or replacing afhomes_dev.

Neither path authorizes a shared apply. The owner decision below selects the
planning direction; full candidate reconciliation and scoped apply approval are
still required before cutover.

### Owner decision and candidate continuation

The owner selected **preserve both datasets and resolve conflicts**. Current
development data will not be replaced by the source-only rehearsal.

The digest-bound metadata-only candidate handles **46 of 55 reference conflicts**
without changing native values. Complete source rows become deterministic proposed
evidence in migration_source_reference_evidence. Identical replay gives identical
evidence IDs; changed fingerprints invalidate decisions. No shared history
collection or reference mutation was applied. Grants, role activation, prices,
points caps, department links and accreditation identities cannot be bypassed.
After safe-integer comparison, all three cap values match; no cap change is needed.

The candidate has **15 remaining issues**: nine missing native role department
links, five unique business keys, and one ledger-ID collision. The report prepares
nine missing-only department fills bound to current role fingerprints. Seven use
existing active department codes; the two administrator links depend on the source
ADMINS department being created by the reviewed migration. No department is
created by the review tool. These are setup proposals, not granted writes. Accounts,
assignments and grants stay intact; business identities are not merged by email
or number alone.

The source-only rehearsal now initializes the exact BSON int64 points-ledger
counter. A rollback-only probe reproduced the missing-counter collision and now
verifies an unused next ID. Tests cover IDs above 2^53 and nondecreasing native
high-water marks. This fixes future appends, not the preexisting ID-1 collision.
All four migration counter plans remain unapplied to Atlas.

## Points-ledger validator proposal

`POINTS-LEDGER-VALIDATOR-PROPOSAL-2026-11-02.json` records the exact current and
proposed points_ledger validators, strict/error options and a digest. Read-only
inspection found one current native ledger row and zero rows rejected by the
proposal. The proposal permits the source's paired NULL legacy allocations,
retains native absent legacy pairs, and rejects partial/fractional/inconsistent
numeric pairs. It invents no historical allocation and changes no totals.

Only this one validator differs; other core validators are unchanged. No collMod
or source import was run. The read-only tool accepts only --plan:

```powershell
pnpm exec tsx api/scripts/review-migration-ledger-validator.ts --plan
```

## Unlinked private object

Nine files have verified owners. One captured customer-ID object has no captured
business link. Its original bytes remain encrypted in the archive. The safe
prepared disposition is to retain it there, unassigned and inaccessible through
app routes, rather than invent an owner. Final shared-migration approval must
explicitly acknowledge this exception or provide a verified business link.
It must not be silently deleted, published or attached to another person.

## Remaining execution gates

Review the target/conflict dispositions and exact schema/apply plan, refresh the
source snapshot under the agreed write-freeze procedure, create/verify a rollback
backup, then apply only the approved candidate. Preserve all protected identities
and reconcile money, IDs, history and file hashes again before enabling traffic.
Real authentication/role browser acceptance remains last. No droplet, paid
storage, production database, deployment or remote branch write is authorized by
this document. Same-PC encrypted backups remain the owner's current choice;
portable key/off-device recovery is not proven.
