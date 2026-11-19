# Business migration mapping dry run — 29 October 2026

`api/_lib/migration-mapping.ts` is a pure, unmounted preparation module. It takes
an explicit versioned table/column/key/reference manifest and canonical JSON
source/target snapshots. It opens no database connection, exports no source data,
loads no credentials and executes no imports. Its `ready` result applies only to
mapping the supplied snapshot under the supplied manifest, not cutover readiness.

## Proven mapping boundaries

- Preserve UUID/string business IDs and move the top-level SQL `id` to `_id`.
  Standalone composite keys receive a deterministic migration ID; a real domain
  adapter must still prove compatibility with the native key shape before apply.
- Resolve declared scalar foreign keys through explicit source-to-target aliases.
  Never recursively replace values inside frozen JSON snapshots, notes or audit
  payloads. Source record checksums and the identity map retain mapping provenance.
- Require the source/target owner emails to match before creating the protected
  owner alias. Exclude the source owner profile and its role/restriction/IST-profile
  ownership rows. Never replace the target profile, credentials or assignments.
  Misconfigured protection rules block the plan.
- Reuse natural-key reference records only when the reviewed source columns agree
  with the current target. Report conflicting/ambiguous matches instead of
  overwriting references or unioning grants.
- Require reviewed tables/columns, explicit source/target table snapshots (including
  empty targets) and source keys; preserve exact-decimal money
  as strings, check declared references and non-null unique keys, and reject email
  case collisions. Unknown fields/tables, missing required references, duplicate
  keys, noncanonical values and target-record conflicts block the plan.
- Refuse direct authentication/platform mappings, active onboarding/upload grants,
  active mutation receipts and credential-bearing columns. Explicit exclusions
  record their reason; no source sessions/invitations become active native state.
- Repeated plans recognize identical existing rows. An interrupted snapshot can
  resume planning only the absent records. The digest binds the manifest, ordered
  mapping/checksums, output and supplied target snapshot.
- Any mapping issue returns no applyable record set. Inputs remain unchanged.

## Verification

Six tests cover owner preservation, explicit foreign-key remapping, immutable
snapshots, reference reuse/conflicts, missing references, unknown fields/tables,
exact money, duplicate/case-conflicting identities, unsupported credential
mappings, unsafe owner rules, canonical JSON checks and repeated/interrupted
planning. A native test loads only synthetic mapped business rows into a newly
created disposable replica and checks the preserved owner/assignment and sale
actor/snapshot references. No production business handler is modified or invoked.

Run:

```sh
pnpm --filter api exec vitest run _lib/migration-mapping.spec.ts --maxWorkers=1
```

API typecheck, targeted ESLint and environment isolation also passed. No shared
database, existing administrator, environment, deployment or
remote Git state changed.

## Remaining migration gates

This is not the complete schema manifest for the 125-table inventory recorded on
28 October, nor a dry run of its real records. Obtain a fresh read-only schema
manifest and reviewed field adapters before treating any source table as covered.
The mapper does not prove composite foreign-key adapters, all partial-index/null
semantics, BSON/native date conversion, numeric points ranges, all unique
constraints, commercial/points reconciliation, private-file ownership or complete
authorization equivalence. Do not use it as a generic copy-every-table converter.

The default-off tagged bcrypt bridge now has separate disposable HTTP
password-change/native-upgrade proof; see `PASSWORD-COMPATIBILITY-VERIFICATION.md`.
It has not been enabled on Atlas and no source credentials were exported.
The fresh 30 October schema inventory and per-table review checklist are in
`SOURCE-MAPPING-REVIEW.md`; full native field adapters remain unreviewed.
Preserve administrator-set temporary passwords/forced changes, manual VIP
activation codes/links and the already established MongoDB owner. No invitations,
MFA restoration or account resets are part of migration preparation.

Complete durable encrypted source/target backup and key recovery, bcrypt proof,
full schema/field/identity maps, private-file manifests and an interrupted-run-safe
importer with receipts. Then run and reconcile a full disposable migration before
presenting an exact shared-target apply for approval. Real migration and browser
acceptance remain open; CMS stays last.
