# AF Homes Ecofarm — Business Rules

## Status and authority

Added on 2026-10-14 at the user's request from `MEMBERSHIP-ID-GENERATION.md` (Draft 1.2). This file records the supplied numbering specification; it is not a complete catalog of all AF Homes business rules. Current repository contracts, migrations and authorization rules remain authoritative for implemented behavior.

The specification below is retained verbatim. Its `[SOURCE]` verification claims and `[APPROVED FORMAT]` labels are statements from the supplied document; the underlying workbooks, macros and separate approval records were not independently verified in this documentation change. Embedded implementation instructions are reference material, not a new execution request or authorization.

### Current implementation versus proposed policy

- Current customer/sale generators use the existing AF business-ID allocator (`public.next_customer_number()`, `public.next_sale_number()`, `private.claim_af_id`) and existing namespaces such as `AF-CUS`, `AF-CSALE` and the distinct customer code `AF-CC`. The proposed `AF-CUS-YYYY-NNNNNN` format must not be described as already implemented.
- AA generation: the legacy and still-valid format is `AA-` plus twelve randomly shuffled characters: exactly six uppercase letters and six digits. **On 2026-10-16 the `AAI`/`AAO` date-and-sequence format was approved for new issuances and implemented by migrations `20261207000001`–`20261207000003` (prepared; applying them remains a separately approved step):** an IST accredits as `AAI`, an OST as `AAO`, each followed by `YYMM` and a four-digit monthly sequence. Legacy `AA-…` numbers are accepted verbatim on data entry and every issued number is preserved - never renumbered, reused or reissued. Accreditation still requires explicit approval; IST eligibility remains VD, SSM and SM.
- Keep customer, application, sale, payment, membership and accreditation identities distinct. Existing UUIDs, issued identifiers, aliases, financial snapshots and audit history must remain intact. An identifier never grants permission or proves current membership/accreditation validity.
- The document's annual/monthly allocation conflict (OD-01), issuance trigger (OD-03), tier mapping (OD-04), card/upgrade behavior (OD-05), renewal behavior (OD-06) and customer issuance/legacy decisions (OD-12) remain open. The accreditation counter scope (OD-02) is resolved: one company-wide monthly sequence shared by the `AAI` and `AAO` prefixes. No unresolved rule is silently adopted.
- JA&D/IGP material below is supplied cross-company numbering reference only. It does not reactivate retired JAD code, create an IGP product, adopt compensation rates, or change AF Homes roles and permissions. No NFC is introduced.
- This addition changes documentation only: no generator, schema, account, commission, financial record or issued ID is changed. Implementation and any live migration require their own reviewed scope and authorization.

Related operational context: [Supabase Free and release constraints](supabase/SUPABASE-FREE.md). Profile-photo readiness is recorded there separately; it does not approve an identifier rollout.

## Supplied membership and numbering specification

# AF Homes Ecofarm V2 — ID Generator & Numbering Business Rules

**Document type:** Business Rules + Implementation Specification (Markdown)  
**Version:** Draft 1.2 — customer ID format approved; remaining issuance decisions open  
**Prepared:** 2026-10-14  
**Scope:** Customer numbers (approved format; issuance workflow pending), VIP sales control numbers, AFhomes/JA&D IGP series numbers, salesperson accreditation identifiers, linked numbers, lifecycle/lookup, and integration into AF Homes Ecofarm V2.  
**Policy status:** **DRAFT — not authorization to change production behavior, numbering policies, sales contracts, or database schema.**

> **Reading key**  
> **[SOURCE]** = verified from uploaded BUILD 2026-09-10a workbooks, reference sheets, and Rev E controls.  
> **[V2 PROPOSAL]** = recommended design for the existing web/API/Supabase platform, not an already approved source policy.
> **[APPROVED FORMAT]** = user-confirmed printed customer ID pattern on 2026-10-14; this does not authorize production issuance, migrations, backfills, or other pending policy decisions.  
> **[OPEN DECISION]** = business-rule inconsistency or mapping requiring written confirmation before production enablement.

## 1. Purpose and boundaries

Implement an auditable, searchable, duplicate-resistant numbering service that preserves existing official AFhomes and JA&D control-number formats while integrating with current V2 applications, sellers, membership cards, approved sales, payments, commission calculations, reports, and the audit ledger.

**This specification concerns identifiers and dependent lifecycle controls only.** It does **not** itself adopt the source workbooks' sales thresholds, compensation rates, payroll, or IGP product commercial terms. Those require separate approved policies.

The existing V2 database UUIDs and existing visible identifiers (for example, application/payment references already issued) are not to be replaced, renumbered, or deleted. A formatted external business number is a separate unique field that references the relevant permanent internal record.

**Out of scope:** NFC; standalone JA&D deployment; implementing spreadsheet macros; changing live commissions; altering membership entitlements; importing workbook data without verification.

## 2. Source of authority and precedence

1. `A2-AFhomes_VIP_IGP_Integrated_Generator-v10_2_0-BUILD_2026-09-10a.xlsx` — `Reference`, `Generator`, `IGP Generator`, `Register`, `IGP Register`, `Accreditation`, `ID Lookup`, `Control Panel`.
2. `A1-JA_D_IGP_Numbering_Sales_Report_Generator-v4_2_0-BUILD_2026-09-10a.xlsx` — `Reference`, `Generator`, `Register`, `AATS Register`, `ID Lookup`.
3. `B2-AFhomes_Generator_v10_2_0_VBA_Module-RevE.txt` — `FreezeNumbers`, `FrozenMonthMaxG`, `FrozenPrefixMaxF`, `FreezeSaleRates`, approvals and audit behavior.
4. `B1-JAD_Generator_v4_2_0_VBA_Module-RevE.txt` — parallel JA&D control behavior.
5. `B4-AFhomes_Sheets_Control_Module_AppsScript-v2_1.txt` and `B3-JAD_Sheets_Control_Module_AppsScript-v2_13.txt` — Sheets implementation for corresponding controls.
6. `A4-AFhomes_VIP_IGP_Integrated_Generator-User_Guide-2026-09-10a.docx`, `A6-AFhomes_Operations_Manual-2026-09-10a.docx`, `B8-AFhomes_v10_2_0-Build_Note_and_Module_Hooks.docx` — operations, exceptions and as-built behavior.
7. `A7-QA_Glossary-Ambiguous_Terms-2026-09-10.docx` and `C1-Go_Live_Checklist-BUILD_2026-09-10a.docx` — terminology and go-live constraints.

When a `Reference` sheet, `Register` formula, macro, and written instructions disagree, **do not silently pick one**. Record it in §13 and obtain a business decision. This document is not a replacement for signed service contracts or management rulings.

## 3. Identifier catalog

| Identifier | Source structure | Characters | Source and examples | Intended subject |
|---|---|---:|---|---|
| **AFhomes customer number [APPROVED FORMAT]** | `AF-CUS-` + `YYYY` + `-` + `NNNNNN` | 18 | `AF-CUS-2026-000001` — **not in source workbooks** | One canonical AFhomes customer record |
| AFhomes VIP control number | `YYMMDD` + `NNNNN` + `VT` + `P` + `MM` + `S` | 17 | `26101400001G1T12S` | One VIP sale/transaction |
| AFhomes-channel IGP series | `A` + `YYMMDD` + `NNNN` + `T` + `P` + `MM` + `S` | 16 | `A26101400011T12S` | One AFhomes-originated IGP sale |
| JA&D-own-channel IGP series | `J` + `YYMMDD` + `NNNN` + `T` + `P` + `MM` + `S` | 16 | `J26101400011T12S` | One JA&D-originated IGP sale |
| AFhomes IST accreditation | `AAI` + `YYMM` + `NNNN` | 11 | `AAI26100001` | An AFhomes IST accreditation |
| AFhomes OST accreditation | `AAO` + `YYMM` + `NNNN` | 11 | `AAO26100001` | An AFhomes OST accreditation |
| JA&D-own IST accreditation | `JJI` + `YYMM` + `NNNN` | 11 | `JJI26100001` | A JA&D-own IST accreditation |
| JA&D-own OST accreditation | `JJO` + `YYMM` + `NNNN` | 11 | `JJO26100001` | A JA&D-own OST accreditation |
| JA&D authority, AFhomes IST | `JAI` + `YYMM` + `NNNN` | 11 | `JAI26100001` | JA&D accreditation for AFhomes IST |
| JA&D authority, AFhomes OST | `JAO` + `YYMM` + `NNNN` | 11 | `JAO26100001` | JA&D accreditation for AFhomes OST |
| Linked sales reference | `<sale number> - <seller accreditation number>` | Variable | `26101400001G1T12S - AAI26100001` | Display/reconciliation expression, **not a distinct transaction** |

Examples are *illustrative* and are not issued, reserved, or verified unique. Source samples derive from the corresponding `Reference` sheets and generator formulas. The JA&D reference describes a 16-character IGP number but its abbreviated printed segment pattern omits the leading issuer letter; the actual `Generator!B38` and `Register!H5` formulas include `J`.

### 3.1 Distinct identity domains [SOURCE / V2 PROPOSAL]

- A **customer number** (format approved; issuance pending) identifies a customer across registrations, applications, purchases and memberships; it is not provided by the source workbook generators.
- An **application number** tracks the customer application process and is not a VIP sales control number.
- A **sale number** tracks the purchase, its documents, collections, and financial attribution.
- An **accreditation number** identifies an approved seller accreditation (not a customer or a sale).
- A **JA&D accreditation number** may be associated with the same individual as an AFhomes AA number; never confuse the two.
- A **membership/card identifier** is separate from the sale number in the V2 database, even when the source workbook prints the sale number on a physical VIP card. See §13.
- A **payment reference** is independent and linked to the sale by record ID.
- **[V2 PROPOSAL]** One person may have multiple role/accreditation records; use a stable `person_id` to join them without treating two numbers as two people.

### 3.2 Customer ID — approved V2 format; issuance workflow still pending

**Source limitation [SOURCE]:** The AFhomes/JA&D generators record **Buyer / Member** names and optional buyer details and create sale/IGP numbers; the supplied user guides and reviewed workbook numbering fields do **not** specify a separate official customer-number format. This format is not copied from the source workbooks; the user explicitly approved the proposed V2 format on 2026-10-14.

**Approved external customer-number format [APPROVED FORMAT]:** `AF-CUS-YYYY-NNNNNN` (18 characters including separators), e.g. `AF-CUS-2026-000001`.

| Segment | Meaning | Rule |
|---|---|---|
| `AF-CUS` | AFhomes customer identifier namespace | Fixed, distinct from `AAI`/`AAO` seller accreditation and transaction control numbers |
| `YYYY` | Customer ID issuance year | Server-side year at first canonical customer-ID issuance; does **not** encode birth date or membership start |
| `NNNNNN` | Six-digit year-scoped sequence | Starts at `000001`, unique within issuance year and namespace; zero-padded; overflow fails closed |

**Customer rules (CUS-BR-01 through CUS-BR-13):** The external format is approved; the remaining issuance, security, merge, and migration behaviors below remain proposed unless separately signed off.

1. **CUS-BR-01 [V2 PROPOSAL]:** Assign exactly one primary official customer number to each canonical AFhomes customer record, using the existing database customer UUID as the durable internal key. Check current V2 customer identifiers before adding a new column or registry entry.
2. **CUS-BR-02 [V2 PROPOSAL]:** Issue the number server-side when a validated, durable customer record is first created, whether by approved staff registration or supported self-registration, **subject to OD-12 policy approval**. A temporary draft/lead with no committed customer record does not receive a permanent number.
3. **CUS-BR-03 [V2 PROPOSAL]:** Customer ID stays immutable across membership activation, tier changes, purchase upgrades/downgrades, renewals, refunds, account deactivation, email/phone/name corrections, and repeat purchases.
4. **CUS-BR-04 [V2 PROPOSAL]:** A person can have zero or many **applications**, **sales**, **payments**, and **memberships/cards**, each with separate identifiers linked to the one customer UUID. Creating a new sale **never** issues a new customer ID.
5. **CUS-BR-05 [V2 PROPOSAL]:** A rejected application does not delete or recycle an existing customer ID. If a prospective applicant is not yet a canonical customer, keep their application/lead identifier separate; do not implicitly treat the application ID as the customer ID.
6. **CUS-BR-06 [V2 PROPOSAL]:** Allocate `NNNNNN` transactionally using a locked counter or atomic database allocator with a unique constraint on `(namespace, issuance_year, sequence)` and on the formatted external number. Repeated/parallel requests for the *same* customer must return the same ID.
7. **CUS-BR-07 [V2 PROPOSAL]:** Never embed customer names, birth dates, phone numbers, addresses, email, national ID details, membership tiers, salesperson names, or security/entitlement status into the ID.
8. **CUS-BR-08 [V2 PROPOSAL]:** Do **not** use customer ID as a login credential, password, authorization factor, QR privilege secret, or proof of active VIP membership. QR redemption must validate the card/membership and privileges server-side; retain QR plus fallback member/privilege code only, with **no NFC**.
9. **CUS-BR-09 [V2 PROPOSAL]:** If duplicates are discovered, an authorized and audited merge preserves all issued customer IDs as historical aliases pointing to the canonical customer; never reuse retired identifiers or silently transfer financial records. Verify legal/operational merge approval first.
10. **CUS-BR-10 [V2 PROPOSAL]:** Existing customers and legacy numeric/customer codes must remain valid and resolvable. Plan a reviewed backfill/alias migration only after inventory and historical reconciliation; **no bulk renumbering of current records**.
11. **CUS-BR-11 [V2 PROPOSAL]:** Search by customer ID for authorized Admin/Finance/Customer Management users. A customer can see only their own number and records. Public verification must not enumerate customers or expose personally identifiable data.
12. **CUS-BR-12 [V2 PROPOSAL]:** Changes to canonical customer account data must not mutate the external customer number. Maintain actor/time, previous/new values, and the reason for sensitive merges, corrections or retirement.
13. **CUS-BR-13 [PARTIALLY RESOLVED]:** The printed prefix and exact output format are approved: `AF-CUS-YYYY-NNNNNN`. Confirm the issuance trigger, annual-vs-lifetime sequence policy, and legacy-backfill strategy before generating a production number. **Do not silently activate these V2 proposal rules.**

**Example relationship [V2 PROPOSAL]:** `AF-CUS-2026-000001` may be linked to an application (existing V2 reference), a Gold sale `26101400001G1T12S`, a later separate Silver sale, multiple payment records, and one or more historical cards/memberships. **All remain independent records; the customer number stays unchanged.**

## 4. AFhomes VIP control-number format — business rules

**Formal pattern:** `YYMMDDNNNNNVTPMMS` (17 characters, no spaces or dashes in the control number itself).

| Field | Width | Source definition | Examples/validation |
|---|---:|---|---|
| `YYMMDD` | 6 | Transaction date: signing or first valid payment, per generator instructions | 14 Oct 2026 = `261014`; valid calendar date |
| `NNNNN` | 5 | Five-digit sale sequence; described as **annual** in `Reference!D8` | `00001`–`99999`; see conflict §13.1 |
| `VT` | 2 | Source VIP product/tier code | Only approved registered codes |
| `P` | 1 | Payment category | `C` = cash, `T` = terms/installment |
| `MM` | 2 | Payment term in months | `01`–`36`; **cash forces `01`** |
| `S` | 1 | Contract/standard flag | `S` = standard, `N` = non-standard |

**Source tier codes:** `B1` Standard Bronze; `B2` Super Bronze; `S1` Standard Silver; `S2` Super Silver; `G1` Gold; `P1` Elite Prime; `R1` Elite Royale. `G2`, `P2`, and `R2` are described as reserved in the workbook `Reference` tab and must not be offered as active V2 products without approval.

**V2 mapping not yet approved:** V2's Gold/Silver/Bronze catalog could map to `G1`/`S1`/`B1`, respectively, **only once product management verifies that the current definitions are equivalent**. Never silently enable the full workbook tier catalog as purchasable V2 membership products.

**VIP rules (VIP-BR-01 through VIP-BR-10):**

1. **VIP-BR-01 [SOURCE]:** A valid VIP control number is exactly 17 characters, with the segment order above.
2. **VIP-BR-02 [SOURCE]:** The official number is formed from the transaction's recorded date, sequence, tier, payment scheme, term, and standard flag.
3. **VIP-BR-03 [SOURCE]:** Cash terms encode `01`; installment terms encode the applicable 1–36 month duration, left-padded to two digits.
4. **VIP-BR-04 [SOURCE]:** Issued numbers are frozen; edits to the original row must not renumber the sale.
5. **VIP-BR-05 [SOURCE]:** Numbering is never recycled, including after cancellation, upgrade, or row reuse.
6. **VIP-BR-06 [SOURCE]:** Source Excel's `Generator` accepts a manually entered sequence; the `Register` calculates the sequence automatically. V2 must not expose a client-editable official sequence. **[V2 PROPOSAL]**
7. **VIP-BR-07 [SOURCE]:** Seller and buyer information can be added to a sales record, but the workbook's generator can produce a control number without seller accreditation. V2 business validation for approval is a separate rule.
8. **VIP-BR-08 [SOURCE]:** Sales documentation uses the same issued control number (examples: Reservation Agreement, Grant, VIP Card).
9. **VIP-BR-09 [V2 PROPOSAL]:** Generate an official number in the same database transaction that marks the V2 sale *issued*, after required validations. A draft may show only an unreserved **preview**, never a guaranteed final control number. This deliberately differs from Excel's immediate on-entry freeze and needs process approval (§13.3).
10. **VIP-BR-10 [V2 PROPOSAL]:** Record immutable original segment values and any subsequently modified operational values separately. Changes to the recorded payment plan must not alter the issued number; handle whether a new sale/reissue is needed through an approved workflow.

## 5. IGP series-number format — business rules

**Formal pattern:** `XYYMMDDNNNNTPMMS` (16 characters), where `X` is the issuing channel. `X=A` means AFhomes channel; `X=J` means JA&D's own channel. AFhomes IGP must not be issued from the JA&D-own sequence namespace or vice versa.

| Field | Width | Source definition | Validation |
|---|---:|---|---|
| `X` | 1 | Issuing channel (`A` or `J` in supplied systems) | Controlled list |
| `YYMMDD` | 6 | Date of reservation fee, or CTS signing date in the AFhomes IGP generator | Actual valid calendar date |
| `NNNN` | 4 | IGP sequence; source reference describes annual count | `0001`–`9999`; conflict §13.1 |
| `T` | 1 | Total Contract Price (TCP) in ₱ million bands, rounded upward | `1`–`8` for up-to-band; `9` for ₱9M and above |
| `P` | 1 | `C` cash / `T` terms | Controlled value |
| `MM` | 2 | Payment period | `01`–`36`, cash forces `01` |
| `S` | 1 | `S` standard / `N` non-standard | Controlled value |

IGP TCP band examples: ₱900,000 ⇒ `1`; ₱1,100,000 ⇒ `2`; ₱5,000,000 ⇒ `5`; ₱9,000,000 or above ⇒ `9`. A zero/negative TCP or amount lacking a verified price must be blocked for V2 issuance (**[V2 PROPOSAL]**); the source generator accepts manually selected TCP-band inputs.

**IGP rules (IGP-BR-01 through IGP-BR-07):**

1. **IGP-BR-01 [SOURCE]:** AFhomes-generated IGP series numbers start with `A`, and JA&D-own series numbers start with `J`.
2. **IGP-BR-02 [SOURCE]:** IGP numbers are 16 characters and contain a four-digit sequence and single-digit TCP band.
3. **IGP-BR-03 [SOURCE]:** AFhomes records its own-channel IGP sales, even when the product is JA&D-brokered; it must not duplicate the same AFhomes-originated sale in JA&D's own register.
4. **IGP-BR-04 [SOURCE]:** The number is frozen when issued, never silently modified; revised transactions use cancel-and-reissue with a new number and traceable old/new relationship.
5. **IGP-BR-05 [SOURCE]:** For an AFhomes seller also accredited through JA&D, the IGP record can show the JA&D-issued authority number in its linked/reconciliation reference.
6. **IGP-BR-06 [V2 PROPOSAL]:** IGP support should be behind a **disabled-by-default product/module feature flag** until approved commercial terms and operational roles are configured.
7. **IGP-BR-07 [V2 PROPOSAL]:** TCP band must be calculated server-side from the approved sale's contract price; the client must not select a more favorable band by hand.

## 6. Salesperson accreditation and dual identity

### 6.1 Format

**AFhomes:** `AAIYYMMNNNN` for IST or `AAOYYMMNNNN` for OST.  
**JA&D own team:** `JJIYYMMNNNN` / `JJOYYMMNNNN`.  
**JA&D-accredited AFhomes team:** `JAIYYMMNNNN` / `JAOYYMMNNNN`.

**Each accreditation number is 11 characters.** The date segment represents the month of accreditation (not the seller's birth date or the date a sale occurred). An accreditation number is not proof of current validity; current status must be checked independently.

### 6.2 Accreditation business rules

1. **ACC-BR-01 [SOURCE]:** Issue official accreditation numbers only for a recorded accreditation/authority-to-sell process; the JA&D source explicitly requires approval of Form JAD-AATS before issuance.
2. **ACC-BR-02 [SOURCE]:** For AFhomes, `Accreditation!F` stores the AA number. `Accreditation!N` stores the corresponding JA&D-authority number, if any.
3. **ACC-BR-03 [SOURCE]:** For JA&D, `AATS Register!F` stores the ATS number. The AFhomes AA number is the primary AFhomes identity for sales and incentives; the JA&D number is distinct.
4. **ACC-BR-04 [SOURCE]:** Accreditation starts with a recorded date; source validity is checked against a one-year window, and expiry/status must be evaluated separately from the number string.
5. **ACC-BR-05 [SOURCE]:** The spreadsheets calculate accreditation sequence counts by **accreditation month across all roster rows**, without a team-specific filter in the base formula. VBA's frozen-prefix collision safeguard separately checks a matching prefix. **Do not presume an independent IST and OST sequence policy is approved.** See §13.2.
6. **ACC-BR-06 [SOURCE]:** One seller can have an AFhomes AA number and a JA&D authority number at the same time. Use `person_id` and explicit accreditation relations rather than treating two identifiers as unrelated persons.
7. **ACC-BR-07 [SOURCE]:** In the AFhomes document's dual-engagement arrangement, one person can also have two role-specific accreditation rows, with cross-reference between them.
8. **ACC-BR-08 [V2 PROPOSAL]:** Issue numbers in the backend after an authorized accreditation approval, with typed actor, audit event, and row-level permission checks.
9. **ACC-BR-09 [V2 PROPOSAL]:** Never use name-only joins for seller identity: duplicate names are possible and name changes must not sever historical relationships.
10. **ACC-BR-10 [OPEN DECISION]:** Re-accreditation/renewal numbering requires explicit policy clarification: the JA&D reference says renewal issues a **new** number, whereas the AFhomes as-built worksheet has a **frozen original AA number** plus a `Latest (re-)accreditation` date. Preserve history and do not automatically regenerate AA/JA numbers until resolved.

## 7. Linked number, genealogy, and lookup

1. **LNK-BR-01 [SOURCE]:** Display a complete sale-linked reference as `<control/series number> - <accreditation number>` (spaces around the dash). If no eligible number exists, the source generator displays the sale number only.
2. **LNK-BR-02 [SOURCE]:** The VIP linked reference uses the seller's AFhomes AA number; the AFhomes IGP generator uses the seller's JA&D-authority number where recorded.
3. **LNK-BR-03 [SOURCE]:** A linked number does not replace the original immutable sale number; it is a display/reconciliation expression.
4. **LNK-BR-04 [SOURCE]:** AFhomes `ID Lookup` supports name, AA number, or JA number, showing the person's numbers and genealogy. The workbook uses name matching; see the V2 replacement below.
5. **LNK-BR-05 [V2 PROPOSAL]:** Lookup by exact sale number, exact accreditation number, exact existing application/payment reference, authorized name search, or a parsed linked reference. Resolve to canonical record IDs, not by splitting names or trusting client-submitted genealogy.
6. **LNK-BR-06 [V2 PROPOSAL]:** Use immutable sale-to-seller attribution records and effective-dated genealogy links. Do not recalculate a historical sale's original direct-seller attribution merely because the seller transfers teams later.
7. **LNK-BR-07 [V2 PROPOSAL]:** When multiple people match a name, return a disambiguation result; never silently select the first matching seller.
8. **LNK-BR-08 [V2 PROPOSAL]:** Restrict lookup results by role and ownership; do not reveal personal contact, finance, or commission information from a publicly accessible code.

## 8. Lifecycle and reissuance

| Event | Source behavior | V2 handling recommendation |
|---|---|---|
| VIP sale created | Generator/`Register` builds control number once required row fields are present and freezes it | Reserve number only within authorized issuance transaction; retain immutable issued value |
| VIP sale upgraded | New control number, new tier/payment terms; old transaction marked `UPGRADED` and linked from `Replaces` | New sale + explicit old/new relationship, never mutate old code |
| VIP cancelled | Status `CANCELLED`; row retained and number not reused | Preserve record and identifier, mark cancellation reason/actor/date; use financial reversals |
| VIP status `UPGRADED` | Source `Reference` says previously completed upgraded sale remains in some sales reports | Preserve separately reported historical-sale totals versus current/live or financially qualified sales; confirm KPI meaning |
| IGP transaction revised | Cancel-and-reissue, new control number | New issued record, `replaces_sale_id` + audit linkage |
| Seller transfers team | Upline/appointment history may change | Preserve effective-dated genealogy, original attribution and ID |
| Seller accreditation expires | Status/validity changes, identifier remains as historical reference | Do not delete number; check current seller eligibility when approving new work |
| Reaccreditation or renewal | Source rules differ; see §6.2 | Pending management ruling; preserve old and new identity history |
| Incorrect issued number | Source uses controlled director unlock/correction workflows | Do not permit arbitrary editing; require reviewed void/reissue or authorized exceptional repair with full audit |

**VIP upgrade detail [SOURCE]:** The `Reference` sheet states the superseded sale remains `UPGRADED`, its control number is retained, and the new sale uses a new annual sequence, records the prior number in `Replaces`, and receives new financial and document processing. The source also recalls/voids the old physical card and issues a new card with the replacement number. The V2 card-number relationship remains a policy decision (§13.4).

**Financial scope boundary:** The source qualification module may remove refunded/upgraded transactions from *Closed Deal TCP* even while the reference says `UPGRADED` remains counted as a historically completed sale. These are different metrics; do not collapse into one Boolean `counts_as_sale`.

## 9. Source control safeguards to preserve

**[SOURCE — Rev E VBA and Sheets controls]**

- `FreezeNumbers` converts generated number formulas into permanent values on the `Register`, `IGP Register`, and `Accreditation` sheets.
- `FrozenMonthMaxG` checks frozen sequence values for the **same year and month within each Register**; it increments collisions rather than recycling them. This behavior conflicts with the written *annual* numbering requirement (§13.1).
- `FrozenPrefixMaxF` checks an accreditation's frozen prefix (`AA` + team letter + `YYMM`) for duplicate sequence values and increments on collision.
- Issuing a sale also triggers commission-rate freezing (`FreezeSaleRates`). Its QA fix explicitly **does not freeze a zero rate** if the salesperson/referrer has not yet been entered; otherwise an accidental 0% could become permanent.
- Approvals record reviewer and timestamp and lock approved source rows; director unlocking and changes are audited.
- Workbook row locks and macro passwords are only spreadsheet-era implementations; V2 must enforce privileges on its own server and database.

**[V2 PROPOSAL]** Add transaction-safe sequence allocation with PostgreSQL uniqueness and idempotency, rather than reproducing a macro's scan of existing rows or depending on browser/UI state.

## 10. V2 server design — proposed, not yet implemented

### 10.1 Canonical model

Keep existing UUID primary keys and add or reuse only genuinely necessary fields/tables after a live schema inventory. Suggested **conceptual** entities:

- `business_identifier_registry`: `id`, `namespace`, `issued_code`, `subject_type`, `subject_id`, `issued_at`, `issued_date`, `sequence_scope`, `sequence_value`, `status`, `issued_by`, `source_policy_version`.
- `business_identifier_counters`: `namespace`, `sequence_scope`, `next_value`; database uniqueness across (`namespace`, `sequence_scope`).
- Existing canonical customer table / `customer_numbers` registry association: stable customer UUID, optional official `AF-CUS-YYYY-NNNNNN` number, issuance policy/version, aliases for verified historical merges; avoid duplicate customers or duplicate identity registries.
- `accreditation_numbers` (or extension of an existing seller-accreditation table): `person_id`, `team_type`, `issuer`, `owner_channel`, `accredited_on`, `code`, `status`, validity and optional predecessor/successor relation.
- Existing sale/purchase records: separate external control-number field and optional `replaces_sale_id`/lineage relationship.
- Existing audit infrastructure: append-only issuance, failed attempt, reissue, cancellation and correction events with actor, timestamp and reason.

**Avoid creating duplicate tables** for objects already represented in existing `afhomes_*` schema. Investigate the deployed migration history, API endpoints and current identifiers before choosing physical names. No direct SQL migrations are authorized by this document.

### 10.2 Allocation algorithm

1. Authenticate the user and authorize a specific operation on a specific validated sale/accreditation object.
2. Check that identifier has not already been issued for the subject; if one exists, return it (idempotent success).
3. Validate the official issuer/channel, tier, sale date, payment type, term, accreditation attributes, and approved policy version.
4. Determine the numbering namespace and sequence scope. **Stop if §13.1/§13.2 remain unresolved.**
5. Lock/increment the correct database counter transactionally; enforce maximum width (`99999` VIP, `9999` IGP/accreditation).
6. Construct the exact code, validate its length, allowed characters, date and segment consistency.
7. Insert into the unique identifier registry and associate it with the canonical subject; store origin segments, source policy version and audit event in the same transaction.
8. Commit once. A retry with the same idempotency key or subject returns the same number, never another allocation.
9. Fail closed if the counter is exhausted, an existing imported code conflicts, or any business validation fails; do not issue an approximate/different format without written policy authorization.

Suggested uniqueness constraints: unique `issued_code` in its code domain; unique (`namespace`, `sequence_scope`, `sequence_value`); one active official identifier of a given kind per subject where the business policy requires this. Note that some unrelated domains contain distinct prefixes; define collision uniqueness in the final schema after deciding cross-namespace scope.

### 10.3 Issuance states and events

Suggested lifecycle: `DRAFT` → `READY_FOR_ISSUANCE` → `ISSUED` → `APPROVED/ACTIVE` as applicable; exceptional paths include `CANCELLED`, `UPGRADED`, `SUPERSEDED`, `VOIDED`, `REISSUED`. Do not assume these are identical to the source spreadsheet's `Register` review states. Explicitly model *transaction* status separately from *identifier* issuance status.

Never use `MAX(number)+1` alone, random guesses, browser-side counters, or client-generated official numbers as a replacement for transactional allocation.

### 10.4 Roles, privacy and authorization

- **Clerk / OST / approved sales operator:** may submit a draft and initiate allowed issuance flow; may not edit official counter or mutate an issued code.
- **Supervisor / authorized sales approver:** may approve permitted records and review issuance data within scope.
- **Finance:** may reconcile control numbers against verified collections/receipts and initiate audited correction workflows subject to policy.
- **Super Admin:** may review global audit and approve policy changes; should not silently rewrite historical identifiers.
- **Customer:** may view their own permanent customer number, authorized sale and membership details, not enumerate anyone else's official identifiers.
- **Public QR verifier:** if enabled, must return a deliberately limited verification result; no unrestricted PII or financial disclosure.

Enforce Supabase RLS **and** server-resolved authorization; use a service-role key only in authorized server operations. Preserve append-only audit history. Avoid new unaudited security bypasses.

## 11. UI and integrations — proposed

**Admin Sales:** show application reference, VIP/IGP official number, linked seller number, status, original issuer/date, replacement link, and an audit/history tab. Allow searching and filtering by each identifier.

**Salesperson / OST:** show assigned accreditation code(s), validity, and issued sales they are authorized to view. QR can identify a sale through the authorized system; it does not itself grant privileges.

**Finance:** search by control number across payment approvals, duplicate flags, receipts, reversals and commission attribution; retain both original and correction records.

**HR and Genealogy:** expose AA number and any JA&D-authority number, person/role relationship, effective history, renewal and transfer status.

**Customer and Card:** display the customer number to the authenticated customer; retain existing QR plus fallback privilege/member code, without NFC. Customer number, card identifier, application number, and sale number must remain independently stored and associated by internal database UUIDs.

**Generated PDF/documents:** display the immutable official number and canonical sale reference consistently across Reservation Agreements, purchase documents, transaction receipts, and authorized member documents. Document formatting must not create a second number.

**Reconciliation/import:** provide a controlled import comparison report that flags duplicates, invalid lengths, unexpected prefixes, different source dates, missing seller links, and conflicting annual/monthly sequences. No source workbook import should change live financial tables without a separate approved plan.

## 12. Acceptance tests / Codex QA checklist

| Test | Expected outcome |
|---|---|
| Customer format (approved) | `AF-CUS-YYYY-NNNNNN`, 18 characters; no private data embedded |
| Customer creation (proposed) | One new canonical customer gets one number on approved issuance trigger |
| Repeat purchase (proposed) | Same customer ID with a second distinct sale/control number |
| Customer concurrent retry (proposed) | No duplicate IDs or separate numbers allocated for one customer |
| Customer account merge (proposed) | Historical aliases resolve; originals and financial audit trail remain intact |
| VIP format | Exact `YYMMDDNNNNNVTPMMS`, 17 characters, correct segments |
| VIP cash | `C` produces term `01` regardless of stale term input |
| VIP installment | 1–36 months, correctly zero-padded; reject 0/37/fraction |
| VIP tiers | Accept only V2-approved mapped source tier codes |
| VIP sequence boundaries | First value `00001`; reject overflow above `99999` |
| IGP format | Prefix `A` or `J` correctly, total 16 characters |
| IGP band | Upward rounding to ₱ million band; `9` for ₱9M+ |
| IGP sequence boundaries | First value `0001`; reject above `9999` |
| Accreditation format | `AAI`/`AAO`/`JAI`/`JAO`/`JJI`/`JJO` + `YYMMNNNN`, 11 chars |
| Invalid date | Reject impossible dates and invalid/missing date fields |
| Concurrent issuance | Parallel valid requests produce distinct correct codes (no collisions) |
| Idempotent retry | Same subject/request does not allocate a new number |
| Issued code immutability | Edits to date/tier/term/seller after issuance do not rename the code |
| Upgrade | New VIP code, old preserved as `UPGRADED`, new record has `replaces` link |
| Cancellation | Historical code retained, cannot be reused |
| IGP revision | New issued code, original retained/cancelled/superseded as policy specifies |
| Zero commission bug | Cannot silently freeze accidental 0% due to missing seller/referrer |
| Linked number | Correct seller/accreditation and optional no-accreditation result |
| Dual identity | AA and JA numbers resolve to the same person where connected |
| Name collision | Lookup disambiguates instead of using the first matching full name |
| Unauthorized issuance | API rejects attempts even if frontend controls are bypassed |
| Unauthorized changes | No direct client edits to counters, issued codes, or restricted audit data |
| Import collision | Explicit exception, no renumbering of valid historical identifiers |
| Date/sequence policy | Verified tests for the **approved** annual/monthly scope, including Dec/Jan transitions |
| Live migration safety | No alteration of existing payment/sales/commission results; backups and reversibility reviewed |

**Do not mark acceptance complete** until sequence scope and other open decisions are resolved and integration tests have run against the actual project schema.

## 13. Open decisions and conflicts (BLOCKING where indicated)

| Ref | Severity | What the uploaded sources actually show | Required decision |
|---|---|---|---|
| **OD-01** | **BLOCKER** | Both `Reference` sheets describe an **annual** VIP/IGP running sequence. Actual `Register!G5` and `IGP Register!G5` formulas count rows with the **same year AND month**; Rev E `FrozenMonthMaxG` also checks same-year/same-month rows. Both could therefore assign `00001` in different months while displaying the same year in the code. | Management must approve annual vs monthly allocation for VIP and both IGP namespaces. **Recommended:** annual, consistent with the written Reference; do not silently impose it. |
| **OD-02** | **RESOLVED — 2026-10-16** | Accreditation formulas count all accreditations in the same `YYMM` across teams. `FrozenPrefixMaxF` detects collision within a team-coded prefix. | **Resolved:** the monthly sequence is company-wide across IST and OST - one counter per `YYMM` shared by the `AAI` and `AAO` prefixes, with the high-water mark preserved across both (an imported or operator-typed number advances it). The prefix encodes the member's kind (IST = `AAI`, OST = `AAO`). No `JAI`/`JAO` series exists in V2. A kind change transfers the member to a fresh number of the new kind and retires the old number into the accreditation history. Prepared in `20261207000002_afhomes_official_aa_numbering.sql` (pending apply approval). |
| **OD-03** | High | Workbook generates/fixes number on data entry; supervisor approves later. | Is V2 official number issued when record becomes valid, upon approval, at first verified payment, or on contract execution? **Recommended:** explicit issuance transaction before document finalization. |
| **OD-04** | High | Spreadsheet `Reference` includes B1, B2, S1, S2, G1, P1, R1; V2 currently has only Bronze/Silver/Gold. | Confirm V2 tier mapping and whether legacy codes remain searchable but not sellable. |
| **OD-05** | High | Source says old physical VIP card is recalled and new card bears new sale number on upgrade; V2 uses separate membership/card ID and QR+fallback code. | Decide how card identifiers and printed sale numbers interact during upgrade and what existing card records should do. No NFC. |
| **OD-06** | High | JA&D `Reference` explicitly says accreditation renewal issues a new number; AFhomes Rev E preserves original AA number and tracks latest (re-)accreditation. | Approve renewable identifier behavior separately for AA and JA numbers; never invent a new code silently. |
| **OD-07** | High | Source generator permits an unlinked salesperson; its QA fix avoids permanently freezing a zero rate. | Decide whether approved V2 sales may have no commission-bearing seller (e.g., company-direct sale), and how a later seller assignment can be corrected. |
| **OD-08** | High | Workbook `UPGRADED` counts as previously completed sale in certain sales reports while refund/non-live qualification removes Closed Deal TCP. | Define distinct KPI/report metrics for historical sales, active transactions, and qualified sales. |
| **OD-09** | High | The product is JA&D-brokered; AFhomes IGP source issues its own `A` series. | Decide if IGP is an active V2 module, who can issue its numbers, and whether JA&D cross-company references must be integrated. |
| **OD-10** | Medium | Existing V2 has issued application/payment/member references. | Define compatibility/migration and audit policy; do not replace or reissue existing identifiers. |
| **OD-11** | Medium | IGP TCP band `9` covers ₱9M and above; source rates/terms are beyond this document. | Confirm price source, rounding precision, and whether product contract values can change after issuance. |
| **OD-12** | **PARTIALLY RESOLVED — issuance still BLOCKED** | Source workbook records buyers but defines no official customer-number series. User approved the official V2 external format `AF-CUS-YYYY-NNNNNN` on 2026-10-14. Existing V2 customer and application identifiers still need inventory. | **Resolved:** printed prefix/format. **Open:** first-issue trigger, year-scoped versus lifetime allocation behavior, duplicate-customer merges, legacy aliases/backfill. No production issuance until those are reviewed and separately approved. |

## 14. Implementation and release guardrails

- **Read-only audit first:** inventory current schema, existing identifiers, constraints, current sale-issuance stages, role permissions, QR handling and deployed code before modifying anything.
- **One Supabase project:** use the existing shared Supabase project and the established controlled migration workflow; no extra staging project is mandated.
- **Do not mix releases:** complete the separately approved outstanding security checkpoint before deploying these financial-identity changes. Security migration and ID-generator release are independent.
- **Migration:** create backward-compatible/additive changes; do not delete/rename prior sale, member, application, payment, or commission records. Backup and independently verify before live writes.
- **Shadow validation:** compare generated test cases against `Generator!B38`, `IGP Generator!C28`, `Register!H5`, `IGP Register!H5`, `Accreditation!F5`, and `Accreditation!N5` using representative dates/codes, but explicitly test *approved* decisions where formulas conflict with reference text.
- **Release sequence:** design → policy sign-off → migration review → local SQL and API tests → preview tests → user acceptance → independently approved production change.
- **Stop conditions:** inconsistent sequence policy, duplicate historical codes, unidentified authority chain, missing verified backup, security-checkpoint failure, reconciliation mismatch, or unapproved production financial change.

## 15. Proposed engineering work breakdown

1. `ID-01` — read-only inventory of existing V2 identity model, API endpoints and security policies.
2. `ID-02` — source-vs-current mapping report; document OD-01–OD-11 decisions and owner approvals.
3. `ID-03` — shared identifier parser/formatter/validator for VIP, AFhomes IGP, JA&D IGP and AA/JA/JJ.
4. `ID-04` — PostgreSQL issuance allocation, uniqueness, concurrency, idempotency and audit trail.
5. `ID-05` — existing sales application/approval workflow integration, preserving existing IDs and payment behavior.
6. `ID-06` — seller accreditation, dual identity, genealogy links and expiry/reaccreditation behavior.
7. `ID-07` — upgrade/reissue/cancellation lineage and historical reporting classifications.
8. `ID-08` — authorized global ID search and scoped seller/customer lookup.
9. `ID-09` — consistent control-number display in Admin, Finance, seller screens, PDF documents and QR verification.
10. `ID-10` — QA regression suite, historical-data reconciliation, preview release and production approval packet.
11. `ID-11` — implement the approved customer-ID format after outstanding OD-12 issuance and migration decisions are signed off; cover existing-record compatibility, customer lookup and deduplication/alias tests.

### Codex implementation instruction

> Treat this file as a **draft implementation specification, not blanket approval**. Perform a **read-only gap analysis of the actual AF Homes Ecofarm V2 repository and single Supabase project's schema**. Cross-check the attached build's source formulas and `Reference` policy rules. Identify existing mechanisms that can be reused. Report proposed migrations and tests, and obtain written decisions on OD-01 and OD-02 before implementing official VIP/IGP/accreditation allocation logic. **Customer-number format is approved; issuance, migration, and legacy-handling still require separate OD-12 sign-off.** Do not modify production, force-push, run live migrations, change commission rules, or modify already-issued IDs without separate explicit approval. Do not implement NFC.

---

**Document disposition:** Customer external ID format approved as `AF-CUS-YYYY-NNNNNN` on 2026-10-14. Ready for technical planning; **not approved for production issuance** until the remaining §13 decisions, including OD-12 operational details, are resolved.

## 16. IST employee identity correction — owner instruction, 2026-10-18

This explicit project-owner clarification supersedes earlier passages that describe
IST employees as requiring annual accreditation. IST is the Internal Sales Team:
company employees in the VD → SSM → SM hierarchy. Their AAI is a permanent employee
identifier. New IST creation and historical import require no accreditation start,
expiry or annual renewal. Role assignment and account access still require the
existing authorization. Preserve issued identifiers, UUIDs, genealogy and legacy
history; do not delete or rewrite old term-shaped records automatically.

OST remains an external sales representative requiring its existing accreditation,
signature verification, management approval and annual validity. Manual OST CREATE
still requires an active SM with its valid upperline. Matching an existing public
referral record does not change its lawful existing direct parent.

Keep the existing company-wide monthly AAI/AAO allocator. For a newly allocated AAI,
use the actual issuance month, not a fabricated accreditation date. Historical
AAI/AAO values remain unchanged, including valid supported legacy identifiers.

Import names are validated with shared contracts, then stored uppercase as directed;
Philippine mobile storage remains canonical +63. Excel/preview presentation uses
Proper Case conservatively and 09 text. Display casing never reconstructs legal
capitalization or rewrites an existing account. The current shared name helper
preserves casing, so this import-specific storage decision is explicit.

Local forward migrations 20261208000012 and 20261208000013 implement this distinction.
They are proposals for operational review, **not evidence of live application**.
