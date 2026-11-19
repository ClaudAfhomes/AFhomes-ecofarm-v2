# Native migration preparation - 2 November 2026

Superseded scope (3 November): the owner chose native MongoDB without importing
or combining Supabase history. This document records historical preparation;
its migration conflicts are not active runtime blockers. Preserve both databases
and archives. See [native readiness](NATIVE-READINESS-2026-11-03.md).

Work remains on `claud/mongodb-conversion`. This continuation used the approved
31 October encrypted source capture, not a new live export. Supabase and Atlas
business records, accounts and permissions were not changed. Browser acceptance
remains last; local backup storage remains the owner's selected arrangement.

## Completed preparation

- Eighty-three reviewed definitions (44 domain adapters and 39 empty-source guards)
  now cover organization/access,
  staff/network profiles, catalog, tiers, genealogy/accreditation history,
  customers, memberships/points, financial history, official forms/documents,
  imports, audit history, commission rules/policy snapshots, identity-document metadata and legacy OST history (including two explicit empty-source guards).
  Full columns, keys, nullability and scalar declarations are checked against the
  recorded SQL inventory. Composite application/terms/reservation links are
  checked separately in source reconciliation.
- The authenticated archive decodes **420 rows across those 83 definitions** with no
  schema or scalar errors. Bigint identifiers retain their original decimal text;
  integer quantities are converted only inside the declared safe range. Original
  timestamp text and historical JSON are retained. Unsupported/lossy numeric
  values block output. SQL text arrays retain their original values and ordering.
- Source membership mirrors, weekday/weekend allowances including reversal debt,
  period/origin references and latest ledger balances reconcile without repairs.
  Exact microseconds and bigint IDs determine ledger ordering.
- Source financial reconciliation counts verified payments only, checks customer
  and reservation/sale links, compares frozen commission amounts and checks
  active-sale payment/membership consistency. It does not derive historical prices,
  commissions or ancestry from today's catalog or organization.
- Two source sales have no frozen ancestry snapshots. They remain flagged
  `HISTORICAL_ANCESTRY_NOT_PRESENT`; no current genealogy was substituted.
- Application, purchase-term, reservation, holder/schedule and document links
  reconcile. All **18 stored document payloads** validate unchanged after the
  historical-read compatibility correction below.
- Disposable component tests load mapped membership/points, financial and form
  history under native indexes/validators and prove an identical empty replay,
  baseline preservation and unchanged input snapshots. Their prerequisite parent
  rows are fixtures; these are not a complete real-data native workflow rehearsal.

## Historical document compatibility correction

Real source review found five payloads rejected by the current strict response
schema: three reservation documents retained historical signature statuses, and
two membership documents retained their tier/activation time. Removing these keys
would rewrite frozen evidence.

The read contract now explicitly accepts these optional historical fields. The
reservation write forms and signature controls stay unchanged. Unknown private
fields remain rejected, including credentials, government IDs and storage paths.
New native membership evidence now captures tier from its frozen purchase terms
and activation time from its membership record; older native evidence without
those fields still reads. No existing evidence record was updated.

## Private-file reference review

All ten file bytes remain in the authenticated encrypted archive. Nine have
verified current source business links: **two identity documents and seven profile
photos**. Their source subjects, sizes, MIME/signatures and SHA-256 evidence check
out. No native ownership metadata was created and no existing object was replaced.

One file in `afhomes-customer-ids` has no matching identity-document/payment link
or matching path in the captured business rows. Its bytes are preserved in the
archive. It is marked `UNLINKED_SOURCE_OBJECT_REQUIRES_REVIEW`; do not infer an
owner from its name, publish it, delete it or attach it to another customer.
The combined source review deliberately exits nonzero for this unresolved file.

Safe aggregate evidence is in SOURCE-TYPED-REVIEW-2026-11-02.json. To repeat:

```powershell
pnpm exec tsx api/scripts/capture-migration-source.ts review supabase-source-20261031025201873-70d38a5e0477432396c3988e253154c3.afsource
```

## Verification and remaining scope

### Commission rules and historical policy settings

The complete 15-column commission-rule declaration preserves exact rate text,
source effective/accreditation dates, flags and timestamp evidence. Source
generated target_role_id/target_staff_id/target_ost_id must match the target type
and original target_id. Their FK aliases are resolved before native target_id is
set to the same resolved ID; this prevents a reused role or protected staff alias
from leaving a stale source UUID in native rate queries. Invalid target shapes,
rates and dates block output. Active overlapping date windows are checked against
both planned rules and existing target rules, including on an identical replay.
Existing sales/terms/commission snapshots are never recomputed or updated.

The source public-verification and staff-security policies are mapped strictly to
**migration_source_public_verification_settings** and
**migration_source_staff_security_policy**. Full source columns, keys, scalar
types and source CHECKs are reviewed; source text and exact timestamp evidence
stay historical. Attempts to target the active native policy collections fail.
No source privacy approval, support/bank details, retention, daily-limit flag,
cleanup-job state or MFA requirement is applied to runtime configuration. MFA
remains off as requested; existing native policy and administrator remain intact.
These new private history collections require future reviewed schema/apply work;
none was created in Atlas. Privacy-search log retention/disposition remains a
separate preparation task, not covered by these two settings snapshots.

Source-free review reconciles the one archived commission rule and two policy
records. Disposable tests prove exact metadata/FK coverage, rate preservation,
role/protected-staff target aliasing, overlap and unsafe destination denial,
native rate lookup, identical replay and unchanged current privacy/MFA policy.
Fresh verification: all **125 migration-focused tests across 19 files pass**;
the adjacent public-search/cleanup/rules run passes eight tests (including the
four rules tests already counted above). API and capture-script typechecks,
scoped ESLint, environment isolation and whitespace checks pass. Browser/full
platform acceptance and shared database applies were not run.

### Audit history continuation

The eleven-field audit definition retains PostgreSQL bigint IDs as exact text,
original JSON payloads, historical entity identifiers/reasons and exact timestamp
evidence. Source actor references belong to auth.users, not exclusively staff:
customer actors and null actors are legal. Explicit ID/email auth snapshots must
resolve every non-null actor before native planning; missing/conflicting target
identities block output. Only the top-level protected source actor is remapped
to its reviewed target identity. Nested original evidence is never relabelled.
Existing native audit rows and the protected administrator remain unchanged.

Known credential/government-ID field keys and selected reusable-credential value
patterns block planning with safe issue codes. These are targeted checks, not a
claim to detect every possible private value inside free text. Flagged payloads
would stay unchanged in the encrypted source archive pending review; the mapper
does not silently redact, publish or discard them. The approved capture's **148
events pass** these checks and their source actor references. No live audit rows
were imported. Disposable tests cover exact metadata/auth FK, protected actor
aliasing, customer/null actors, private-evidence denial, unchanged raw history,
native append/replay and existing-record preservation.
The final migration/document/photo continuation passes **134 tests across 20
files**, API and capture-script typechecks, scoped ESLint, environment isolation
and whitespace checks. Full-platform/browser acceptance was not run.

### Identity-document transfer and profile-photo preparation

The 18-column identity-document definition covers exact metadata/FKs, mutually
exclusive customer/OST-application subjects, permitted MIME/statuses, checksums
and safe positive byte sizes. Original extraction/review JSON and timestamp
evidence remain intact; actor and subject aliases are explicit. Both archived
metadata rows reconcile. Mapped rows receive `migration_file_transfer_required`.

The canonical current-document query and VIP lookup path query exclude these
staged rows. Their authenticated summary reports no active file, and download,
completion, OCR and review mutations return conflict until transfer verification.
Existing native documents without the marker retain their workflow. The marker
cannot be cleared by any public migration endpoint.

`planMigrationDocumentFiles` requires explicit document and subject aliases and
unchanged metadata. It chooses deterministic native private keys. The existing
exclusive copier refuses overwrites; `verifyMigrationDocumentLinks` then requires
the approved metadata digest and actual source/target checksum, MIME and size
readback before returning proposed active metadata. It performs no DB writes and
binds each proposal to its pre-transfer record fingerprint. Source paths remain
as historical evidence after linking.

The new source-free `verify-documents` CLI rehearses this flow using a new empty
loopback namespace and self-created temporary file store. It mapped, copied,
read back and transactionally linked **both actual archived ID files**; an identical
file-copy replay reused them. Original evidence and the synthetic protected
reference owner stayed unchanged. No auth users/accounts were created. Temporary
files and replica were cleaned up; no Supabase/Atlas connection or application
private-storage directory was used. The synthetic reference owner is not a real
administrator or authentication migration.
The actual archived document records also pass native detail-read response
contracts with their historical extraction/review fields. That read uses a
synthetic reference authorizer and request/response adapters, not real sign-in;
the report explicitly keeps authentication acceptance false.

Safe evidence: SOURCE-DOCUMENT-REHEARSAL-2026-11-02.json. Repeat with:

```powershell
pnpm exec tsx api/scripts/capture-migration-source.ts verify-documents supabase-source-20261031025201873-70d38a5e0477432396c3988e253154c3.afsource
```

The rehearsal explicitly leaves eight other private files outside its scope:
seven photos and the one unresolved object. It does not certify all-file cutover.

New unmounted profile-photo planners require exact source/target ID/email and
business-identity links, original storage metadata/timestamp evidence, and valid
bounded JPEG bytes. They exclude the protected source administrator's photo so
the native owner profile cannot be overwritten. Other existing native photos are
also preserved: only an exact prior migration result is reusable; a different
photo blocks the plan. Source/target byte readback must pass before proposed
metadata is returned. Identical native metadata produces no replacement on
replay. These photo checks are proven with synthetic local files and native
owner-unique indexes; no real photo or identity was imported.

Fresh migration/document/photo verification: **130 tests across 19 files PASS**.
API and explicit capture-script typechecks, scoped ESLint, environment isolation
and whitespace checks pass. Browser acceptance and a full API-suite rerun remain
deferred; no shared database, credential, deployment, commit or push changed.

### Legacy OST history continuation

Seven reviewed definitions cover old referral codes, applications, members,
registration details and accreditation terms, plus empty-source-only conversion
and renewal guards. The approved archive has two rows in each of the five populated
tables and no conversions/renewals. Source-only reconciliation passes for all ten
rows, their declared references and the shared OST/staff/auth identity IDs.

The mapper requires ID/email-only auth snapshots and matching staff bindings for
full OST member records. Wrong/missing target identities and same-email collisions
remain blocking; it cannot create identities, merge test accounts or alter the
protected owner. Original form data, payload hashes, source timestamps, sponsor
snapshots and historical accreditation dates remain intact. No current ancestry,
renewal or expiry date is substituted for history. Unknown new conversion/renewal
source rows fail closed rather than entering an unreviewed adapter.

Old referral codes map to **legacy_referral_codes**, not the active referral-code
collection. This new history collection/index setup still belongs to the reviewed
future import apply; nothing was created in Atlas. The existing authorized native
application reader can fall back to its code hint only. No hash is returned and
public registration/writes remain disabled. Source `is_active` is historical data
in this isolated collection, not an enabled native capability.

Disposable tests cover recorded column/PK/FK/unique/nullability/scalar metadata,
source CHECKs, protected owner, auth mismatch, empty-source guards, real native
accreditation indexes, identical replay, read authorization and disabled writes.
Wider regression found import/OST field checks wrongly validating ID-only parent
declarations used by other component fixtures. Checks now apply only to declared
fields; actual full reviewed records retain all their checks. Finance/forms,
mapping, import preparation and native applicant suites pass again (76 tests).
The subsequent complete migration-focused suite passes all 111 tests across 15
files. API and capture-script typechecks, scoped ESLint, environment isolation
and whitespace checks pass. No browser acceptance or shared apply ran.

### Import revalidation preparation continuation

The owner selected **revalidate and resume in MongoDB** for the one ready and two
validated source import jobs. The reviewed business manifest now includes both
import tables (32 tables / 254 captured rows overall). Source-free review reconciles
all three jobs and their 30 rows, including source counts and validation totals.

The mapper preserves original raw fields, normalized history, validation flags,
explanations, row IDs, job numbers and exact timestamp evidence. Declared actor,
customer, membership and sale references use the same explicit alias resolver.
Nested historical JSON is never recursively rewritten or trusted as authorization.
Every mapped job receives `migration_revalidation_required: true`; bulk confirmation
and direct row continuation reject it. Per-row transactional confirmation also
rechecks this gate. Existing native jobs without the marker retain their workflow.

`revalidateMigratedImportRows` is an **unmounted, no-write preparation helper**. It
rebuilds legacy row validation from original raw fields using the established
validator and an explicitly supplied current native context. It does not reuse
archived normalized customer IDs, external verification, or continuation tokens.
Fresh continuation/Finance review is still required. Original evidence is untouched.
Guided company-v2 workbooks require the original workbook because separate payment
and holder sheets cannot safely be reconstructed from flattened raw fields.

The native parse action now accepts `resumeJobId` for a pending migrated job.
It requires import create, view and update authorization, repeated inside the
write transaction. The user uploads the original or corrected workbook/CSV;
mutable Google Sheet links cannot supply archived revalidation. Existing parsing,
current MongoDB matching, continuation review and annotated-download generation
are reused. The no-write raw-field helper remains separate and unmounted.

One fresh review job is created and linked to the original evidence hash. Its
rows contain new validation, never archived normalized authorization. Original
rows, explanations, commercial state and actor remain unchanged; only lineage
metadata is added to the archived job. The archive's gate stays on and it cannot
be confirmed or cancelled. Identical concurrent retries return the same review
job and stored review notes; different requests against an already-linked archive
return conflict. Missing, incomplete, committed or changed source evidence also
blocks the transaction. Audit failure rolls back the new job/rows and lineage.

Job history exposes **Revalidate workbook** only with create/update permission,
then **Open revalidated job** after linking. The normal review, corrections,
download and confirmation workflow applies to the fresh job; successful parsing
never commits customer/payment/membership data. Original archive links retain the
first successor; later corrected uploads use the existing normal intake workflow.
Never clear the archive marker manually to bypass revalidation. No source jobs
were imported into Atlas, resumed, cancelled or committed. Disposable tests cover native import
indexes, deterministic replay, owner preservation, current identity resolution,
and HTTP rejection without customer/sale/payment/membership/account creation.

The mapper also supports an explicit `requireEmpty` snapshot guard. Any future
nonempty source table under that guard blocks the plan and needs a real mapping
review; it does not clear or disable native target tables.

Fresh continuation verification: 128 tests across import preparation, native
commit/continuation and workbook validation pass; the 55 existing mapper regression
tests also pass. API typecheck, explicit capture-script typecheck, scoped ESLint,
environment isolation and scoped whitespace checks pass. The full API suite and
browser acceptance were not rerun for this continuation. Archive review still
deliberately returns a failure exit status for the unlinked private file.

Resume-action continuation: 50 native API/preparation tests, 17 Admin UI/cache
tests and all 317 contract tests passed. Native HTTP tests prove concurrent
idempotency, unchanged archived job/row evidence, audit rollback, an anonymous
denial, blocked original confirmation/cancellation and successful explicit
confirmation of the successor review. UI tests prove selection/permission
behavior. These synthetic tests use disposable MongoDB only; they are not
browser acceptance or a real-data cutover rehearsal.
Repository typecheck, both SPA production builds, environment isolation, scoped
ESLint and whitespace checks passed for this continuation. Existing bundle-size
warnings remain. No deployment, shared database write, commit or push was run.

- Targeted API/component/purchase HTTP gate: 26 tests passed.
- Complete contracts suite: 317 tests across 23 files passed.
- Repository typecheck and explicit capture-script typecheck passed.
- Full API suite: **3,227 tests / 208 files PASS**, run with one worker in
  1,103 seconds. The two newly added file-binding tests were run separately and
  passed; a final forms/file-binding continuation also passed all six tests.
- Repository production build PASS, with the existing bundle-size warnings.
- Scoped ESLint, environment isolation and scoped whitespace checks PASS.
- A fresh read-only `afhomes_dev` inspection found 66 collections, all 48
  reference collections and their expected indexes present, six installed
  validators, no broken declared references, and no listed money/membership/
  points inconsistencies. Two memberships were checked. These checks do not
  certify migration completion or authentication/browser acceptance.
- The readiness CLI now reads its own ignored `.env.local` explicitly, so an
  inherited process environment cannot silently select a different connection.
- Overall archive review: business decoding/reconciliation PASS; private-file
  ownership coverage BLOCKED by the single unlinked file; native import NOT READY.

## Final continuation checkpoint

All 93 captured tables / 595 rows have explicit dispositions. Eighty-three
declarations decode 420 rows; 39 are empty-source guards, not implemented support
for future nonempty data. Unknown tables and new rows in guarded tables block.
Old mutation receipts, onboarding credentials and privacy-search PII/cooldowns
stay archive-only. Source privacy approval never grants consent on a new host.
The disabled redemption catalog stays history-only. VIP retirement records keep
their original owner as evidence even when that customer no longer exists.

The reviewed three test-account aliases retain current native passwords, profiles,
roles and photos. The read-only existing-dev merge still blocks 55 reference
conflicts, five uniqueness conflicts and one record conflict. No grant, price,
points cap, current genealogy, AA identity or customer identifier is overwritten.

`verify-native` instead rehearses the source alone in a new guarded loopback
namespace, with a separate synthetic protected owner and no development business
data merge. It loads **418 business/history rows and nine eligible identities**,
initializes **three nondecreasing counter high-water marks**, reconciles all mapped
records and exact replay, and proves the synthetic owner credential/profile are
unchanged. It transfers all **seven original profile photos**, verifies original
and copied bytes before native links, then proves an empty metadata replay.
Two ID files have separate real archived-byte transfer/link/read-contract proof.
The original unlinked tenth object remains encrypted/unassigned, never guessed.

Actual full-source execution under the installed core validator definitions found
paired NULL legacy weekday/weekend ledger deltas rejected by the native integer
properties. Source SQL explicitly permits that pair. The new unmounted
`proposedMigrationCoreValidators` preserves both unknown values, permits native
legacy absent pairs, and rejects partial, fractional or inconsistent numeric
splits. It does not invent a 70/30 historical allocation or alter totals. The
source-only rehearsal passes with these six local proposals; **the Atlas validator
is unchanged and the points-ledger cutover proposal still requires reviewed apply**.

The separately approved native VIP setup is applied, with two native issuance
records, a unique index, enabled marker, nondecreasing counter and one audit.
Before/after encrypted BSON comparison confirms only those three approved
collections changed. Fresh independent restore passes: 67 collections, 441 rows,
18 private files. Existing users/passwords/roles/business records are untouched.
See VIP-ISSUANCE-SETUP-VERIFICATION-2026-11-02.json.

No Supabase source data has been imported to Atlas. Remaining cutover gates:
reviewed target/merge strategy and actual shared apply, unresolved file ownership,
real identity authentication and browser workflow acceptance, final load/cache
verification and production hosting/storage/key-recovery choices. Data rehearsal
is not proof of every active application flow. No commit, push or deployment ran.

Fresh continuation verification: **141 tests / 25 files PASS**, covering migration,
VIP safeguard and performance-index checks. The adjacent import-commit run passed
all **35 tests** including three shared VIP tests. The measured five indexed query
cases reduce examined documents from 10,000 each to 0, 50, 50, 100 and 1 while
retaining their results; this is query-plan proof, not a production concurrency
load test. Repository typecheck, scoped ESLint and environment isolation pass.
Both SPA production builds pass from valid Turbo cache; existing bundle warnings
remain. The earlier 3,227-test full API run was not rerun for this checkpoint.

Repeat the encrypted-source-only rehearsal (no source/Atlas connection):

```powershell
pnpm exec tsx api/scripts/capture-migration-source.ts verify-native supabase-source-20261031025201873-70d38a5e0477432396c3988e253154c3.afsource
```

It refuses a shared, non-loopback or nonempty namespace before reading credentials.
The command itself creates and stops its own replica set and temporary private
photo directory. Output contains aggregate results/safe issue codes only.

## Preserve-both continuation and final local checks

The owner selected preservation of both datasets. The source-only rehearsal is
not an approved replacement for native business data. A digest-bound metadata
candidate handles 46 reference differences while retaining native values and
complete source-row evidence. Stale, unused, duplicate and security/economic
decisions fail closed. Prices, role activation, grants and caps cannot be bypassed.
After typed comparison the three cap values match. No Atlas references/history
collections were written. Fifteen issues remain: nine missing role department
links, five unique business keys and one ledger-ID collision. The read-only report
prepares missing-only department fills; no update is authorized by generating it.
See CUTOVER-REVIEW-2026-11-02.md.

The source-only rehearsal now initializes **four** counter high-water marks,
including BSON int64 points-ledger. A native allocator probe reproduced the prior
collision and now verifies an unused next ID, rolling the probe back. Original
ledger rows remain unchanged; two tests cover values above 2^53 and existing
high-water preservation. This fixes future appends, not the current ID-1 merge
collision. SOURCE-NATIVE-REHEARSAL-2026-11-02.json records the fresh result.

Full workspace runs: API **3,271 / 221 files**, Admin **1,021 / 111**, web
**267 / 23**, contracts **317 / 23**, shared **56 / 7**, config **7 / 1**, UI
**237 / 35**: **5,176 tests**, all passing. Later unmounted migration-only changes
were checked separately (140 migration tests / 24 files and a fresh archived-source
rehearsal); overlapping focused runs are not added to the full-run total.
JSDOM scroll/navigation/media warnings do not establish browser behavior.

Cache fixes, HTTP/private-file load, immediate authorization changes, concurrent
points and import retries are in PERFORMANCE-CHECKPOINT-2026-11-02.md. These are
local measurements, not production capacity. The read-only points-ledger proposal
accepts the current row and rejects --apply before loading configuration.
