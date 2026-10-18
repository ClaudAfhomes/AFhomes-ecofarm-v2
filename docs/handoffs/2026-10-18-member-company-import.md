# IST / OST company workbook implementation — local review packet

Release: **PENDING AUTHORIZATION**. No stage, commit, push, merge, deployment,
live SQL writes, live Auth mutation or production import was performed. Only
the separately approved read-only live preflight was executed.

## Baseline and scope

- Worktree: `C:\Users\SSD-CLAUD\Documents\AFhomes-member-company-import`.
- Branch: `feat/member-company-import-20261018`.
- HEAD and read-only verified `origin/claud/develop`:
  `9f44ecc50744a6501a4df0b966b4f7d525bf4530`.
- Preserve the original VS Code checkout and its unrelated changes.
- Originals in Downloads were opened read-only. The final corrected blank uploads
  now replace the earlier sanitized derivatives in `packages/contracts/assets/`
  byte-for-byte (hashes and verification below). They have compatible headers,
  no populated member rows, VBA or external relationships.
- Reuses Members endpoints/dialog, shared contracts, the existing bounded OOXML
  reader/writer, address/postal provider, canonical staff/profile/genealogy tables,
  existing AA allocator and OST submit/install transactions. Customer import and
  the older OST pending-application import remain intact.

## Approved clarification and compatibility

The owner clarified on 2026-10-18 that IST is a company employee identity, not
annual accreditation. New IST creation/import and OST→IST conversion now issue
AAI without recording start/expiry dates. Existing legacy dates and histories
are retained. OST still requires its actual annual term and verified signatures.
Manual OST CREATE remains SM-only with its complete active SSM/VD chain.

The existing private number registry remains canonical; no competing employee or
OST directory was added. Nullable dates are permitted for IST only. Legacy wire
status `accredited` remains for compatibility; updated screens call IST an
employee identity and hide accreditation dates/renewal. Legacy response dates
remain available without making them an employment expiry. Employee revocation
must use the established account/access workflow, not accreditation revocation.

New AAI uses the existing allocator's actual issuance month. Manual/historical
numbers retain their exact uppercase value. The same allocator now also considers
retired numbers when finding the shared monthly high-water mark.

The updated branch's shared name helper preserves capitalization. Import applies
the owner's explicit uppercase storage instruction after shared validation,
without changing the shared helper or rewriting existing names. Display casing
is conservative and cannot recover a person's original legal capitalization.
Mobiles normalize through `normalizePhilippinePhone`; Excel/preview use 09 text.

## Official layouts and every data-entry mapping

Version `company-v2` is detected by exact readable headers and kind. Technical
`row_key` workbooks retain their separate v1 new-account compatibility path.
IST entry tabs are Identity, Team and Details; no Accreditation/Application tab.
OST additionally has Accreditation. Both corrected files retain Date Helper. Teams has exactly
three columns. README, postal/PSGC indexes and head-search helpers are retained.
The corrected uploads already have blank entry values, no shared-string pools
or author metadata. Their formulas/helpers are preserved without sanitization.
Date Helper's static lists/instructions are retained; selected date parts are blank. Macro-free Excel cannot guarantee
a calendar popup. Excel/Sheets version-specific dropdown behavior needs UAT.

| Sheet / displayed column | Canonical field / handling |
| --- | --- |
| Identity: AAI Number / AAO Number | `aa_number`; uppercase, preserve issued value; manual when supplied |
| First Name | `first_name`; validated name, uppercase only on new persistence |
| Middle Name | `middle_name`; optional, same treatment |
| Last Name | `last_name`; same treatment |
| Email Address | `email`; canonical lower-case |
| Mobile Number | `mobile` for display; `canonical_mobile` / canonical creation phone for +63 storage |
| Date of Birth | `birth_date`; Excel 1900/1904 serial or accepted date text; shared birth-date validation |
| Age (Auto) | ignored; never persisted from workbook |
| Sex | `sex`; canonical creation contract |
| Civil Status | `civil_status`; canonical creation contract |
| Province / Region | `province`; existing provider resolves province code |
| City / Municipality | `city`; must belong to selected province |
| Barangay | `barangay`; must belong to selected locality; missing legacy MATCH data is not invented |
| Permanent Address Line 1 | `address_line_1`; canonical profile/address |
| Postal Code (Auto) | `postal_code`; cache is a candidate, validated against existing verified postal provider |
| Team: Applicant Name (Auto) | alignment evidence only, not a second identity |
| IST Position | `position`; Vice Director / Senior Sales Manager / Sales Manager → existing role slugs |
| OST Head Member Role | `head_role`; manual CREATE accepts SM only; existing lawful public referral records may MATCH unchanged |
| Head Member Name | `head_member`; unique name or name + AAI/UUID label resolves `head_staff_id` |
| Hierarchy Check (Auto) / Head Member Check (Auto) | ignored; server validates actual hierarchy |
| Search Head Member (All Rows) | UI helper only; never imported as a member |
| Details: Applicant Name (Auto) | same-row alignment evidence only |
| Government ID Type | `government_id_type`; readable labels map to canonical enum |
| Government ID Number | `government_id_number`; private creation input; omitted from ordinary exports/history summaries |
| TIN | `tin`; private creation input; omitted from ordinary exports/history summaries |
| Telephone | `telephone`; existing landline validation, not the mobile rule |
| Messenger | `messenger` |
| Employer Name | `employer_name` |
| Employer Address | `employer_address` |
| IST Job Position | `job_position`; absent in official OST layout |
| Accreditation: Applicant Name (Auto) | same-row alignment evidence only |
| Accreditation Start Date | `starts_on`; OST only |
| Accreditation Expiry Date (Auto) | `expires_on`; candidate checked against backend annual calculation |
| Date Applied | `date_applied`; actual stated date, not approval timestamp |
| Program Category | `program_category`; existing canonical enum |
| VIP Card Type | `vip_card_type`; existing tier rules |
| Applicant Signature | `applicant_signature`; claim requiring independent operator verification |
| Referrer Signature | `referrer_signature`; same boundary |
| Applicant Signed On | `applicant_signed_on`; actual date required for OST CREATE |
| Referrer Signed On | `referrer_signed_on`; actual date required for OST CREATE |

All entry tabs align by Excel row. Unexpected extra columns, orphan entry rows,
cross-row applicant formulas and mismatching literal applicant names are rejected.
Formula-only empty rows and E2 search input are not members. Uploaded formulas
are never evaluated. Limit: 500 members / current 8 MB reader budget.

**Alignment limit:** these original layouts contain no independent immutable row
keys. An independent tab sort followed by recalculation of same-row formulas
cannot always be detected. Review every applicant's team and profile in the web
preview; a formula is not proof of the original human association.

## Matching, hierarchy, confirmation and account boundary

- Server preview resolves existing registered heads and same-workbook IST parents.
  Ambiguous names, wrong roles, missing parents and cyclic/wrong-direction chains
  cannot become valid creation requests. Confirmation runs VD, SSM, SM, then OST.
- Source SHA-256, actor, kind and layout identify a durable job; repeated identical
  uploads return that same job. Rows have stable IDs and planned Auth UUIDs.
- AA alone never matches a person. Existing email, normalized name, role, number,
  phone, supplied protected profile values and genealogy are checked. Retired
  identifiers owned by another person conflict. Existing records are never
  silently updated, renumbered, transferred, renewed or reactivated.
- Stage decisions are CREATE / MATCH / REVIEW / CONFLICT. SKIP is reserved in the
  contract; no skip behavior is invented. MATCH confirmation only records the
  result; missing private export fields are not required or fabricated.
- Confirmation accepts only job/row IDs and explicit evidence verification, never
  replacement browser payloads. Actor/permissions, target-role grants, identity
  and parent are rechecked. Email, phone and AA claims prevent concurrent jobs
  from provisioning the same identity.
- A committed claim precedes Auth provisioning. The fixed UUID and server-owned
  `app_metadata.member_import_row_id` bind retries to this job; email equality
  alone never adopts an Auth account. Unknown lookups stop before creation.
- Historical import creates no invitation and returns no password. Its random
  undisclosed password and unconfirmed email do not grant login from an Excel
  identifier. Access needs the separately authorized existing reset/access flow.
- SQL installation is transactional. A failed row leaves no partial staff/profile,
  role, AA or genealogy writes. An uncertain Auth/SQL result retains a bound,
  inaccessible reserved account for the same job to resume; it is never blindly
  recreated or deleted. Fixed error codes and attempt counts persist for review.
- No signatures or sponsor endorsement are fabricated. Current operator approval
  is recorded now, while the imported dates remain historical claims. Incomplete
  evidence is REVIEW, not a completed accreditation or renewal.
- Job history is restricted to the owning authorized administrator and returns
  a safe projection, not raw private payloads or credential/provider logs.

## Persistence and RPC inventory

New private provenance tables: `private.member_workbook_jobs` and
`private.member_workbook_rows` (RLS enabled; no direct runtime-role table ACLs).

IST CREATE writes existing `public.staff_users`, `staff_role_assignments`,
`network_member_profiles`, `referral_relationships`, `audit_events`, and the
existing private AA registry/counter. It creates no accreditation term.

OST CREATE reuses `submit_ost_accreditation` and `install_direct_ost_password`:
existing `referral_codes`, `ost_applications`, private `ost_registration_details`,
`staff_users`, `staff_role_assignments`, `ost_members`, `referral_relationships`,
private `ost_accreditation_terms`, private AA registry/counter and audit records.
The import transaction also creates its normal `network_member_profiles` row,
so Members directory/detail reads include the reviewed OST profile. Signed
registration evidence stays separate; MATCH never backfills or rewrites records.
Auth is a separately reserved identity. Real local GoTrue acceptance is recorded
below; the PostgreSQL shim alone is not Auth proof.

New service-only RPCs: `issue_ist_employee_identity`, `stage_member_workbook`,
`get_member_workbook_jobs`, `claim_member_workbook_row`,
`install_member_workbook_row`, `record_member_workbook_failure`,
`export_member_workbook_profiles`. Private guards/matcher are not runtime-callable.
Existing management, lookup, allocator and conversion signatures are retained.
The OST install guard admits supported legacy AA- only for a sealed approved
OST import row; ordinary manual creation is not widened.

Protected financial/customer/member-card/points row counts are checked unchanged
by the disposable gate. No financial import mechanism is added.

## Export

Downloads use the official sectioned layout and authorized roster. Head choices
are current registered readable names with AA/UUID disambiguation. IST workbook
candidate formulas remain for first-time hierarchy imports. No hidden employee
sample records are embedded in blank assets.

Exports omit full TIN/government ID numbers, all passwords and tokens. OST dates
and signature claims use stored records; term history is stated in README rather
than represented as a new approval. Matched imports retain original records.
Newly imported name components are preserved from sealed provenance; older IST
records containing only a full name require a documented presentation split.
That split never overwrites the existing legal name/components on MATCH.
Normal exports cannot silently become a full-fidelity private migration export.

## Prepared migrations and operational impact

| File | SHA-256 | Proposed effects |
| --- | --- | --- |
| `20261208000012_afhomes_ist_employee_identity.sql` | `B081D4E71285D6B10A1F6B06E547C9FB7C0619C56C17FB80E76AB97B41CCD59A` | Allow date-free IST identity in existing registry/history; issue AAI without a term; retain legacy records; ignore IST expiry; conversion creates employee identity; allocator includes retired numbers |
| `20261208000013_afhomes_member_workbook_jobs.sql` | `1814E44F3B81F644E0FB5689877A23F6586F3BE9EC5CEA53A6D15B38E19F0F4B` | Private durable jobs, guarded staging/matching/claim/install/history/export; OST Members profile creation; scoped legacy OST ID compatibility |

Both are **prepared, not live-applied**. The owner subsequently approved only
read-only preflight on 2026-10-18: live history has 95 entries through migration
11; migrations 12/13 and their import tables are absent. The original local-only
restriction was not interpreted as approval to apply anything. Do not replay the
11 unrelated older history-missing migrations. No applied migration was rewritten.

`docs/supabase/CURRENT-SCHEMA.sql` was regenerated using the existing script:
108 migration files, 60 public tables. It is context-only and must never be run.
Fresh history/function/constraint/ACL compatibility checks and scoped approval are
required before any apply. Apply reviewed prerequisites in order before enabling
company import in a coordinated application release. Missing new RPCs fail closed;
there is no unsafe fallback to client account creation for company workbooks.

## Verification and remaining acceptance work

| Check | Result |
| --- | --- |
| Complete API suite, correct API working directory | 2,467 / 2,467 passed |
| Complete contracts suite | 313 / 313 passed |
| Members/workbook/identity/conversion component suites | 56 / 56 passed |
| Public seller lookup component suite | 8 / 8 passed |
| New real disposable PostgreSQL import gate | 78 / 78 passed; includes forward-upgrade preservation, OST profile regression and six RLS invariant queries returning zero rows |
| Existing real disposable OST lifecycle gate | 177 / 177 passed |
| TypeScript API, contracts, admin, web and Supabase | passed |
| Scoped admin/web ESLint | passed |
| Admin and web Vite builds | passed; existing large-chunk warnings remain |
| Web static SEO prerender | 12 public routes generated locally |
| Tracked diff whitespace check | passed |
| Final targeted importer/API rerun after blank-tail compatibility refinement | 91 / 91 passed |
| Real local Auth/API + authenticated Chrome import workflow | PASS for synthetic IST hierarchy and OST; see acceptance evidence below |
| Real local recovery email, one-use link, password login and portal authorization | passed for IST and OST with loopback SMTP capture; no external email |
| Desktop Excel / Google Sheets interaction | NOT VERIFIED; owner requested manual Excel checklist and explicitly left Sheets unverified |

The 500-row parser/export assertions remain intact. A slow test-fixture builder
was replaced with per-row XML editing after its initial timeout under parallel
load. An API retry launched from the wrong working directory failed legacy
relative-path tests; the correct-directory full rerun above passed without
changing those tests. Component tests emit existing jsdom scrollTo notices.

Unit/component tests are not authenticated browser proof. No new packages were installed; existing
local dependencies were reused through ignored workspace-local links. Direct local
Node binaries avoid pnpm auto-install behavior in this isolated dependency layout.

Still required before release approval:

1. Review both forward migrations and all identity/history compatibility changes.
2. Complete the manual Excel checklist below. Real local reset/access and one-use
   recovery delivery now pass; external/provider email delivery remains unverified.
3. Coordinate application deployment with the two database changes. Approved
   read-only live preflight passed the measured compatibility checks; this does
   not authorize or prove hosted deployment, live apply or provider mail delivery.
4. Google Sheets interaction remains explicitly unverified per owner direction.
   OOXML parsing and Excel results must not be described as native Sheets proof.
5. Separately authorize any Git integration, live migration, Preview push/deployment
   and production actions. No such action is inferred from this report.

## Commands and changed-file inventory

Commands used existing local Node binaries; package installation was not needed. Run tests from their package directory (legacy API tests depend on the working directory).

```powershell
# From api/ and packages/contracts/ respectively
node node_modules/vitest/vitest.mjs run --maxWorkers=2
# From apps/admin/
node node_modules/vitest/vitest.mjs run src/features/network-members/MemberWorkbookDialog.spec.tsx src/features/network-members/MembersPage.spec.tsx src/features/afhomes/SaleTeamAccreditationCard.spec.tsx src/features/network-members/MemberDetailDialog.spec.tsx src/features/network-members/TransferToIstDialog.spec.tsx --maxWorkers=1
# From apps/web/
node node_modules/vitest/vitest.mjs run src/marketing/pages/SaleTeamSearch.spec.tsx --maxWorkers=1
node scripts/prerender.mjs
# From root; disposable data directory was checked to remain within this worktree
$env:AFHOMES_TEST_PG_PORT='55434'
node packages/db-testing/scripts/test-member-workbooks.mjs
node packages/db-testing/scripts/test-ost-lifecycle.mjs
node scripts/update-schema-index.mjs
git diff --check
# Typechecks used node node_modules/typescript/bin/tsc --noEmit -p <package>
# Builds used node node_modules/vite/bin/vite.js build in each app directory
# Scoped lint used the existing local ESLint binary with only changed app paths
```

| Path | Purpose |
| --- | --- |
| `api/_handlers/members.spec.ts` | Members endpoint regressions, protected job boundary and safe sectioned export. |
| `api/_handlers/members.ts` | Remove automatic IST term dates while retaining canonical manual creation and legacy RPC compatibility. |
| `api/_lib/customer-xlsx.ts` | Optional discarded-formula observer and namespace-prefix-compatible worksheet relationship lookup; existing defaults retained. |
| `api/_lib/member-company-workbook.spec.ts` | Official layout, 500-row parse/export, alignment, hierarchy, mobile and round-trip regressions. |
| `api/_lib/member-company-workbook.ts` | Official asset rendering, readable head choices, bounded row parser and sectioned export values. |
| `api/_lib/member-workbook-export.ts` | Permissioned safe canonical roster projection into official sheets; no private identification values. |
| `api/_lib/member-workbook-handler.ts` | Official template/export routing, versioned preview and server-sealed durable staging. |
| `api/_lib/member-workbook-jobs.spec.ts` | Auth ownership, uncertain lookup/outcome and resume safety tests. |
| `api/_lib/member-workbook-jobs.ts` | Own-job endpoints and reserved-UUID Auth/install resume boundary; no invitation/password output. |
| `api/_lib/member-workbook-layout.ts` | Exact official human-header mapping and role/ID labels. |
| `api/_lib/member-workbook-preview.ts` | Shared validation, canonical identity candidates, same-workbook heads, format normalization and safe existing-record review. |
| `api/_lib/member-workbook.ts` | Explicit readable company-v2 dispatch alongside technical-v1 compatibility. |
| `apps/admin/src/features/afhomes/SaleTeamAccreditationCard.spec.tsx` | Date-free IST identity UI/confirmation regression. |
| `apps/admin/src/features/afhomes/SaleTeamAccreditationCard.tsx` | Employee identity presentation and date-free issuance; OST accreditation remains separate. |
| `apps/admin/src/features/network-members/MemberDetailDialog.tsx` | Employee identity labels and issuance result copy. |
| `apps/admin/src/features/network-members/MemberWorkbookDialog.spec.tsx` | Durable hierarchy-order confirmation and retained legacy creation regression tests. |
| `apps/admin/src/features/network-members/MemberWorkbookDialog.tsx` | Durable preview, safe profile review, ordered confirmation, progress, resume and job history. |
| `apps/admin/src/features/network-members/TransferMemberDialog.tsx` | Correct current IST employee identity label. |
| `apps/admin/src/features/network-members/TransferToIstDialog.tsx` | Remove false one-year IST validity copy; preserve OST expiry conversion gate. |
| `apps/admin/src/features/network-members/services.ts` | Typed own-job reads and row confirmation calls. |
| `apps/web/src/marketing/pages/SaleTeamSearch.tsx` | Employee identity wording and no IST accreditation expiry. |
| `docs/AFHOMES-BUSINESS-RULES.md` | Append the owner clarification; preserve earlier source history. |
| `docs/handoffs/2026-10-18-member-company-import.md` | Review packet, field mappings, outcomes, limitations, checksums and changed-file inventory. |
| `docs/supabase/CURRENT-SCHEMA.sql` | Regenerated context-only schema inventory/manifest. |
| `docs/supabase/MIGRATION-APPLICATIONS.md` | Explicitly NOT APPLIED local preparation entry, evidence and coordinated-release requirement. |
| `packages/contracts/assets/member-ist-template-v2.xlsx` | Final corrected blank IST upload, preserved byte-for-byte with formulas, dropdowns, geography and Date Helper. |
| `packages/contracts/assets/member-ost-template-v2.xlsx` | Final corrected blank OST upload, preserved byte-for-byte with accreditation, helpers, dropdowns and geography. |
| `packages/contracts/src/schemas/member-workbook.ts` | Presentation helpers, typed durable job responses and optional preview job ID. |
| `packages/contracts/src/schemas/sale-team.spec.ts` | Date-free employee identity and mandatory OST validity regression. |
| `packages/contracts/src/schemas/sale-team.ts` | Nullable IST identity dates; OST dates remain mandatory; employee access is not accreditation revocation. |
| `packages/db-testing/scripts/test-member-workbooks.mjs` | Real disposable PostgreSQL persistence, matching, conflicts, concurrency, rollback, claims, RLS and protected-count checks. |
| `scripts/sanitize-member-template.ts` | Legacy offline sanitization for the earlier layouts; not run on the final corrected uploads. Never edits originals. |
| `supabase/migrations/20261208000012_afhomes_ist_employee_identity.sql` | Forward-only proposed employee identity/OST lifecycle separation with preserved history. |
| `supabase/migrations/20261208000013_afhomes_member_workbook_jobs.sql` | Forward-only proposed private durable import mechanism and controlled legacy OST identifier support. |

34 task paths are modified/untracked in this isolated worktree; index empty and HEAD unchanged. Original checkout remains at its 11 preserved unrelated paths. Nothing was staged, committed, pushed or merged.

## Conditional-approval safety review - 2026-10-18

The owner approved proceeding only when safe and functional. No remote release action has been taken. Further review reproduced a legacy-phone mismatch: an existing 09 number was incorrectly held instead of matching the equivalent canonical +63 number. The matcher now recognizes both exact approved formats across IST profiles, OST members and pending applications, without rewriting legacy records. Tests also reject another person using either spelling of that same phone.

OST MATCH now checks supplied dates against a recorded term and compares supplied profile/signature claims against stored registration facts. An unrecorded renewal or changed signature date is a CONFLICT, not a successful historical match. Existing terms and personal records remain untouched.

Auth recovery now holds a lookup returning both user data and an error, and re-verifies creation responses reporting errors against the reserved UUID and server-owned marker. Fresh full API suite: 2,467/2,467 passed; targeted review tests: 83/83 passed; disposable PostgreSQL: 70/70, including RLS and protected financial counts. API typecheck and diff whitespace checks passed.

The Docker blocker was resolved by the owner starting Docker Desktop. The local
acceptance results below supersede that earlier blocked status. No
production-readiness claim is made.

## Real local Auth and browser acceptance - 2026-10-18

Used Docker Engine 29.8.2 and already-cached images `postgres:18-alpine`,
`supabase/gotrue:v2.196.0` and `postgrest/postgrest:v14.17`. No image pull or
package install occurred. Only task-owned containers/network were created;
ports were bound to 127.0.0.1. Temporary configuration, synthetic credentials,
fixtures and scripts stayed under ignored `.tmp-bin/member-acceptance/`.
No live environment file or live credentials were loaded. GoTrue configuration
was checked against its official versioned `example.env` upstream. The local
gateway restricts browser CORS to the local test origins.

- The real Auth schema was created by GoTrue; all 108 repository migrations
  were installed in the isolated local database. Only storage objects/helpers
  were supplied by the existing platform shim; no Storage delivery service ran.
- Real password login resolved an Admin principal through the actual API.
  The fresh baseline Admin has OST registration create/update disabled: OST
  confirmation was denied before Auth creation. Enabling those two permissions
  only in the disposable local role fixture allowed the intended Admin path.
  No repository default or live role permission was changed.
- Actual Admin production-mode build in Chrome: upload the official IST layout,
  preview zero issues, review/confirm, create VD then SSM then SM; upload OST,
  review both received-signature claims and annual dates, confirm under that SM.
  Reload retained issued AAI/AAO values, directory rows and import history.
- Browser detail inspection found missing OST profile projection. A regression
  failed against the prior draft (no profile row); the import transaction now
  inserts the new OST profile atomically. Fresh PostgreSQL gate: 72/72. A new
  browser import after the correction retained birth date, sex, address, postal
  code, canonical mobile, ID type/number and SM head after full reload. Earlier
  pre-fix synthetic fixtures were not backfilled or represented as new proof.
- Real GoTrue accepted reserved UUIDs and retained server-owned row markers.
  The initial four API-created identities were unconfirmed and had no invitation.
  Company import returned no password. Password-reset/email delivery was not tested.
- Actual API exports for both rosters re-imported as MATCH and confirmed without
  changing canonical row counts, AA values or genealogy. Latest roundtrip covered
  six IST and three OST synthetic identities. All six IST registry records had
  null start/expiry dates; the three OST terms retained 2026-10-01 to 2027-10-01.
- Anonymous job history returned 401. Protected customers, sales, payments,
  memberships, points and commissions remained empty. The targeted API rerun
  after the profile fix passed 83/83; API TypeScript and diff checks passed.
- Browser export produced `Downloads/afhomes-ost-roster.xlsx` (synthetic data).
  The browser download-event observer timed out, but the API returned 200 and
  the actual file exists; this is distinct from opening it in Excel/Sheets.
- One expected local limitation: profile-photo request returned 503 because this
  minimal stack has no Storage delivery service. No import/detail failure remains
  in the exercised post-fix path. Earlier local CORS/startup errors were harness
  setup failures, not counted as successful checks.

Local-only commands used (ignored harness, not a production runbook):

```powershell
node .tmp-bin/member-acceptance/stack.mjs
node node_modules/tsx/dist/cli.mjs .tmp-bin/member-acceptance/serve.ts
node .tmp-bin/member-acceptance/preview.mjs
node .tmp-bin/member-acceptance/check.mjs IST
node .tmp-bin/member-acceptance/check.mjs OST
node .tmp-bin/member-acceptance/roundtrip.mjs
# Run from api/:
node node_modules/vitest/vitest.mjs run _handlers/members.spec.ts _lib/member-company-workbook.spec.ts _lib/member-workbook-jobs.spec.ts --maxWorkers=2
```

Screenshot evidence: ignored `.tmp-bin/member-acceptance/ost-detail-verified.png`.
The imported IST detail also showed its AAI and employee profile, with no Renewal
action. Task-owned API/UI processes and named Docker containers/network were
stopped/removed after acceptance; Docker Desktop and cached images were retained.
Final diff whitespace check passed; 34 task paths remain modified/untracked.
The two proposed migrations remain NOT LIVE APPLIED. Git index remains empty;
HEAD remains `9f44ecc50744a6501a4df0b966b4f7d525bf4530`. No stage, commit, push,
merge, deployment, live Auth action or live SQL writes occurred.

## Release-readiness follow-up - 2026-10-18

The owner authorized continuing readiness work and explicitly approved read-only
preflight only. The connected Supabase account could not access AF Homes; its
permission rejection was respected. The approved fallback read the existing local
DATABASE_URL in memory, verified its project ref and username, verified TLS with
the existing Supabase root CA, and enforced `BEGIN READ ONLY`; all inspection
queries were SELECTs, followed by ROLLBACK. No environment value was logged.

Live evidence (point-in-time, not an application record):

- Correct target: `ikaevepedpqygdlipsei`; read-only ON; 95 migration-history rows
  ending at `20261208000011`. Both proposed versions and import tables are absent.
- All 12 inspected prerequisite function overloads match their latest repository
  baseline bodies after whitespace/comment normalization. Comparison is by name
  and argument count, not name alone; the two transfer/allocator overloads remain
  distinct. The initial overload comparison helper was corrected before drawing
  this conclusion; its earlier mismatches were not accepted as schema drift.
- Four current IST and three current OST identifiers have both dates and no
  reversed dates; identifier history is empty. These satisfy the new date checks.
- Existing public accreditation/install/transfer RPCs inspected here are service
  executable and not executable by anon/authenticated. The import RPCs do not yet
  exist. No runtime ACL or role permission was changed.
- Admin has Members and Staff create/update, but OST registration create/update
  is disabled. Use an already authorized management actor; enabling Admin OST
  authority would be a separate owner-approved permission change, not an import
  migration side effect. No permission expansion is included in these two files.
- The 11 unrelated older history-missing migrations remain excluded. Their
  absence from history does not authorize replay; this gate applies only to 12/13.

Ignored machine-scoped evidence: `.tmp-bin/member-acceptance/live-preflight.json`.

Forward-upgrade proof now starts the disposable database BEFORE migration 12,
issues a legacy dated IST identifier with the old function, records historical
identity data, applies only the two proposed files, and verifies the complete
existing identity/history objects stay unchanged. Re-issuing returns the original
AAI and dates while correctly removing employment expiry as an eligibility gate.
The full importer database gate passed 78/78. No new application behavior was
added during this readiness follow-up; the existing gate gained these assertions.

Real local recovery now passes for a newly imported IST and OST. A small Node
SMTP capture accepts only synthetic example.test recipients, binds to loopback
and never forwards mail. GoTrue sends its real recovery message; the actual
one-use token proves email ownership and confirms the original Auth identity.
Password update/sign-out/password login retain the same staff ID, AA and term.
IST follows the existing forced-change endpoint, which checks the current
password, clears its gate and rejects the old password. OST resolves its own
portal and `/ost/me`. Both are denied the privileged Members directory. This
proves the local chain, not external SMTP-provider deliverability or a password
change performed through browser UI.

Fresh checks: API importer/identity/password/portal suites 124/124, Admin auth
components 37/37, OST portal components 9/9; API TypeScript and diff checks pass.
Ignored proof: `.tmp-bin/member-acceptance/recovery-proof.json`. Tokens/messages
stay in ignored temporary capture files, never Markdown or a commit.

### Manual Excel checklist requested by the owner

Use copies of `manual-SYNTHETIC-IST.xlsx` and `manual-SYNTHETIC-OST.xlsx` under
ignored `.tmp-bin/member-acceptance/`. These are actual local template-endpoint
downloads with synthetic registered head choices; never import them into live.

1. Open both in desktop Excel: no repair prompt or external-link prompt. IST
   entry tabs remain Identity, Team, Details; Teams has exactly three columns.
   OST retains Accreditation. Both retain Date Helper. No macro is required.
2. In Identity row 2, enter synthetic names, DOB and an `09XXXXXXXXX` mobile.
   Confirm the leading zero survives save/reopen and the cell is text. Letters
   and wrong-length mobiles should be refused. Check sex/civil-status dropdowns.
3. Select Laguna, Calauan, Dayap: city/barangay choices follow the selected
   geography and postal code becomes 4012. Change province and clear/reselect
   dependent locations; no stale combination should be treated as valid.
4. IST: fill VD -> SSM -> SM across aligned rows. VD has no head; SSM selects
   VD; SM selects SSM. Try the optional search in Team E2 and verify registered
   head choices still appear. Applicant names must align across all three tabs.
   Leave a NEW employee's AAI blank; preserve an existing issued AAI. No IST
   accreditation date or renewal is requested.
5. OST: select a synthetic active SM for a new manual record. Verify ID type and
   number fields, signature-status dropdowns and signed-on dates. Start
   2024-02-29 should yield 2025-02-28. Date Helper should accept a real leap date
   and flag an impossible day. Signature cells describe evidence, not consent.
6. Save/reopen each copy and confirm formulas/dropdowns/text phones remain.
   Later use only an approved isolated test app to verify preview issues, role
   matching and duplicate rejection. Never sort a single tab independently.

Native Excel execution remains pending this manual sign-off. The owner chose to
keep Google Sheets explicitly UNVERIFIED; no Google file was uploaded/created.
Search relies on Microsoft 365 dynamic-array support; macro-free desktop Excel
does not guarantee a native date-picker popup. Do not claim universal compatibility.

### Proposed Git and coordinated release sequence - NOT EXECUTED

- Remote `origin/claud/develop` and the feature baseline remain
  `9f44ecc50744a6501a4df0b966b4f7d525bf4530`. The existing release checkout is clean
  on `claud/develop` at `f9d9cbe`, which is a verified ancestor of that baseline.
- After scoped Git approval, fast-forward that clean checkout to the verified
  baseline; copy only the 34 inventory paths above from the isolated feature
  checkout, checking the review manifest hashes. Do not merge/reset the dirty
  original VS Code checkout, and do not commit the temporary harness/evidence.
- Proposed selective staging, ONLY after the approved files have been copied
  and branch/clean-index checks have passed:

```powershell
$memberImportFiles = (Get-Content -LiteralPath 'C:\Users\SSD-CLAUD\Documents\AFhomes-member-company-import\.tmp-bin\member-acceptance\release-scope.json' -Raw | ConvertFrom-Json).files.path
git -C 'C:\Users\SSD-CLAUD\Documents\AFhomes-claud-develop-ost-release' add -- $memberImportFiles
git -C 'C:\Users\SSD-CLAUD\Documents\AFhomes-claud-develop-ost-release' diff --cached --check
```

Proposed commit: `feat(network): add IST and OST company workbook imports`.
The approved push target must be `origin/claud/develop`, normal non-force only.
Staging, commit and push are still awaiting scoped approval; no command above ran.

The application and migrations need a coordinated window because the shared
database also serves other deployments. Pause affected IST/OST creation,
AA issuance and conversion activity before changing the date contract. Apply
ONLY reviewed versions 20261208000012 then 20261208000013 under separate explicit
live-apply approval. Recheck the exact hashes, current history/dependencies and
identity preservation snapshot immediately before applying; do not use an
unfiltered migration command or execute CURRENT-SCHEMA.sql.

Verify history delta is exactly those two versions, new private tables have RLS
and no runtime table grants, new RPCs are service-only, existing identifiers and
history are unchanged, and the compatible application is running before lifting
the write pause. A Preview push does not update every production consumer of
the shared database. Do not leave an old date-required API serving new date-free
IST identities. If the second migration or deployment fails, keep affected writes
paused and investigate/roll forward; do not delete identities or blindly roll
back to an incompatible build. Production deployment requires separate approval.

## Final corrected template integration - 2026-10-18

Only four feature files changed in this integration: the two workbook assets,
`api/_lib/member-company-workbook.spec.ts`, and this handoff. No parser mapping,
application implementation, dependency, migration or schema-index change was
needed. The earlier feature changes remain uncommitted and preserved.

The Excel owner lock disappeared and both destination assets passed an exclusive
read-open check before replacement. Uploaded originals were never modified.
Repository asset SHA256 values equal their respective corrected uploads:

- `AFHomes_IST_Bulk_Import_Corrected.xlsx` -> `member-ist-template-v2.xlsx`:
  `FA5C06BF0776CE72A724C4B64E9F7DAA326B7DFE05DC48AB716C5B2F452D0D2C`.
- `AFHomes_OST_Bulk_Import_Corrected.xlsx` -> `member-ost-template-v2.xlsx`:
  `D877139A24EB4FC31D8FE039A275961079EE26F0B103CCEF9546E3207A03F6BD`.

Exact worksheet headers already match `companyLayout`; no duplicate parser or
fallback mapping was added. The corrected assets retain their README, styles,
validations, formulas, hidden `_HeadMatches` helpers (including D2:D501 identifier
checks), three-column Teams lookup, Philippine geography/postal references and
Date Helper in BOTH files. Inspection found no populated member-entry literals,
VBA, external relationships, query/connection parts or author metadata. The
legacy sanitizer was deliberately not run on these corrected uploads.

New automated checks compare every ZIP part byte-for-byte except the dynamically
populated Teams sheet, reject inactive head choices, and cover malformed/wrong-kind
AA identifiers, invalid 09 mobile lengths/characters, canonical storage/display
formatting and leap-day OST expiry. Existing checks cover exact headers, formula
alignment, first-time hierarchy resolution, 09/+63 duplicates and identity-preserving
re-import. Spreadsheet formulas remain untrusted and are never evaluated by the API.
Worksheet entry validation expects 11-digit 09 text; the existing approved API
normalization still recognizes canonical +63 input and detects equivalent duplicates.

Fresh local verification against the corrected assets:

- Complete API suite: 2,471/2,471 passed across 126 files.
- Focused API Members/workbook/job suites: 87/87 passed.
- Complete contracts suite: 313/313 passed.
- Admin import-dialog suite: 6/6 passed.
- Disposable PostgreSQL gate: 78/78 passed, including forward-upgrade/history,
  manual sponsor restrictions, authorization, duplicate/idempotency and rollback.
- Real loopback GoTrue/PostgREST/API: three IST CREATE rows imported in
  VD -> SSM -> SM order and one accredited OST CREATE row under that active SM.
  Auth UUIDs matched staff UUIDs, email remained unconfirmed and no invitation
  was sent. A permission grant existed only for the synthetic disposable Admin
  role to exercise authorized OST creation; no repository/live grants changed.
- Both actual export -> preview -> MATCH -> confirm chains passed without
  changing canonical table counts or identities. IST AAI dates remained NULL;
  OST AAO retained its supplied one-year term. Customer, finance, commission and
  points tables remained empty. Unauthenticated job reads returned 401.
- Both actual authorized template-endpoint downloads preserved every ZIP part
  except Teams and populated all three synthetic active registered head choices.
- API TypeScript, targeted Prettier and `git diff --check` passed.
- Both proposed migration hashes remain exactly as recorded above; no SQL change
  or CURRENT-SCHEMA.sql regeneration was necessary for this template integration.

Recreated manual-review downloads and synthetic API/export evidence remain under
ignored `.tmp-bin/member-acceptance/`. Native desktop Excel and Google Sheets are
still UNVERIFIED; the manual checklist above remains outstanding. No upload to
Google, production connection, live SQL, stage, commit, push, merge or deployment
was performed for this corrected-template integration.

## Push / live-migration readiness follow-up - 2026-10-18

Scope remains 34 feature files, no staging or Git integration. Read-only remote
inspection still reports `origin/claud/develop` at `9f44ecc50744a6501a4df0b966b4f7d525bf4530`.
The clean release checkout remains on `claud/develop` at ancestor `f9d9cbe`.
The original VS Code checkout and its 11 unrelated changed/deleted paths remain
excluded. The ignored release manifest was regenerated with current file hashes.

Fresh TLS-verified live SELECTs, inside an enforced read-only transaction, found:

- The same single target project, 95 history entries through `20261208000011`.
- Migrations 12/13 and both new import tables remain absent.
- All 12 inspected prerequisite function overloads still match the repository
  baseline. Existing active identities have valid dates (4 IST, 3 OST); there
  are no accreditation-history rows. No records were returned to Markdown.
- The 11 unrelated history-missing versions remain excluded. Neither an
  unfiltered migration command nor migration-history repair is authorized.
- Default Admin still lacks OST registration create/update permissions. Preserve
  this policy; the successful local synthetic permission grant is not a live grant.

Fresh Admin/web typechecks and builds passed, with existing bundle-size warnings.
Supabase/contracts typechecks passed. Public SEO prerender produced 12 routes.
The browser/server environment-isolation scan and `git diff --check` passed.
The prior corrected-template API/contracts/component and 78-check database proof
remain applicable; their application and migration bytes have not changed.

### Migration execution hazard and prepared scoped alternative

Do NOT use the ordinary `supabase/apply-migrations.ts` path for this release.
It opens an outer transaction but sends migration files containing BEGIN/COMMIT
unchanged. A disposable PostgreSQL reproduction proved that the inner COMMIT
can persist DDL before migration-history recording or an outer failure. The
ordinary runner also disables TLS certificate verification. Neither runner nor
the existing recovery helper was changed: that helper intentionally permits
only a different historical migration's transaction envelope.

An ignored, exact-scope alternative is prepared under `.tmp-bin/member-acceptance/`:

- `scoped-release-core.mjs`: pins both original migration SHA256 values, accepts
  only each reviewed outer BEGIN/COMMIT pair and strips that pair in memory.
  It applies ONLY 12 then 13 inside the caller's transaction and inserts their
  two history rows. It checks old history preservation, all existing public,
  private, Auth and Storage table counts, full accreditation/history digests,
  empty new tables, private-table RLS/no runtime grants and seven service-only
  RPCs with restricted search paths before commit. No business RPC is called.
- `apply-scoped-release.mjs`: refuses by default before any connection. After
  separately scoped approval and confirmation of the affected-write pause, it
  requires a fresh (under 15 minutes) read-only preflight, exact project identity,
  TLS certificate verification, unchanged prerequisite functions/history,
  advisory lock and five-second lock timeout. DDL, preservation checks and BOTH
  history entries share one repeatable-read transaction. Post-commit checks
  require history count 97 and verified new objects. Errors suppress credentials
  and distinguish committed from uncommitted outcomes; never retry automatically.
- `scoped-release-proof.mjs`: loopback-only disposable test of the SAME execution
  core. Twenty explicit checks passed, plus the core preservation/access checks.
  Injected failure after both migrations proved that BOTH DDL changes and BOTH
  history entries rolled back, including restored date NOT NULL constraints.
  The subsequent successful run committed exactly versions 12 and 13. The first
  fixture run encountered duplicate historical version prefixes; fixture history
  now records distinct versions without changing any repository migration.
  `scoped-release-proof.json` records sanitized local evidence.

The live wrapper's refusal path was exercised; its live apply path has NOT run.
These helpers/evidence remain ignored and are excluded from the 34-file commit.
The live connection adapter remains unverified until an authorized live apply;
the shared execution core and rollback behavior were tested locally.

Review-only commands (NOT authorization; do not run the final command yet):

```powershell
Set-Location 'C:\Users\SSD-CLAUD\Documents\AFhomes-member-company-import'
node .tmp-bin/member-acceptance/live-preflight.mjs
# ONLY after explicit approval and actual confirmation of the affected-write pause:
node .tmp-bin/member-acceptance/apply-scoped-release.mjs --approve-live-12-13 --affected-writes-confirmed-paused
```

### Vercel read-only findings and final approval boundary

The connector returned 403; the already-installed CLI succeeded read-only under
explicit scope `afhomes`, project `afhomes-ecofarm-v2`
(`prj_apBNxtW4R8E7JohbFg6K8aUGin4j`). No login, installation or Vercel change occurred.

Production branch is **main**. The current `claud/develop` Preview at `9f44ecc`
is READY (`dpl_7kKKe1JpEcFQh3z8TTBzGnuaTfhT`), with the stable branch alias
`afhomes-ecofarm-v2-git-claud-develop-afhomes.vercel.app`. The plain branch-scoped
VITE_WEB_URL points to that assigned alias, not an unrelated deployment.
Metadata confirms the required Preview variable names and a sensitive
SUPABASE_SERVICE_ROLE_KEY scoped specifically to `claud/develop`. Secret values
were not requested/decrypted or exported; presence is not proof of validity.
The `packages/**` function inclusion covers both workbook assets. A new hosted
build, runtime template download, login and persistence are not yet verified.

Proposed next release: integrate ONLY the manifest's 34 paths into the clean
`claud/develop` checkout, commit `feat(network): add IST and OST company workbook imports`,
normal push ONLY to `origin/claud/develop`, then verify its exact new Preview.
During a separately confirmed affected-write pause, apply ONLY the hash-pinned
12/13 batch above and verify database history/access/preservation. Never apply
unrelated missing versions, create production records, or promote to main.
The application and migration checks must both pass before resuming affected
writes; no real import is authorized by migration approval alone.

Old `develop`/other Preview APIs still share the database. They must not create,
issue/convert, or assume dates for new date-free IST identities after cutover.
Use the compatible release for these operations and keep incompatible consumers
out of the affected flows until separately updated. A claud/develop push does
NOT update main or the other previews. Confirm this operating arrangement and
the affected-write pause before authorizing live SQL; no pause has been enacted.

Desktop Excel manual sign-off and Google Sheets behavior remain unverified.
No zero-risk or production-ready claim is made. No staging, commit, merge, push,
live migration, Auth mutation, live business action or deployment was performed
during this readiness follow-up.

## Focused implementation window - owner update 2026-10-18

The owner confirmed: **no writers outside the two inventoried Vercel projects
are active**. This is owner confirmation, not discovery of every credential
holder. Do not repeat the broad inventory or investigate unrelated migrations.
The second project's actual Supabase target remains unproven; include it in the
proposed HTTP maintenance scope unless its owner establishes it is unrelated.
Writes are still NOT paused. This update does not authorize any live action.

### Approval stage 1: maintenance and recovery checkpoint only

Request explicit approval for this exact temporary scope:

1. In Vercel team `afhomes`, projects `afhomes-ecofarm-v2` and
   `claud-af-home-branch`, save the existing firewall configuration and add a
   project-level Deny rule for every method except GET, HEAD and OPTIONS.
   Preserve the existing AA-search rule and other settings. Confirm host and
   bypass coverage, including immutable deployment URLs and all aliases.
   This deliberately pauses ALL writes through those projects, including
   customer/finance operations; it is wider than an import-only UI pause.
2. Drain in-flight affected requests. Install ONLY the reviewed 15-table
   statement-trigger pause in one transaction, with a five-second lock timeout.
   Abort without partial installation on lock contention; do not kill sessions,
   disable existing triggers, change credentials or revoke unrelated privileges.
   No caller/owner/service-role/session-variable bypass is permitted.
3. Verify the LIVE edge rule with approved safe negative HTTP probes on every
   inventoried READY URL and alias, including direct router requests. A redirect,
   authentication failure, validation failure or disabled UI button is not proof.
   Follow with approved rollback-only SQL denial probes and exact catalog checks
   for all 15 enabled guards. Never send a real import or invite as a pause probe.
4. Capture a fresh encrypted consistent backup of the relevant application,
   migration-history and Auth data, using the existing local operator tooling.
   Keep its key outside the repository and connection values out of command/log
   output. Do not overwrite the previous backup. Restore-test only into isolated
   local PostgreSQL with outbound services disabled; compare checksums, manifest
   counts, issued identities/history and constraint validity. Explicitly inventory
   Storage-object and platform configuration exclusions. Do not restore live.
5. Record actual pause and restore evidence. Stop with maintenance still active
   for the next scoped approval. No migrations 12/13, Git write or application
   deployment is included in stage 1. Do not produce a success evidence file until
   its checks actually pass. Backups alone do not establish a pause.

The 2026-10-17 encrypted files match their existing SHA256 manifest, but their
history ends at version 8 (92 entries). Current live history was observed through
version 11 (95 entries). These old files do NOT satisfy the fresh recovery gate.

### Approval stage 2: import release only, after stage 1 passes

Integrate ONLY the reviewed manifest into the clean `claud/develop` checkout;
commit `feat(network): add IST and OST company workbook imports`; normal push
ONLY to `origin/claud/develop`. Wait for the exact new Preview SHA to build while
its writes remain blocked. Do not promote main or modify other branches.

Refresh the exact prerequisite/hash/history checks, then use the scoped batch
for ONLY 20261208000012 followed by 20261208000013. Both DDL changes, both history
entries, data-preservation checks and the two new pause guards share one
transaction. Expect history delta exactly +2 and 17 enabled guards afterward.
No unrelated history-missing version may be applied or stamped.

While paused, verify the exact compatible deployment, health, authorized template
downloads and read paths. An approved host-specific test exception or explicitly
approved business-write test window is required for hosted confirmation/import;
do not claim a real end-to-end write passed while all writes are blocked.
Keep incompatible deployments blocked, including affected read routes if their
old date contracts cannot read new IST identities. Remove temporary DB guards
and reopen only verified compatible hosts under explicit resume approval.

Before batch commit: any failure rolls back DDL and history together. After
commit: keep maintenance active and repair forward; do not automatically revert
to the incompatible API, delete data or restore the stale backup.

Local evidence remains: 132 maintenance checks, 78 import DB checks, corrected
template API 2,471/2,471, contracts 313/313 and import-dialog 6/6. No application,
migration or template bytes changed in this follow-up, so no suite rerun was
necessary. The review scope remains 35 files including the OpenCode handoff.
