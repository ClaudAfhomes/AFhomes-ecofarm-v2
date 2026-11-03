# Source mapping review - 30 October 2026

Superseded scope (3 November): source-history migration is canceled. Retain this
review and its unmounted preparation as historical evidence; do not import into
Atlas. Native MongoDB operation is the active scope. See
[native readiness](NATIVE-READINESS-2026-11-03.md).

## Latest checkpoint - 2 November

Eighty-three definitions (44 domain adapters, 39 fail-closed empty-source guards)
decode 420 rows from the authenticated 31 October
archive. Source points, finance, imports, audit review, rule/policy history, identity-document metadata, legacy OST and official-form/document reconciliation pass;
all 18 immutable document payloads now read without changing their fields.
Two sales lack frozen ancestry and remain explicitly unknown. Nine private files
have source business links; one customer-ID object remains unlinked and preserved
in the encrypted archive. Overall native import remains blocked/not ready. See
MIGRATION-PREPARATION-2026-11-02.md for proof and remaining mappings. Earlier
checkpoints below retain their original scope and dates.

All 93 captured tables now have explicit dispositions. Old onboarding tokens,
mutation receipts and privacy-search logs stay encrypted archive-only; they never
restore active capabilities or current-host consent. The disabled redemption
catalog goes to private history only. VIP issuance records retain retired owners
without requiring a surviving customer FK. Unknown/new nonempty tables block.

The source-only native rehearsal loads 418 business/history records and nine
eligible identities, uses three counter high-water marks and proves exact replay.
It uses six local validator proposals: points_ledger preserves source paired null
allocations and rejects partial/inconsistent splits. This proposal is not applied
to Atlas. Seven real archived photos copy/read back/link/replay in temporary local
storage; two ID files have separate verified transfer proof. Existing development
business data is not merged, and the current development merge remains blocked
on reference/business-ID conflicts. Three reviewed test-account aliases preserve
native credentials/profiles/roles; no automatic matching of other accounts.
See SOURCE-NATIVE-REHEARSAL-2026-11-02.json. This is data/credential-storage proof,
not actual source-password, browser, production or complete cutover acceptance.

## Current checkpoint - 31 October

Fifteen reviewed business definitions now cover organization/access (six), staff,
network profiles, catalog (two), points tiers, referral relationships, current and
historical sales-team accreditation, and customers. Native index/storage/replay
tests use disposable replicas. This remains partial coverage of 93 source tables.

The separate identity planner preserves UUIDs and bounded bcrypt credentials,
requires explicit business bindings and eligible provider/state evidence, keeps
staff password-change flags, and excludes the existing administrator. A disposable
transaction rollback and HTTP sign-in/first-change gate are tested. The read-only
source aggregate audit found ten email/password identities, all bcrypt cost 10;
three non-owner email collisions with different native UUIDs remain blocked.
No accounts were linked. Following explicit approval, a later encrypted capture
now includes the reviewed source authentication projection; see
SOURCE-CAPTURE-AND-REHEARSAL-2026-10-31.md. It has source-free raw staging proof,
not native identity or business-flow migration acceptance.

`timestampPrecision: preserve-source` is an explicit, digest-bound dry-run policy.
It retains original timestamp strings, including microseconds and offsets, in
`migration_source_timestamps`, while writing the existing native millisecond ISO
fields. Renames retain source field names in that evidence. Invalid timestamps,
forged evidence fields and evidence differences on replay/reference reuse block
the plan. Without the option, nonzero microseconds still fail closed. Native
queries still have millisecond resolution; the option is not approval to discard
source evidence or to import without chronological/domain reconciliation.

`migration-counters.ts` separately proposes maximum source/native/issued-number
high-water values for company customer IDs, shared IST/OST monthly AA counters and
VIP controls. It never lowers a counter, returns no partial changes on invalid
evidence, blocks century-colliding AA source months, and binds the input to a
digest. The caller must include current and retired numbers; this is not proof
of a complete real inventory or an executable counter apply.

Encrypted local MongoDB capture and independent restore now work; the approved
six core validators are installed. See LOCAL-BACKUP-AND-VALIDATOR-SETUP-2026-10-31.md.
Encrypted source export is complete. Remaining business mappings, reference-history conflicts,
complete private-file coverage, VIP issuance tombstones and real reconciliation
remain open. The older checkpoints below describe their then-current scope.

Fresh verification: 88 focused tests across nine files pass, including disposable
replica storage/rollback/replay, native HTTP identity sign-in, encrypted restore
and local file-copy failure/retry paths. API typecheck, explicit new-script
typecheck, scoped ESLint, environment isolation and scoped diff whitespace checks
pass. Fresh Atlas read-only review finds all six validators matching and zero
invalid records. The scheduled backup reports last result 0 and next run 21:00.
The full repository suite and browser acceptance were not repeated here.

Fresh metadata collected with verified TLS and repeatable-read, read-only queries. No business rows, password hashes or private bytes were exported.

All selected columns, SQL constraints and indexes are in the companion JSON. These are schema facts, not executable migration approval. Each candidate requires native field/key comparison and a disposable transformation/reconciliation test.

## Confirmed adapter requirements

- Source `role_permissions` uses `(role_id, module_id)` as its primary key;
  native organization writes give it a separate `_id` and enforce the pair with
  a unique index. The dry-run mapper now resolves role/module aliases before
  matching the pair and compares all four grant flags before reuse. Different
  grants block the plan; it never unions or replaces a target permission row.
- Source `staff_role_assignments` uses `staff_id` as its primary key; native
  creation also stores `_id`. Preserve the mapped staff/role/assigning-actor
  references, use a stable migration identity for a new row, and exclude the
  protected owner's existing assignment from replacement. Source metadata calls
  the timestamp `assigned_at`; native organization creation writes `created_at`.
  The dry-run field/time adapter now exercises this rename with the four source
  columns and staff/role/assigning-actor remapping. Real export/state validation
  and migration approval are still required; a raw copy is not approved.
- Source `staff_permission_restrictions` has a composite staff/module key and
  source `network_member_profiles` has a staff key. Native unique indexes use
  those business keys while records also need `_id`. Map staff references
  explicitly, retain deny-only semantics and protect the target owner.
- Source `tier_points_config` is keyed by `tier`; native reference setup creates
  a UUID `_id` and queries by tier. Reconcile tier values and numeric caps before
  reuse; generic `_id <- id` would fail because source has no `id` column.
- Source `card_sale_hierarchy_snapshots` has a composite sale/ancestor key.
  Native indexes preserve the same pair; source also has unique sale/depth.
  Preserve the original frozen ancestry and depth. Current genealogy must not
  be used to fill missing historical rows.
- Source `points_ledger.id` and its self-reference `origin_award_id` are bigint.
  The dry-run mapper now supports explicitly declared `bigints` columns:
  `identifier` validates canonical signed PostgreSQL int64 text and keeps it as
  text; `safe_integer` converts text only within JavaScript's safe integer range.
  Keys and references cannot use the numeric conversion. Nullable fields retain
  null; required-reference/key checks still apply. Invalid exports block the whole
  plan rather than rounding. This is scalar-adapter proof, not a complete reviewed
  points-table manifest or real-ledger reconciliation.

Evidence: the metadata inventory, `organization.mongo.ts`,
`reference-catalog.mongo.ts`, `members.mongo.ts` and `sales.mongo.ts`.
These observations identify necessary adapters; they are not transformation
or reconciliation proof for real source rows.

## Dry-run mapping safeguards verified locally

`api/_lib/migration-mapping.ts` remains pure and unmounted: it reads no environment,
connects to no database and has no apply operation. The `bigints` declaration is
optional and must name reviewed columns. Source exports must retain PostgreSQL
bigint text; already converted numbers are refused for those columns. Source row
checksums remain bound to the original export, while the plan digest also binds
the declared conversion and resulting records. Frozen nested JSON is untouched.

The mandatory owner rule now covers `network_member_profiles` as well as staff
assignments/restrictions and legacy IST profiles. A manifest missing its
`ownerField: staff_id` and staff reference is refused; a correctly declared source
owner profile is excluded so it cannot replace the target owner's profile.

Focused tests cover signed/safe boundaries, malformed exports, unchanged inputs,
replay, source checksums, owner protection and a fresh disposable MongoDB load.
The disposable load checks bigint IDs/self-references remain BSON strings and
points amounts become numbers, with existing synthetic owner/assignment unchanged.
No actual source records, credentials, private files or Atlas data were transferred.

Dependent natural-key matching now waits for parent aliases, including parents
that themselves reuse reference records. Unresolvable cycles, missing parents and
ambiguous matches block the plan. Matching compares mapped column values, including
natural-key columns, while historical JSON and original source checksums stay intact.
Synthetic permission tests cover all four grant flags, all four deny flags, owner
restriction exclusion, reordered manifests and repeat runs. A separate disposable
load uses the native `(role_id, module_id)` unique index, reuses an existing grant,
adds one missing grant, preserves owner/assignment and produces an empty replay.
These test manifests contain selected fields; they are not complete source exports
or full schema/state validation for the 93 tables.

Verification for this continuation: mapping/password suites 19 tests PASS (including
two fresh disposable mapping loads); API typecheck, scoped mapper/spec ESLint,
environment isolation and scoped `git diff --check` PASS. No full-suite or browser
run was repeated for this unmounted planner change.

### Field and timestamp continuation

Manifests can explicitly declare `renames` and source `timestamps`. Destination
collisions, undeclared source fields, MongoDB/reserved/credential field names and
renaming a source `id` or protected owner field are refused. Matching and uniqueness
checks use the mapped destination names; references still resolve from source
columns. These declarations never recurse into historical JSON.

Timestamp input must be raw text with an explicit `Z` or numeric timezone offset,
using a four-digit positive year and at most six fractional digits. Valid calendar
dates are checked before converting the instant to UTC millisecond ISO text.
Extra fractional digits must be zero: any nonzero sub-millisecond part blocks the
plan with `TIMESTAMP_PRECISION_LOSS`. No timezone is guessed; malformed dates,
infinities, Date objects and numeric epochs are refused. Null is preserved at the
scalar layer; full table nullability/state checks remain required separately.
The eventual exporter must retrieve timestamp text without first passing through
the PostgreSQL driver's Date parser, which could already discard precision.

The assignment fixture uses the source's `staff_id` primary key and its four
columns, aliases the assigning owner, writes `created_at`, preserves the target
owner assignment and reuses only identical existing staff assignments. A third
disposable load under the native unique staff index verifies stored field names,
UTC text and a completely empty replay. Original export checksums stay unchanged.

### Date-only continuation

Explicit `dates` declarations validate positive four-digit Gregorian calendar
dates without changing their `YYYY-MM-DD` text. This covers the scalar shape of
source birth dates, period bounds and other SQL date fields; it is separate from
timestamp normalization. Null is preserved at this layer. Invalid dates, ambiguous
formats, timestamps, epochs, infinities and already-parsed Date objects are refused.
Conflicting scalar/reference declarations and undeclared date columns block the
manifest. Historical dates are not subjected to current signup-age rules.

Synthetic customer fields `birth_date` and `supplementary_birthday` exercise
leap/century boundaries, unchanged source checksums and repeat planning. The
existing disposable business load now also checks that a birth date remains a
plain MongoDB string and a nullable supplementary birthday stays null. This is
scalar validation, not a completed customer-table migration or nullability gate.

### Required fields and booleans

Explicit `notNull` declarations reject null/missing values without treating false
or zero as absent. `booleans` accepts only primitive true/false (or null when the
column is nullable); text, numeric and object substitutes are refused rather than
coerced. Undeclared columns and overlapping scalar/reference declarations block
the manifest. Diagnostics contain column names/codes, not rejected field values.

Permission/deny fixtures now declare all four flags as boolean and non-null.
Assignment declarations require staff, role and assignment time while permitting
a null assigning actor, matching the recorded source schema. Protected owner rows
remain excluded instead of being revalidated/replaced by source records.

A metadata-only test verifies the complete source column lists, primary keys,
not-null sets and boolean columns for `role_permissions`,
`staff_role_assignments` and `staff_permission_restrictions` against the recorded
inventory. It also pins the supported permission CHECK definitions to that
inventory. Canonical UUID fixtures additionally match the declared UUID and
timestamp columns for these three tables; this does not approve other tables or
real-data transfer.

### Source permission constraints

The dry run enforces the source's three write-requires-view CHECKs and its
nonempty deny-restriction CHECK. Every create/update/delete grant needs view;
an all-false grant row is valid. A restriction must deny at least one action.
Invalid rows block the entire plan; flags are never automatically repaired,
unioned or weakened. The canonical access flags must remain declared as non-null
booleans with unchanged destination names, preventing omission/rename bypasses.

All 16 grant combinations and all 16 deny combinations are exercised with
unchanged-input assertions. The disposable access load also verifies existing
owner/staff deny records under the native unique index, alongside existing grant,
owner identity/assignment and empty-replay checks. This proves the JavaScript
mapping guard, not a new PostgreSQL or shared MongoDB schema apply. Other domain
CHECKs, types and lifecycle rules still require explicit validation.

### UUID continuation

Explicit `uuids` declarations require lower-case, hyphenated 8-4-4-4-12 hexadecimal
text. The planner neither generates replacement IDs nor case-folds exports. Null
remains subject to the separate not-null declarations. UUID columns cannot also
be declared as other scalar types. This is a canonical text check, not a UUID
version/variant conversion or approval to change existing target identifiers.

Checks run on source fields and again after reference aliases resolve. Reused
target identities and protected source/target owner IDs are also checked when
their source `id` is declared UUID. Invalid aliases block the whole plan even
when their emails/reference keys otherwise match. Auth-provider identities remain
outside the generic business mapping and must not inherit this UUID assumption.

The canonical synthetic access graph covers source/target owner IDs, roles,
modules, assignments, grants and deny restrictions. The existing disposable
native-index load now uses this graph and proves unchanged owner/access records,
valid new grant references and empty replay. Metadata tests verify the UUID and
timestamp declarations for all three reviewed access/assignment tables. Frozen
nested evidence remains untouched; no real identities or records were imported.

### Reusable reviewed organization/access definitions

`api/_lib/migration-access-manifest.ts` now exports
`reviewedAccessMigrationTables()` for the three access/assignment tables, plus
`reviewedOrganizationReferenceTables()` for departments, modules and roles.
Together these explicit definitions cover six tables, 36 source columns, eight
single-column foreign keys and six primary keys. Required references, scalar
types, timestamp rename, exact reuse, owner exclusions and unique keys are
declared directly. Independent calls cannot mutate each other.

Source role-slug, module-key and department-code regex CHECKs are enforced without
changing case or trimming history. Declared `text` must remain primitive text;
declared `int32` must be an integral Number within PostgreSQL integer bounds.
Null follows the separate required-field declarations. Unknown columns or
overlapping scalar declarations block the plan; values are not coerced.

Role reuse resolves the department alias before comparing every non-ID source
field, including active/system flags and normalized creation/update timestamps.
Differences in seeded target metadata therefore block reuse instead of silently
discarding source history or replacing target records. Role names are also
checked against the native unique-name index, which is stricter than the source's
slug-only uniqueness. Conflicts still need reviewed resolution before transfer.

The metadata test exercises these definitions, including all foreign-key parents,
referenced `id` columns and nullable versus required relationships. The canonical
access fixture and disposable database load consume the same definitions. That
load now calls the actual `setupMongoOrganization()` on the fresh disposable
database, checks access/role/department keys against its installed indexes,
and creates the module-key index in the disposable fixture to match the existing
bootstrap index definition (without invoking account bootstrap). The native
member setup adds the profile's unique staff key; native catalog setup adds the
category/plan keys. The fixture separately installs the proposed tier guard/index
only in disposable MongoDB. All sixteen declared unique keys are checked in the
combined eleven-table fixture, including that unapproved shared-index proposal.
The fixture
inserts a missing staff assignment with mapped actor/time and a new permission,
and verifies existing owner/access records plus a completely empty replay.

The staff definition now covers all 13 source fields, including department,
employee/sales numbers and password-change state. Source email canonicalization
and the four legal staff statuses are checked; identifiers are preserved rather
than regenerated. The disposable load verifies the complete new staff record,
unchanged target owner/assignments, native unique indexes and empty replay.

The source staff primary key also references `auth.users.id`. A separate pure
identity audit requires explicit source and target ID/email-only snapshots before
the full staff mapping can be ready. It rejects missing identities, mismatched
emails, duplicate IDs/emails, malformed headers and non-owner email collisions.
Only the protected owner may use the reviewed source-to-target ID alias. Extra
provider or credential fields are refused without echoing their contents. The
plan digest binds the supplied identity evidence; business output contains no
authentication writes. Callers must supply fresh snapshots at any future apply.

This proves foreign-key identity matching only. It does not prove credential
transfer, banned/deleted account policy, provider-state compatibility or login;
those need a separately reviewed authentication adapter. This is an eleven-table
manifest component, not the complete 93-table manifest. Remaining business,
identity-state and counter mappings still require review.

31 October network-profile preparation: the complete 23-field definition preserves
source dates, contact and government-ID fields in business output, with all three
staff references declared and source sex/civil-status/PSGC-code CHECKs enforced.
The protected owner's profile is excluded; only declared reference fields use
the owner alias. Empty source ZIP text and nullable optional values stay intact.
Diagnostics/checksum metadata do not expose government-ID values. The disposable
load uses `setupMongoMembers()` to prove native profile uniqueness, full stored
content, owner preservation and empty replay. This is profile storage proof;
IST/OST accreditation, genealogy, photos/private files, address-reference
reconciliation and browser acceptance remain separate, unfinished work. No new
age or postal rule is introduced by this migration adapter.

31 October catalog preparation: `migration-catalog-manifest.ts` covers all six
category and 29 plan columns, their nullability/types/PK/FK/unique keys and source
CHECKs. Category aliases resolve before plan-code reuse; every stored term and
history field must match before an existing target plan can be reused. Conflicts
block output rather than overwrite prices or benefits. Exact price/rate strings,
nullable descriptions and all validity/points/discount/holder/feature settings
remain unchanged. Source price syntax rejects leading zeros even though the
general shared money parser permits them. Native catalog indexes, stored plans
and empty replay have disposable proof. This does not reconcile real catalog
rows, validate all cross-field operational economics, change frozen sale snapshots
or initialize any real database.
The component is not mounted or imported by runtime handlers and has no database,
filesystem, environment or apply operations. No shared setup/import ran.

31 October follow-up adds the four-field tier cap/actor definition, full target
baseline reconciliation and read-only private-file verification. The tier
validator/index is a separate local proposal, not part of shared native setup;
see MIGRATION-RECONCILIATION-AND-FILES.md for proof and remaining gates.

Latest focused gate: mapping/identity/password/file/storage/core-validator suites
68 tests PASS, including fresh
disposable mapping loads; API typecheck, scoped ESLint, environment isolation and
scoped diff whitespace check PASS. Full-suite/browser acceptance was not repeated
for the unmounted planner.

Still required: full per-table columns/state/reference approval, timestamp/date
coverage and a preservation policy for nonzero microseconds, remaining field
renames, composite foreign keys,
identity/file adapters, counters and full reconciliation. The 93-table checklist
below remains a review inventory, not an executable migration manifest.

## Complete table checklist

Scope: public/private base/partitioned tables plus auth.users and storage.objects/buckets. Other provider tables are outside scope. The earlier 125-table snapshot included broader platform metadata; the new count does not indicate missing application tables.

| Source | SQL primary key | Disposition and required review |
| --- | --- | --- |
| auth.users | NONE - explicit key adapter required | Identity adapter: tagged bcrypt and protected owner alias; never generic copy |
| private.business_id_aliases | id | Identifier allocator adapter; reserve IDs and reconcile collisions |
| private.commission_rule_archive | rule_id | Candidate commission_rule_archive; field/state/key parity NOT REVIEWED |
| private.company_customer_id_counters | issue_year | Identifier allocator adapter; reserve IDs and reconcile collisions |
| private.customer_external_import_receipts | source_id | Candidate customer_external_import_receipts; field/state/key parity NOT REVIEWED |
| private.customer_import_commission_policies | source_id | Candidate customer_import_commission_policies; field/state/key parity NOT REVIEWED |
| private.customer_import_payment_claims | id | Candidate customer_import_payment_claims; field/state/key parity NOT REVIEWED |
| private.customer_import_points_baselines | membership_id | Candidate customer_import_points_baselines; field/state/key parity NOT REVIEWED; bigint range/string adapter: confirmed_points |
| private.customer_import_purchase_sources | id | Candidate customer_import_purchase_sources; field/state/key parity NOT REVIEWED |
| private.customer_import_source_rows | row_id | Candidate customer_import_source_rows; field/state/key parity NOT REVIEWED |
| private.member_workbook_jobs | id | Candidate member_workbook_jobs; field/state/key parity NOT REVIEWED |
| private.member_workbook_rows | id | Candidate member_workbook_rows; field/state/key parity NOT REVIEWED; bigint range/string adapter: audit_id |
| private.mutation_requests | id | Exclude active replay state; historical provenance needs separate review |
| private.ost_accreditation_renewals | id | Full metadata declaration, empty-source-only guard; any nonempty capture requires domain adapter review |
| private.ost_accreditation_terms | id | Reviewed historical dates/status/exclusive origin and declared links; source/native index/replay checks |
| private.ost_applicant_changes | id | Candidate ost_applicant_changes; field/state/key parity NOT REVIEWED; bigint range/string adapter: id |
| private.ost_import_jobs | id | Candidate ost_import_jobs; field/state/key parity NOT REVIEWED |
| private.ost_import_rows | id | Candidate ost_import_rows; field/state/key parity NOT REVIEWED |
| private.ost_ist_conversions | id | Full metadata declaration, empty-source-only guard; any nonempty capture requires domain adapter review |
| private.ost_registration_details | application_id | Reviewed form/signature/program/source CHECKs; original JSON and payload hash preserved, actors remapped explicitly |
| private.ost_team_transfers | request_id | Candidate ost_team_transfers; field/state/key parity NOT REVIEWED |
| private.public_verification_settings | singleton | Reviewed source CHECKs/metadata; history-only migration_source_public_verification_settings; no runtime approval/contact/retention/scheduler overwrite |
| private.purchase_document_evidence | id | Candidate purchase_document_evidence; field/state/key parity NOT REVIEWED |
| private.sale_team_aa_counters | accreditation_month | Identifier allocator adapter; reserve IDs and reconcile collisions |
| private.sale_team_accreditation_history | id | Candidate sale_team_accreditation_history; field/state/key parity NOT REVIEWED |
| private.sale_team_accreditations | staff_id | Candidate sale_team_accreditations; field/state/key parity NOT REVIEWED |
| private.sale_team_search_attempts | ip_hash | Retention/privacy review; do not restore old rate-limit state |
| private.sale_team_search_contacts | id | Retention/privacy review; no blind contact-data copy |
| private.sale_team_search_disclosures | ip_hash, request_id | Retention/privacy review of historical disclosure evidence |
| private.staff_security_policy | singleton | Reviewed two-field history-only migration_source_staff_security_policy; cannot target native MFA policy or restore MFA |
| private.vip_card_number_issuances | vip_card_number | Identifier allocator adapter; reserve IDs and reconcile collisions |
| public.audit_events | id | Reviewed eleven-field history with exact bigint IDs and auth-actor gate; unchanged JSON/timestamps, targeted private-evidence blocks, protected-owner and native append/replay proof |
| public.card_categories | id | Full six-field definition; source slug CHECK, native unique keys and strict alias/replay proof; real reconciliation remains |
| public.card_plans | id | Full 29-field definition; source CHECKs, exact prices/rates, category aliases and conflict-blocking reuse; real economics/history reconciliation remains |
| public.card_sale_hierarchy_snapshots | sale_id, ancestor_staff_id | Candidate card_sale_hierarchy_snapshots; field/state/key parity NOT REVIEWED |
| public.card_sales | id | Candidate card_sales; field/state/key parity NOT REVIEWED |
| public.cms_document_versions | id | Deferred CMS history; keep disabled; bigint range/string adapter: id |
| public.cms_documents | key | Deferred CMS history; keep disabled |
| public.cms_media_assets | id | Deferred CMS history; keep disabled; bigint range/string adapter: size_bytes |
| public.cms_page_sections | id | Deferred CMS history; keep disabled |
| public.cms_page_versions | id | Deferred CMS history; keep disabled; bigint range/string adapter: id |
| public.cms_pages | id | Deferred CMS history; keep disabled |
| public.commission_rules | id | Reviewed 15-field source definition, generated typed-target FK parity and alias-safe target_id; exact rate/date history; overlapping active ranges block; no frozen commercial recompute |
| public.commissions | id | Candidate commissions; field/state/key parity NOT REVIEWED |
| public.customer_application_documents | id | Business metadata + private-file ownership adapter |
| public.customer_application_holders | id | Candidate customer_application_holders; field/state/key parity NOT REVIEWED |
| public.customer_application_purchase_terms | id | Candidate customer_application_purchase_terms; field/state/key parity NOT REVIEWED |
| public.customer_applications | id | Candidate customer_applications; field/state/key parity NOT REVIEWED; composite foreign-key adapter required |
| public.customer_import_jobs | id | Candidate customer_import_jobs; field/state/key parity NOT REVIEWED |
| public.customer_import_rows | id | Candidate customer_import_rows; field/state/key parity NOT REVIEWED |
| public.customer_onboarding_tokens | id | Exclude active credentials; review VIP activation reissue separately |
| public.customers | id | Candidate customers; field/state/key parity NOT REVIEWED |
| public.departments | id | Reviewed reference definition; full column/type/PK/CHECK/unique metadata coverage and exact reuse proven; history conflicts/full reconciliation remain |
| public.earning_claims | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_requested, points_awarded, points_capped, points_per_unit_snapshot, max_award_snapshot |
| public.final_qualifications | id | Candidate final_qualifications; field/state/key parity NOT REVIEWED |
| public.identity_documents | id | Reviewed 18-field metadata, subject/FK/status/size/MIME/hash checks; staged transfer gate; real archived-byte copy/link/replay proven in disposable local rehearsal only |
| public.memberships | id | Candidate memberships; field/state/key parity NOT REVIEWED; bigint range/string adapter: points_balance |
| public.modules | id | Reviewed reference definition; full column/type/PK/CHECK/unique metadata coverage, int32 validation and exact reuse proven; full reconciliation remains |
| public.network_member_profiles | staff_id | Complete 23-field profile definition; native staff unique key, three references, source CHECKs, owner exclusion and disposable replay covered; address/file reconciliation remains |
| public.ost_applications | id | Reviewed source status/JSON/unique/FK metadata and historical native reads; public registration stays disabled |
| public.ost_members | id | Reviewed staff/auth identity binding, historical state/origin/keys and native indexes/replay; no automatic identity merge |
| public.payments | id | Candidate payments; field/state/key parity NOT REVIEWED; composite foreign-key adapter required |
| public.point_earning_rules | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_amount, max_award |
| public.point_redemption_rules | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: min_points, max_points |
| public.points_accounts | id | Candidate points_accounts; field/state/key parity NOT REVIEWED; bigint range/string adapter: balance, lifetime_allocated, lifetime_redeemed, reversal_debt, weekday_balance, weekend_balance |
| public.points_ledger | id | Candidate points_ledger; field/state/key parity NOT REVIEWED; bigint range/string adapter: id, amount, balance_after, balance_before, origin_award_id, weekday_delta, weekend_delta |
| public.points_periods | id | Candidate points_periods; field/state/key parity NOT REVIEWED; bigint range/string adapter: annual_points_cap, opening_balance, closing_balance |
| public.purchase_lines | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.purchase_payments | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.purchase_point_refunds | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_restored, ledger_entry_id |
| public.purchases | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.redemption_items | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_cost |
| public.redemption_quotes | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_requested, points_balance_snapshot, remaining_points_after, ledger_entry_id, weekday_points, weekend_points |
| public.redemptions | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_cost_snapshot, total_points, balance_before_snapshot, balance_after_snapshot |
| public.referral_codes | id | History-only legacy_referral_codes mapping; preserve source evidence without enabling referral capabilities; authorized hint fallback only |
| public.referral_relationships | id | Candidate referral_relationships; field/state/key parity NOT REVIEWED |
| public.reservation_agreement_documents | id | Business metadata + private-file ownership adapter |
| public.reservation_agreement_holders | id | Candidate reservation_agreement_holders; field/state/key parity NOT REVIEWED |
| public.reservation_agreement_schedule | id | Candidate reservation_agreement_schedule; field/state/key parity NOT REVIEWED |
| public.reservation_agreements | id | Candidate reservation_agreements; field/state/key parity NOT REVIEWED; composite foreign-key adapter required |
| public.role_permissions | role_id, module_id | Reusable reviewed access definition; column/PK/FK/types/CHECKs/native unique key covered; parent aliases/exact reuse proven; full reconciliation remains |
| public.roles | id | Reviewed reference definition; full column/type/PK/FK/CHECK metadata coverage, department aliases and native name uniqueness proven; history conflicts/full reconciliation remain |
| public.service_catalog | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.service_refund_repayments | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.service_refunds | id | Disabled Services/Redemption history adapter; do not enable routes; bigint range/string adapter: points_restored, earned_points_adjusted |
| public.service_tier_discounts | id | Disabled Services/Redemption history adapter; do not enable routes |
| public.staff_invitations | id | Exclude; no invitations |
| public.staff_permission_restrictions | staff_id, module_id | Reusable reviewed access definition; column/PK/FK/types/CHECK/native unique key covered; reuse/owner protection proven; full reconciliation remains |
| public.staff_role_assignments | staff_id | Reusable reviewed access definition; column/PK/FK/types/native unique key covered; assigned_at rename/owner exclusion/new assignment/replay proven; identity and full reconciliation remain |
| public.staff_users | id | Full 13-field business definition and explicit ID/email auth-FK gate; owner excluded; credential/provider state and counters remain separate |
| public.tier_points_config | tier | Full four-field definition; positive safe-integer cap, legal tiers, actor alias and strict reuse; separate validator/index proposal local-only |
| storage.buckets | NONE - explicit key adapter required | Storage policy/configuration review; never auto-provision; bigint range/string adapter: file_size_limit |
| storage.objects | NONE - explicit key adapter required | Private-file adapter: bytes, checksum, ownership and native metadata |

Inventory SHA-256: `57b1e525f103306c5df93684b912277a5b43ed0e4dfab33d76717f3483a46b07`.

Before apply: review every native adapter, identity alias, partial unique rule, exact money, bigint points and timestamp representation. Reconcile counts, immutable snapshots, verified settlement, commissions, weekday/weekend points and private-file checksums. No generic copy-all or live importer is enabled.
