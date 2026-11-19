# One-time Supabase to MongoDB data migration

30 October schema refresh: strict TLS using the owner-supplied CA succeeded.
Read-only metadata now covers 93 selected tables, 1,291 columns and 254 foreign
keys. The older 125 count below includes a broader set of provider platform
tables. See `SOURCE-MAPPING-REVIEW.md` and its complete schema-only JSON inventory.
No business records, password hashes or file bytes were exported. Candidate
mappings are explicitly unreviewed; this does not make the importer apply-ready.

29 October password checkpoint: a default-off tagged bcrypt verifier now has
disposable HTTP first-change/native-upgrade proof; see
`PASSWORD-COMPATIBILITY-VERIFICATION.md`. No real credentials were copied or
environment flag enabled. A full identity importer/manifest, real backup and
source-to-target dry run remain required.

29 October mapping checkpoint: an unmounted explicit-manifest business mapping
planner now has synthetic/native disposable proof for protected owner aliases,
declared references, immutable JSON, conflicts and repeated/interrupted planning.
See `MIGRATION-MAPPING-DRYRUN.md`. No full source manifest/export,
real-data transformation dry run or target apply has run. The inventory below
remains the earlier snapshot, not current live counts or a cutover backup.

28 October 2026. Workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. User selected migration preparation after fixing
IST/OST creation. This is a one-time transfer, with no synchronization or dual
writes. CMS remains last. Import execution is NOT READY.

## Current evidence

The Supabase connector lists a different, inactive project. The source was instead
inspected using the existing server-only direct PostgreSQL configuration, after
checking its project reference against `ikaevepedpqygdlipsei`. Queries ran in
repeatable-read, read-only transactions with `default_transaction_read_only=on`
and a statement timeout. No source records, password hashes or private file bytes
were exported. MongoDB `afhomes_dev` was inspected with the existing driver using
reads only; no indexes or data were applied.

These are inventory snapshots, not a backup or completed transformation dry run:

| Domain | Supabase rows | MongoDB rows |
| --- | ---: | ---: |
| Staff | 9 | 1 |
| Authentication users | 10 | 1 |
| Customers | 2 | 0 |
| Roles / modules | 10 / 33 | 10 / 33 |
| Departments | 6 | 5 |
| Role assignments | 9 | 1 |
| IST profiles | 5 | 0 |
| OST applications / members | 2 / 2 | 0 / 0 |
| Referral relationships | 5 | 0 |
| Sales / payments / memberships | 2 / 4 / 2 | 0 / 0 / 0 |
| Applications / reservations | 2 / 2 | 0 / 0 |
| Points accounts / ledger rows | 2 / 1 | 0 / 0 |
| Identity documents | 2 | 0 |

Additional nonempty source records include 2 commissions, 3 frozen purchase-term
rows, 18 immutable purchase-document evidence rows, 148 audit events, 30 import
rows in 3 jobs, 7 AA identities, 2 accreditation terms and 2 registration-detail
records. There are 47 nonempty public/private tables and 254 foreign-key
constraints in those schemas. Database metadata inspection found 125 user tables
across public/private/auth/storage, including Supabase platform tables that must
not be copied as application collections.

Storage contains 3 private customer-ID objects and 7 private profile photos. CMS
media, OST-ID, payment-receipt and service-image buckets currently contain zero
objects. The six source departments include `ADMINS`; target setup currently has
only EXECUTIVE, SALES, FINANCE, HR and OPERATIONS.

## Blocking decisions and compatibility work

1. **Existing administrator:** exactly one source/target email overlaps and its
   IDs differ. Preserve the current MongoDB bootstrap identity, chosen password,
   assignments and profile. Record an explicit source-to-target identity alias;
   remap declared relationship columns referencing that source owner. Never
   overwrite the owner or bootstrap again. Preserve original actor IDs in migration
   provenance and retain immutable snapshot/audit payload contents.
2. **Passwords:** all ten source auth rows use bcrypt. Current Better Auth uses its
   default password verifier. Copying bcrypt values unchanged would not establish
   usable sign-in. The default-off tagged verifier/normal password-change upgrade
   is now tested locally. Review actual source costs, identity mappings and policy
   compatibility before moving identities or enabling it on a real target.
   Do not export hashes to reports, generate invitations or silently reset users.
   Existing temporary-password flags must remain server-enforced. The target
   owner's current credential is excluded from replacement under either strategy.
3. **Reference records:** map roles by slug, modules by key and departments by code.
   Compare role grants, restrictions, catalog terms and configuration explicitly.
   Equal counts do not prove equality. Preserve the extra ADMINS department and
   all referenced IDs through the reviewed map. Never grant permissions by union.
4. **Storage:** copy bytes to the configured private local object store with
   checksum verification, owner mapping and an explicit source-to-target path
   manifest. MongoDB metadata alone cannot migrate files. Source profile photos
   are stored under storage owner paths; native delivery uses `profile_photos`
   metadata and generated object keys. Retain private authorization and short-lived
   download URLs. No paid cloud bucket or deployment is required for this phase.
5. **Provider-bound and temporary state:** do not copy Supabase sessions, refresh
   tokens, MFA state, OAuth state, password-recovery links or signup invitations.
   The user disabled native MFA; importing a security-policy row must not restore
   it. Review existing customer activation tokens before issuing new single-use
   code/links. Do not auto-email staff. Active search attempts and expired private
   contact records require retention review, not blind copying. Public search
   remains gated until native privacy/configuration/cleanup checks pass.

## Mapping and load order

Keep UUID business IDs as strings where no approved identity/reference mapping is
needed. Map PostgreSQL `id` to MongoDB `_id`; map each declared relationship using
an explicit schema-aware manifest. Never recursively replace arbitrary strings in
historical JSON snapshots. Some private tables have natural/composite keys rather
than UUID `id` columns; each needs an explicit mapper.

1. Verified private backups of the source and existing target, including auth
   material and storage manifests in owner-only ignored directories. Never commit
   exports or use source data as a public test fixture.
2. Reference and identity maps: roles, modules, departments, plans/categories,
   grants/restrictions, owner alias and remaining identities.
3. Staff/customer records, role assignments, IST profiles, OST applications,
   registration details, accreditation terms, genealogy and AA identities/history.
4. Purchase applications, holders, frozen terms, reservations, holders/schedules,
   card sales and sale-time hierarchy snapshots.
5. Payments, commissions, memberships, points accounts/periods/ledger, document
   evidence, identity-document metadata, import jobs/rows/source provenance and
   append-only audit history. Preserve original statuses and historical totals.
6. Private file bytes and reviewed path/owner references. Verify every referenced
   object's existence and checksum before allowing related workflows.
7. Allocator high-water marks: company counters use `issue_year`/`last_issued`, AA
   counters use `accreditation_month`/`last_value`, and VIP numbers have issuance
   history. Convert these to native counters without recycling issued identifiers.
8. Retained disabled Redemption/Services records and final CMS work, after core
   business acceptance. Do not enable either disabled module during transfer.

Money remains exact-decimal text, timestamps retain their meaning, and large
integer points values require explicit range checks. Do not recompute historical
sales from current plans. A migration inserts historical facts; it must not call
ordinary create/activate endpoints that would allocate new numbers, commissions,
payments or onboarding tokens.

## Dry run and acceptance gates

The next implementation must produce a deterministic table/column/foreign-key
manifest, record-level transform checksums, conflict report and bounded,
restartable importer. Keep migration receipts separate from application mutation
receipts so replaying an old RPC response cannot return source-system identities.
Preserve any imported mutation history as historical evidence, not active tokens.

Run the complete transformation against an isolated disposable MongoDB instance
named `afhomes_dev`, preserving the existing target-owner conflict scenario. A
dry-run result must include:

- Per-table source/target counts, every excluded record with its reason, no dangling
  references, no duplicate email/business/AA IDs, and a stable retry result.
- Per-sale verified-payment totals, balances and activation eligibility; separate
  recorded/rejected/voided money; membership/points/commission/history checks.
- Staff/portal authorization, deny restrictions, first-login password changes,
  VIP activation ownership/expiry/replay protection and original owner login.
- Private file checksums, authorized delivery and denied cross-owner access.
- Browser creation of an IST and direct accredited OST, account login, member
  reload, public query and customer lookup with their existing eligibility rules.
- Transaction/audit rollback, interrupted-run retry, preserved snapshots and no
  duplicate accounting under concurrent requests.

Only after reviewing the backup, manifest, dry-run reconciliation and exceptions
should the operator authorize an exact target apply. Take a fresh source snapshot
or use an agreed write freeze; this inventory is not a cutover snapshot. Stop
source business writes during final reconciliation before enabling target writes;
do not let both systems accept the same financial workflow.

## Rollback and current status

Before cutover, discard the isolated dry-run database and keep Supabase serving
the application. For an approved target import, capture target before-images and
an inserted-record manifest; any rollback must be scoped to that run and must
preserve the existing administrator. Once new target business writes exist, do
not delete them or silently revert to the source: use a separately reviewed
forward-reconciliation procedure.

Completed: read-only live inventory, initial mapping/conflict analysis and source
rule review. NOT RUN: private backup/export, real-target password bridge enablement, data
transformation/import dry run, target apply, storage copy and cutover. No data
transfer or synchronization has been enabled.
