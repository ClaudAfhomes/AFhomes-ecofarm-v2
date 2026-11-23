# Customer workflow workbook: exhaustive field mapping, R1

Date: 2026-10-19. Proposed contract for review, not implemented.
Applies to the revised continuation specification and implementation plan.

Every input is preserved in the protected source snapshot. That preservation does not
make it an authoritative customer identity, payment or executed agreement. The DTO
paths below refer to existing customer/company/application contracts; database writes
must use the existing field names and scoped mutation helpers. No raw private values
are added to broad customer/export responses.

## Row identity and purchase identity

Customers has one row per customer purchase. `Customer key` is a human-readable workbook
join key, unique within that file, e.g. `Customer 01`. It is not a system ID. Different
keys may resolve to the same existing customer only with distinct purchase references.
Every Supplementary Holders, Sales Team and Payments row must resolve exactly one key.

| Customers column | Canonical disposition | Rule |
| --- | --- | --- |
| Customer key | `WorkbookCustomerV2.customerKey` / protected source-row provenance | Required; normalize whitespace/case for joins; reject duplicate or orphan keys. Never persist as issued customer ID. |
| Customer ID (RA No.) | Identity resolver; `customers.customer_number` if exact issued-ID match; existing `customers.ra_number` if reviewed legacy alias | Existing issued ID takes priority; legacy alias must be unique and supported by an existing authoritative customer link plus agreeing strong identity. Any conflict blocks merge. Unknown value is preserved as an external claim; only explicit new-customer review may associate it with a new generated customer, without overwriting issued IDs. |
| Purchase reference | Private canonical source identity `(server issuer scope, normalized reference)` | Required. Match existing authoritative application/reservation only through its real reference and customer ownership; otherwise explicit reviewed source registration. One source -> at most one application. Not derived only from customer, amount, email, job or request ID. |
| Existing reservation reference | Review-only candidate in source; verified reference resolves `reservation_agreements.id` | Optional; cannot assign a random existing reservation or imply execution. Different from Customer ID. |
| Application stage (claimed) | Source stage claim / missing-requirement routing | Readable allowed labels; cannot approve, sign, consent, execute, cancel or activate operational records. |

Database UUIDs, service actors, target versions, issuer scope, template/mapping versions
and verified-status fields are not editable workbook columns. Version is stored in
protected workbook metadata and validated against the exact header/sheet contract.

## Primary customer fields

Each row also maps the following Customers columns. `application.primary` means the
PRIMARY record written through the normal application-holder path once the minimum
required real facts are present. Until then preserve partial facts in the source intake
and present Complete imported application; do not insert fake dates, addresses or plan IDs.

| Column | Existing canonical customer destination | Existing application holder DTO |
| --- | --- | --- |
| First name | `customers.first_name` / `person.firstName` | `primary.firstName` |
| Last name | `customers.last_name` / `person.lastName` | `primary.lastName` |
| Middle name | `customers.middle_name` / `person.middleName` | `primary.middleName` |
| Suffix | `customers.suffix` / `person.suffix` | `primary.suffix` |
| Birth date | `customers.birth_date` / `person.birthDate` | `primary.birthDate` |
| Gender | `customers.gender` / `person.gender` | `primary.sex` |
| Citizenship | `customers.citizenship` / `company.citizenship` | `primary.citizenship` |
| Civil status | `customers.civil_status` / `company.civilStatus` | `primary.civilStatus` |
| Address line 1 | `customers.address.line1` | `primary.permanentAddressLine1` |
| Address line 2 | `customers.address.line2` | `primary.permanentAddressLine2` |
| Province | `customers.address.province` | `primary.province` |
| City / Municipality | `customers.address.city` | `primary.cityMunicipality` |
| Barangay | `customers.address.barangay` | `primary.barangay` |
| Postal code | `customers.address.postalCode` | `primary.postalCode` |
| Landline | `customers.landline` / `person.landline` | `primary.landline` |
| Email | `customers.email` / `person.email` | `primary.email` |
| Mobile number | `customers.phone` / `person.phone` | `primary.mobile` |
| TIN (optional) | `customers.tin_number` / `company.tinNumber`, write-only | `primary.tinNumber`, scoped private write; masked readback only |
| Occupation / Business name | `customers.occupation_business_name` / `company.occupationBusinessName` | `primary.occupationBusinessName` |
| Office / Business address | `customers.office_business_address` / `company.officeBusinessAddress` | `primary.officeBusinessAddress` |
| Position | `customers.employed_position` / `company.employedPosition` | `primary.employedPosition` |
| Age (calculated) | Recompute from valid birth date and current reporting date; not a persisted age | Never override birthDate |
| Birth day (date helper) | Validated numeric helper, source only | Used only if direct Birth date is blank; conflict between the two inputs blocks |
| Birth month (date helper) | Validated numeric/month-name helper, source only | Same rule |
| Birth year (date helper) | Validated numeric helper, source only | Same rule |

Server-resolved province/city/barangay codes populate the existing structured address
code fields and `primary.provinceCode`, `cityMunicipalityCode`, `barangayCode`; workbook
names cannot fabricate codes or override the authoritative parent relation. Printed
name is composed from validated names in first/middle/last/suffix order. A calculated
helper date must be a real calendar date; invalid leap days and overflow are errors.

## Supplementary Holders

One optional row per Customer key, Gold only. Every column below is supported, including
split names/address and the original values in the source snapshot. The customer master
uses joined supplementary name/address columns; application holders retain structure.

| Column | Existing canonical customer destination | Existing application holder DTO |
| --- | --- | --- |
| Customer key | Join/provenance only | Resolves parent purchase/customer |
| First name | `company.supplementaryFullName` component | `secondary.firstName` |
| Last name | Same, assembled first/middle/last/suffix | `secondary.lastName` |
| Middle name | Same | `secondary.middleName` |
| Suffix | Same | `secondary.suffix` |
| Birth date | `company.supplementaryBirthday` | `secondary.birthDate` |
| Gender | `company.supplementaryGender` | `secondary.sex` |
| Citizenship | `company.supplementaryCitizenship` | `secondary.citizenship` |
| Civil status | `company.supplementaryCivilStatus` | `secondary.civilStatus` |
| Address line 1 | `company.supplementaryAddress` component | `secondary.permanentAddressLine1` |
| Address line 2 | Same, join nonblank components in line1/line2/barangay/city/province/postal order | `secondary.permanentAddressLine2` |
| Province | Same | `secondary.province` plus resolved codes |
| City / Municipality | Same | `secondary.cityMunicipality` plus resolved codes |
| Barangay | Same | `secondary.barangay` plus resolved codes |
| Postal code | Same | `secondary.postalCode` |
| Landline | `company.supplementaryLandline` | `secondary.landline` |
| Email | `company.supplementaryEmail` | `secondary.email` |
| Mobile number | `company.supplementaryMobile` | `secondary.mobile` |
| TIN (optional) | `company.supplementaryTinNumber`, write-only | `secondary.tinNumber`, masked readback |
| Occupation / Business name | `company.supplementaryOccupationBusinessName` | `secondary.occupationBusinessName` |
| Office / Business address | `company.supplementaryOfficeAddress` | `secondary.officeBusinessAddress` |
| Position | `company.supplementaryPosition` | `secondary.employedPosition` |
| Age (calculated) | Recomputed, not persisted | Never overrides birthDate |
| Birth day / Birth month / Birth year (date helpers; three distinct columns) | Same helper rules as Primary, individually validated | Compose valid date only when direct Birth date is blank |

Customer company DTO properties map one-to-one to the existing supplementary snake_case
columns documented by `customer-ssot.ts`. If the holder is incomplete, retain its partial
data and block submission; never create a non-Gold holder, coerce tier, or pad missing facts.

## Sales Team

| Column | Canonical destination | Rule |
| --- | --- | --- |
| Customer key | Join/provenance only | One team row per purchase key. |
| VD / SVD (workbook claim) | `company.svdName`, checked against resolved Referrer VD; `application.svdStaffId`/`svdName` when valid | Optional claim; exact conflict if not authoritative lineage. |
| SSM (workbook claim) | `company.ssmName`; `application.ssmStaffId`/`ssmName` | Same rule. |
| SM (workbook claim) | `company.smName`; `application.smStaffId`/`salesManagerName` | Same rule. |
| Referrer | `customers.referred_by_staff_id` and `company.referrerName`; `application.referrerStaffId` and existing referrer snapshot | Existing registered OST only. Existing different customer referral is a review conflict, not an overwrite. |
| VIP Recommender | `company.vipRecommenderName`; `application.vipRecommenderName` | Existing registered OST only; preserve canonical ID in protected provenance. |
| Recommender contact | `company.relatedContactNo`; `application.recommenderContact` | Source claim, never update staff contact. |
| Recommender email | `company.relatedEmail`; `application.recommenderEmail` | Same rule. |
| Referrer VD / SSM / SM (three calculated display columns) | Re-resolve from registered parent/upline IDs | Never construct or persist genealogy from text or formulas. |
| Recommender VD / SSM / SM (three calculated display columns) | Re-resolve separately | Same VD root can have different immediate uplines. |

Human-readable choices include AA number where available and map to existing canonical
staff identity. Legacy exact names work only when unique. Missing intermediate placements
stay missing; never insert an SM/SSM or select a same-named person to satisfy a chain.

## Contract fields on Customers

| Column | Canonical disposition | Rule |
| --- | --- | --- |
| VIP plan | `company.statedVipPackage`; matched plan/tier for application proposal | Gold/Silver/Bronze -> canonical existing tier and active eligible plan; historical inactive plan requires review. |
| Payment terms | `company.statedPaymentTerms`; application paymentScheme | Human labels map to existing scheme enum, not new pricing logic. |
| Contract date | Source reviewed historical fact | Does not manufacture acknowledgedAt, signature or reservation execution date. |
| Regular contract price | `company.statedRegularPrice` | Exact decimal source claim; compare to frozen/current approved terms, never overwrite them. |
| Approved discount amount (claimed) | `company.statedDiscount` | Monetary amount only, not plan discountPercent. Source amount does not prove approval. |
| Contract total (calculated) | `company.statedTotalAmount` after recomputation | Price minus claimed discount; mismatch/discount approval missing blocks financial progression. |
| Included reservation fee | `company.statedRf` | Included in total, not an extra payment/charge. No ledger write. |
| Payments stated (calculated) | Sum of joined payment claims | Display claim total only; not verified paid total. |
| Remaining balance (calculated) | Claimed contract total minus unique joined claims | Negative result blocks; distinct from authoritative verified balance. |

No generic RF amount implies a paid transaction without a Payments row. V1 RF/status
may support a proposed legacy claim only when the original payment amount/date/method/
reference are sufficient; otherwise show the missing information and never invent a
payment date or fabricate a full ledger. Multiple Payments rows remain individual claims;
do not squeeze them into the old single statedRefNo/statedPaymentDate columns. Those old
customer fields may echo a sole legacy payment only, with source provenance preserved.

## Payments

| Column | Protected claim destination | Ledger destination only after explicit Finance acceptance |
| --- | --- | --- |
| Customer key | Resolve source/customer/purchase | No client-supplied customer/reservation UUID |
| Payment claim reference | Stable source claim key, unique within purchase source | One accepted claim can link only one canonical payment |
| Purpose | `purpose` (Reservation fee / Down payment / Installment / Full payment) | Map to existing payment_type; reservation fee maps to down_payment with retained source purpose; no new ledger enum |
| Amount paid (claimed) | `amount`, exact decimal | `payments.amount`, recorded only |
| Payment date | `date`, real original date | Retain as actual source date in provenance and payment notes where no dedicated field exists; `recorded_at` remains actual recording timestamp, never backdated |
| Payment method | `method`, readable option normalized | Existing `payments.method` |
| Receipt / Bank reference | `reference`, literal text | Existing `payments.reference` after reconciliation |
| Notes | Source note, bounded literal text | Existing `payments.notes`, no secret/proof URL |
| Payment day / Payment month / Payment year (three date helper columns) | Validated source helpers | Same nonconflicting date composition as holder dates |

Workbook contains no verified checkbox, verifier, proof URL, private storage path or
actor input. Authorized Finance uploads/views private evidence in the system. Its
explicit record/match/hold/reject reconciliation state and accepted payment linkage are
private provenance, never an editable workbook command. Payment proof missing -> claim
remains pending reconciliation; zero accounting writes. Existing matching payment ->
link to it without adding another ledger record.

## Metadata, references, validation and coverage

Start Here is instructions only. Reference Lists contains scoped public-choice facts,
not authoritative edits. Formula outputs, lookup names, version and generated-at values
are reference/metadata, never new customer history. No hidden worksheet may carry private
staff contacts or customer identity data simply to support dropdowns.

All supported input/display columns above must have one entry in a single versioned
mapping manifest shared by parser/export and tests. For grouped helper/lineage rows,
the manifest contains one entry per individual column. Coverage tests iterate the
manifest and prove one of: canonical write/readback, protected source-only readback,
recomputed display, or explicit review-only disposition. Write-only TIN tests assert
masked readback and private storage rather than plaintext customer export.

Any populated unmapped header, unexpected required header, unknown sheet with data,
external workbook connection or non-allowlisted executable formula blocks confirmation
with sheet/cell explanation. Literal user text beginning with formula characters stays
literal on export/reopen. Preserve all original v1 input keys through an explicit
adapter: notably `tin -> tin_number`, `occupation -> occupation_business_name`,
`business_address -> office_business_address`, `position -> employed_position`,
`vd_name -> svd_name`, `recommender_name -> vip_recommender_name`,
`recommender_contact -> related_contact_no`, `recommender_email -> related_email`,
`stated_total -> stated_total_amount`, and `secondary_*` into the exact supplementary
destinations above. Also map `stated_payment_scheme -> payment_scheme`,
`stated_payment_method -> payment_method`, `stated_reference -> payment_reference`, and
`stated_date -> payment_date` for the legacy company-stated echo only; these aliases
never create a ledger payment. Legacy `secondary_landline` maps to supplementary landline,
and split secondary names/address are assembled in the exact orders given above while
retaining every component for application prefill. The adapter must not map internal forced Pending source_status over
the company's original stated_status. No supported column can vanish silently.
