# CODEX MASTER IMPLEMENTATION PROMPT
## AF HOMES ECOFARM V2 — OST CREATION FIXES, IST-TO-OST TRANSFER, ACCREDITATION RENEWAL & GENEALOGY RULES

### ROLE AND OBJECTIVE

Act as the senior full-stack engineer, database architect, QA engineer, and business-rule auditor for AF Homes Ecofarm V2.

Work on the existing GitHub project, primarily `claud/develop`, using the currently checked-out working tree.

Your mission is to **investigate, fix, implement, integrate, and test** the following:

1. OST creation: incorrect Sales Manager sponsor data and failed account creation.
2. OST registration: cascading address dropdowns, automatic ZIP code, and ID-type dropdown.
3. IST-to-OST account conversion, preserving the accreditation ID sequence.
4. Annual OST accreditation renewal based on the supplied official company renewal form.
5. Read-only applicant information with controlled editing.
6. Immutable accreditation history.
7. Genealogy transfer restricted to expired OST accreditation.
8. Complete integration, regression testing, and documentation.

This is an implementation task, not a documentation-only or planning-only task.

---

## PHASE 0 — REPOSITORY INSPECTION AND SAFETY

Before changing code:

- Read `AGENTS.md`, local development guidance, applicable project documentation, and existing business rules.
- Inspect existing OST creation, IST creation, accreditation, genealogy, account transfer, authorization, and Supabase functions.
- Locate the current ID generator and identify its exact behavior.
- Locate existing PSGC/location datasets and postal-code lookup services.
- Inspect the current OST registration and approval workflows.
- Inspect database tables, triggers, migrations, RLS policies, API handlers, UI components, and tests.

Use the existing architecture and reusable components. Do not create duplicate account-registration systems or duplicate source-of-truth tables.

**Repository safeguards**

- Preserve unrelated changes, including uncommitted work from other contributors.
- Do not overwrite another developer's work.
- Do not switch branches destructively.
- Do not change unrelated business logic.
- Do not push, merge, deploy, or execute live database migrations without separate authorization.
- Prepare new migrations and run safe local database tests.
- Do not expose secrets or personally identifiable information in logs.

Identify root causes before implementing fixes.

---

# PHASE 1 — FIX OST ACCOUNT CREATION

## 1.1 Incorrect sponsor lookup

**Current problem**

On the OST creation page, the field labeled:

`Sponsor (active Sales Manager)`

is retrieving Senior Sales Manager (SSM) accounts instead of Sales Manager (SM) accounts.

Even when an active SSM is selected, OST creation fails.

**Required correction**

- Inspect the sponsor lookup API/RPC, query, role resolution, frontend mapping, and validation.
- This specific manual OST creation field must retrieve active Sales Manager accounts only.
- Return actual SM accounts, not SSM accounts incorrectly labeled as SM.
- Exclude inactive, suspended, invalid, and unauthorized accounts.
- Display the Sales Manager's full name and appropriate identifying information.
- Use stable internal IDs for database relationships, not names.
- Validate the selected SM on the server.
- Confirm the chosen SM is connected to the correct SSM and VD genealogy.
- Prevent invalid sponsorship or broken genealogy relationships.

**Important distinction**

The existing public OST self-registration/referral-code flow supports valid referral codes owned by VD, SSM, or SM.

Preserve that existing behavior.

The manual creation field specifically labeled `Sponsor (active Sales Manager)` must use active SM accounts.

Do not mistakenly restrict the separate public referral workflow.

## 1.2 Fix OST creation failure

Investigate why account creation fails.

Examine:

- Frontend form validation.
- API request payload.
- Role authorization.
- Database constraints.
- Sponsor ID resolution.
- Genealogy assignment.
- Accreditation number assignment.
- Required fields.
- Transaction errors.
- RLS policies.
- Unhandled server exceptions.

Fix the actual root cause rather than applying a frontend workaround.

The operation must be atomic. A partially created account must not be left behind after a failure.

Provide understandable error messages without exposing internal database information.

**Acceptance criteria**

- Active SM accounts appear correctly.
- An eligible SM can be selected.
- All required data can be submitted.
- A valid OST account can be created successfully.
- The account connects to the correct genealogy.
- Existing approval and activation workflows remain functional.
- The database does not contain incomplete or orphaned accounts.

---

# PHASE 2 — STANDARDIZE OST REGISTRATION FIELDS

Use the existing IST account creation form as the reference implementation.

## 2.1 Cascading address dropdowns

Replace the free-text OST address selectors with the same location dropdown system used for IST.

Required hierarchy:

1. Region
2. Province
3. City/Municipality
4. Barangay

Behavior:

- Selecting a region filters available provinces.
- Selecting a province filters available cities/municipalities.
- Selecting a city/municipality filters available barangays.
- Changing a parent selection clears incompatible child selections.
- Street, house number, subdivision, and other detailed address information may remain editable text fields.
- Preserve proper PSGC identifiers and canonical location names.
- Reuse the existing location data source rather than building another unrelated location database.
- Handle NCR and other location hierarchy exceptions correctly.

## 2.2 Automatic ZIP/postal code

The ZIP code must populate automatically according to the selected location using the existing verified postal-code source.

Requirements:

- Correct mapping for Philippine municipalities and cities.
- Preserve leading zeroes.
- Never derive ZIP codes from PSGC numbers.
- Avoid hardcoded guesses.
- If a location has several valid postal codes, provide an appropriate selection or explicit verification method.
- Prevent invalid or stale ZIP codes after an address change.

## 2.3 ID type dropdown

Convert the OST ID-type field to a dropdown.

Reuse the approved ID categories from the existing IST registration form.

Do not invent new ID classifications.

Maintain consistent validation, labels, storage values, and verification requirements across IST and OST.

Test submission and retrieval of all supported ID types.

---

# PHASE 3 — IST-TO-OST ACCOUNT TRANSFER

## 3.1 Verify existing functionality

Locate the existing IST-to-OST transfer feature and verify whether it actually works from frontend to database.

Inspect:

- Transfer eligibility.
- Transfer initiation.
- Authorization.
- Validation.
- Approval, if existing business rules require it.
- Role conversion.
- Accreditation information.
- Genealogy assignment.
- Account authentication.
- Historical references.
- Transactions and audit logs.

Fix incomplete or broken functionality.

Reuse the existing transfer workflow rather than implementing an unrelated duplicate.

## 3.2 Accreditation ID transformation

**Critical business rule**

When an existing IST transfers to OST, its accreditation number must be transformed instead of generating an unrelated number.

Example:

| Before transfer | After transfer |
|---|---|
| AAI26100001 | AAO26100001 |
| AAI26100002 | AAO26100002 |
| AAI26100025 | AAO26100025 |

Transformation:

- Original IST prefix: `AAI`
- New OST prefix: `AAO`
- Preserve the complete existing numeric suffix.
- Do not allocate a fresh sequential OST number.
- Do not invoke the normal new-account accreditation ID generator for this transfer.

**Example**

`AAI26100001` → `AAO26100001`

This preserves the original member sequence while changing the accreditation classification.

Maintain:

- The same underlying person/account identity where the architecture permits.
- Historical IST accreditation number.
- Existing identity and contact information.
- Financial and historical records.
- Audit history.
- Appropriate membership and account relationships.

Ensure that foreign keys, receipts, and historical references remain valid.

If the converted number already exists, reject the conversion safely and report the conflict for authorized resolution. Never overwrite another member or silently generate a replacement.

Prevent duplicate transfers and concurrent transfer races.

## 3.3 Accreditation date after transfer

An IST transferring to OST receives an OST accreditation date equal to the **effective transfer date**.

Example:

| Field | Value |
|---|---|
| Previous accreditation type | IST |
| Previous AA number | AAI26100001 |
| New accreditation type | OST |
| New AA number | AAO26100001 |
| OST original accreditation date | October 17, 2026 |
| Initial OST accreditation duration | 1 calendar year |
| Renewal requirement | Annually |

Follow the project's established effective-date and expiry-boundary convention.

The original IST accreditation date must remain preserved in IST history, but the original OST accreditation date must be the date of transfer.

**Important**

IST accounts do not have annual accreditation renewal.

Only OST accreditation follows the annual renewal process.

An IST becomes subject to yearly accreditation renewal only after being converted into an OST.

---

# PHASE 4 — IMPLEMENT ANNUAL OST ACCREDITATION RENEWAL

## 4.1 Official renewal form reference

Implement the workflow according to:

**AFHOMES HOTSPRING & ECOFARM RESORT CORP.**

**SELLERS ACCREDITATION RENEWAL FORM V1.3**

Sales & Marketing Department

The user-provided photograph of the company form is the reference for the workflow's content and approval structure.

Recreate its relevant fields digitally, using the existing project's design system.

Do not treat renewal as a completely new OST account registration.

A renewal continues an existing OST account and retains its AAO accreditation number.

## 4.2 Renewal header

Include:

- Date of Renewal
- Renewal Form Number
- Accreditation Validity Period
- Accreditation Status
- Existing OST AA Number

Generate a unique renewal transaction/form number, separate from the member's accreditation number.

Keep a complete history of renewals.

## 4.3 Section I — Applicant Information (For Renewal)

Show the existing registered data automatically.

Fields from the official form:

**Program Status**
- VIP Privilege Card Holder
- Non-VIP Client

**VIP Privilege Card Type**
- Bronze
- Silver
- Gold

**Personal Information**
- Full Name
- Date of Birth
- Age
- Sex
- Civil Status
- Home Address
- Mobile Number
- Email Address
- Facebook Name (optional)
- Business/Employer Name (if applicable)
- Job Position

Load these values from the currently registered account.

Program status and VIP tier must reflect the actual authoritative membership data, not user-selected claims.

### Frozen/read-only applicant information

By default, every populated applicant field must be read-only.

Display a visible action:

**Update Information** or **Request Information Change**

When selected:

- Enable editing of permitted personal information.
- Display the proposed changes.
- Record the old and proposed values.
- Validate the edited fields.
- Require a reason for sensitive identity changes where appropriate.
- Follow the existing authorized profile-update/verification workflow.
- Persist an audit trail.
- Prevent unauthorized changes.
- Ensure the renewal form reflects the latest verified information at final submission.

Examples:

**Mobile number**

Old: `09123456789`

New: `09987654321`

**Surname after marriage**

Old: `Maria Santos`

New: `Maria Santos-Reyes`

Civil status and supporting identity details should be handled consistently with existing validation rules.

Do not allow the edit button to alter authoritative VIP status, historical dates, accreditation numbers, or protected account relationships.

A previously submitted renewal must retain its own historical applicant-data snapshot even if the person's profile changes later.

---

# PHASE 5 — ACCREDITATION HISTORY

Implement Section II of the official renewal form.

## 5.1 Historical fields

Required:

**Original Date of Accreditation**

Automatically retrieve the original OST accreditation date.

For transferred IST accounts, this is the IST-to-OST transfer date.

This field must be permanently read-only.

**Last Accreditation Expiry Date**

Retrieve the expiry date of the accreditation period being renewed.

This must also be read-only.

When a renewal is submitted, preserve this date as an immutable snapshot in the renewal record.

After approval, update the account's current accreditation expiry as appropriate, without modifying the historical values stored on previous renewals.

## 5.2 Renewal period

OST accreditation validity is annual.

Use calendar-year date arithmetic, not a fixed 365-day assumption.

Calculate the new expiry using approved business rules, considering the previous expiry, late renewal, effective date, and prevention of improper overlapping periods.

Example for an on-time renewal, subject to the existing date-boundary convention:

- Original OST accreditation: October 17, 2026
- Initial annual expiry: October 17, 2027
- Renewal: October 2027
- New expiry after approved renewal: October 17, 2028

Do not overwrite original accreditation history.

An accreditation renewal must not generate another AAO member number.

Store renewal transactions independently.

---

# PHASE 6 — OPTIONAL REFERRER INFORMATION

Based on the official form, include:

**Have there been changes in Referrer details?**

Options:

- None / No
- Yes

If No, retain the existing referrer information and do not require new referrer details.

If Yes, display the additional fields.

**Reason for Change**
- Required when requesting a change.

**Old Referrer**
- Full Name
- Mobile Number

**New Referrer**
- Full Name
- Mobile Number

The old referrer information must come from existing verified genealogy records.

The new referrer must be selected or verified through a real eligible seller record rather than accepted as unverified free text.

Do not change genealogy merely because someone entered another person's name.

**Critical distinction**

Updating a referrer's contact information is not automatically a genealogy transfer.

Changing the actual genealogy parent must follow the separate eligibility and management-approval rules in Phase 7.

The official form explicitly states that new referrer details are subject to management review and verification.

Preserve that requirement.

---

# PHASE 7 — RESTRICT OST GENEALOGY TRANSFERS

## 7.1 Core business rule

**An OST may transfer to another team or genealogy only when the OST accreditation has already expired.**

This is mandatory and must be enforced on the server and in the database-level workflow.

Examples:

| OST condition | Genealogy transfer |
|---|---|
| Active accreditation | Not allowed |
| Accreditation not yet expired | Not allowed |
| Accreditation expires tomorrow | Not allowed |
| Accreditation expired yesterday | May request transfer |
| Expired accreditation, pending verification | Not yet finalized |
| Expired accreditation, approved transfer | Allowed to complete |
| Renewed and active before transfer approval | Must be revalidated and blocked if no longer eligible |

Do not allow active OST members to bypass this restriction through:

- Profile editing.
- Renewal editing.
- Direct API requests.
- Admin screens without proper authorization.
- Sponsor ID modification.
- Database RPC calls.
- Existing genealogy reassignment functions.

## 7.2 Genealogy structure

Preserve existing AF Homes genealogy rules:

`VD → SSM → SM → OST`

However, valid OST referral-code owners may be VD, SSM, or SM in the existing public registration workflow.

Do not fabricate missing SSM or SM levels for OST accounts directly referred by higher levels.

When a permitted genealogy transfer occurs:

1. Verify that the OST accreditation has expired.
2. Require the reason for transfer.
3. Validate the proposed new eligible sponsor.
4. Submit the transfer for authorized review.
5. Verify approval permissions.
6. Recheck accreditation status before committing the actual genealogy change.
7. Update the OST's direct parent and derived upperline consistently.
8. Preserve the old genealogy in historical/audit records.
9. Maintain correct genealogy visibility for VD, SSM, SM, and Super Admin.

Prevent circular, invalid, or cross-role relationships.

Use transactional updates.

## 7.3 Renewal and genealogy transfer interaction

An OST may submit a renewal without changing teams.

For an expired OST requesting both renewal and team transfer:

- Treat renewal and genealogy transfer as distinguishable operations.
- Resolve and approve the eligible genealogy transfer before finalizing a renewal that would make the account active again, or use an equivalent authorized atomic workflow.
- Never temporarily bypass the expiration rule.
- Do not move the OST automatically merely because renewal was requested.
- Reject invalid or unauthorized sponsor changes.

Document the workflow and test the expiry-to-active transition.

---

# PHASE 8 — RENEWAL CERTIFICATION AND APPROVAL

Follow the official paper form's approval structure.

Include applicant certification and the applicable existing authorization/signature workflow.

The form contains:

**Applicant**
- Signature over Printed Name of Applicant

**Referrer**
- Signature over Printed Name of Referrer

**Endorsed By**
- Sales Manager

**Approved By**
- Senior Sales Manager / Sales Vice Director

Map the Sales Vice Director title to the existing appropriate VD role.

Do not create a duplicate organizational role solely for this label.

Use authenticated approval records and existing signature infrastructure where available.

Never fabricate signatures.

Recommended workflow structure, subject to existing authorization rules:

`Draft → Submitted → Under Review → Endorsed → Approved / Rejected`

Handle returned-for-correction applications if supported by the current workflow.

Important requirements:

- OST submits renewal.
- Authorized Sales Manager reviews/endorses as applicable.
- Authorized SSM or VD approves according to verified organizational permissions.
- Renewal becomes effective only after the required approvals.
- Rejections and corrections have recorded reasons.
- All actions have timestamps and actor IDs.
- Unauthorized users cannot approve their own requests unless explicitly permitted by existing policy.
- Do not automatically approve a renewal just because the form is completed.

Verify the actual hierarchy and permission rules in the repository before implementing an approver-routing change.

---

# PHASE 9 — RENEWAL UI AND ACCOUNT VISIBILITY

Add renewal functionality to the existing OST member management and applicable OST account interface.

Provide clear actions such as:

- View Accreditation
- Renew Accreditation
- View Renewal History
- Update Information
- Request Genealogy Transfer (only when eligible)

Show current accreditation details:

- OST accreditation number
- Original OST accreditation date
- Current expiry date
- Accreditation status
- Renewal history
- Current genealogy/referrer

Show clear loading, empty, validation, and error states.

Never display mock accreditation dates or fabricated renewal records.

Disable actions when inappropriate, with an explanation.

Prevent duplicate renewal submissions and repeated approval side effects.

Preserve the existing responsive design and shared UI components.

Do not redesign unrelated screens.

---

# PHASE 10 — DATABASE AND SECURITY REQUIREMENTS

Inspect existing schema before adding migrations.

Use existing account, accreditation, seller, genealogy, authorization, and audit structures wherever possible.

Implement missing structures only when genuinely required.

The system must support:

- Historical IST and OST accreditation identities.
- Original OST accreditation date.
- Current OST expiry date.
- Immutable renewal history.
- Previous expiry snapshots.
- Renewal application status.
- Applicant information snapshots.
- Authorized information changes.
- Old and new referrer details.
- Genealogy transfer request history.
- Approval/endorsement history.
- Actor and timestamp auditing.

Server-side enforcement is mandatory.

Do not rely only on disabled frontend fields.

Ensure:

- Database uniqueness and idempotency.
- Proper foreign keys.
- Secure access controls.
- Transaction-safe conversions.
- Correct role restrictions.
- Non-destructive migrations.
- Compatibility with existing data.
- No regression to financial records, commissions, points, or membership history.

Do not modify historical monetary or points records merely because an account is converted or renewed.

Preserve the project's single-Supabase-project operating model.

Prepare and validate migrations locally. Do not execute them on the live Supabase project without approval.

---

# PHASE 11 — REQUIRED AUTOMATED TESTING

Create or improve tests covering the actual business rules.

### A. OST account creation

- Sponsor dropdown displays active SM accounts.
- SSM accounts are not incorrectly returned as SM.
- Eligible SM selection succeeds.
- Valid OST account creation succeeds.
- Invalid sponsor is rejected.
- Proper upperline relationships are created.
- Failed registration does not leave partial records.
- Existing VD/SSM/SM public referral registration still works.

### B. Address and ID fields

- Region/province/city/barangay cascading works.
- Parent changes reset invalid child values.
- Postal code correctly populates.
- Missing or ambiguous postal-code mappings are handled safely.
- ID type dropdown contains the existing approved categories.
- Address and ID data persist and reload correctly.

### C. IST-to-OST conversion

- Existing IST successfully converts.
- `AAI26100001` becomes `AAO26100001`.
- Numeric sequence remains unchanged.
- No new OST sequence is allocated.
- Duplicate destination ID is rejected.
- Account identity and valid historical relationships are retained.
- Original OST accreditation date equals transfer date.
- Annual OST expiry is correctly established.
- Repeated transfer requests do not duplicate the conversion.
- Concurrent transfer requests are handled safely.
- IST does not receive OST renewal functionality before conversion.

### D. OST renewal

- Existing applicant information auto-populates.
- Fields are read-only by default.
- Authorized profile update works.
- Unauthorized edits are rejected.
- Changes have an audit history.
- Original OST accreditation date is immutable.
- Last expiry snapshot is immutable.
- Renewal does not change the AAO number.
- Approval produces the correct next annual validity.
- Rejected renewal does not extend accreditation.
- Renewal history remains complete.
- Date arithmetic handles leap years and boundaries.

### E. Genealogy transfers

- Active OST cannot change teams.
- Expired OST may request a change.
- Unauthorized transfers are blocked.
- Management approval is required.
- Old genealogy history is preserved.
- New genealogy has the correct parent/upperline.
- Current accreditation eligibility is rechecked at execution.
- Simultaneous renewal and transfer cannot bypass expiration rules.
- Existing visibility and authorization remain valid.

### F. Regression

Run relevant:

- Unit tests.
- API tests.
- Database tests.
- Authorization and security checks.
- Frontend component tests.
- Typecheck.
- Lint.
- Build.
- Existing registration/approval regression tests.

Do not claim a test passed unless it actually ran and passed.

---

# PHASE 12 — DOCUMENTATION AND FINAL REPORT

Update applicable project documentation to reflect:

1. OST creation and sponsor-selection logic.
2. Standardized address and ID-type fields.
3. IST-to-OST conversion and AA-number transformation.
4. Annual accreditation renewal rules.
5. Original accreditation date and expiry history.
6. Editable applicant information rules.
7. Renewal form field mappings.
8. Approval and endorsement workflows.
9. Genealogy transfer expiration requirement.
10. Security enforcement and database changes.

Document any business-rule ambiguity that cannot be resolved through existing code or approved project documentation. Do not silently invent policy.

## REQUIRED FINAL OUTPUT

Report:

**1. Root causes**
- Why the sponsor selector returned SSM instead of SM.
- Why OST creation failed.
- Whether IST-to-OST transfer worked before the changes.

**2. Implemented fixes**
- Files changed.
- API changes.
- UI changes.
- Database changes.
- Accreditation and genealogy changes.

**3. Verification**
- Actual test commands.
- Passed/failed counts.
- Remaining failures.
- Regression results.

**4. Data safety**
- Historical ID preservation.
- Duplicate handling.
- Accreditation history preservation.
- Account and financial-data integrity.

**5. Remaining work**
- Any required business approval.
- Pending live migration.
- Pending deployment or manual testing.

## DEFINITION OF DONE

The task is complete only when:

- OST creation works with correct SM selection.
- Address and ID-type inputs work consistently with IST.
- Existing IST accounts can convert to OST correctly.
- Converted accreditation numbers preserve their existing suffixes.
- OST accreditation begins on the effective transfer date.
- OST accreditation requires yearly renewal.
- IST accreditation does not require annual renewal.
- Renewal fields match the official form.
- Applicant information is frozen by default with controlled updates.
- Original accreditation history cannot be overwritten.
- Referrer changes undergo proper validation.
- Only expired OST accreditation permits genealogy transfer.
- The required approval workflow is enforced.
- Relevant tests pass and results are documented.

**Start by auditing the existing implementation. Then implement the fixes in controlled phases, run all relevant local tests, and provide a complete verification report. Do not stop after analysis unless blocked by a genuine prerequisite. Do not push, deploy, or run live SQL without explicit authorization.**