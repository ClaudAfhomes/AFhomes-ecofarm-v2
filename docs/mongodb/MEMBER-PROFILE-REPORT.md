# Native member profile and sales-involvement checkpoint

27 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.
CMS remains last by the user's explicit instruction.

## Delivered

`PATCH /members/:id` now supports the existing shared profile editor for members
with a network profile. It retains the existing Zod contract, normalization,
verified province/city lookup, optional private-field replacement and UI.

The native transaction shares the organization lock and rechecks update rights
and the existing strict member-detail genealogy scope. Position changes resolve
active roles and enforce permission subsets, immediate-upline rules, a reason
for actual head moves, cycle denial and informational OST-referrer rules. OST
kind changes and OST team moves cannot be performed through profile editing.
The controlled team-transfer endpoint remains separate.

Names, login email, temporary credentials, profile, position/head changes and
field-only audit commit together. Duplicate email or audit failure leaves the
old account and profile intact. Credential resets revoke existing sessions and
set the mandatory first-login password-change flag. There are no invitations,
new MFA requirements or administrator bootstrap/reset operations. A Super Admin
is not treated as a network member by this route. AA records, historical sales,
commercial snapshots and accreditation dates are not rewritten.

TIN and government ID replacements remain masked in native reads and absent
from audit payload values. Passwords are hashed with the existing Better Auth
helper and never written into audit fields or printed.

`GET /admin/afhomes/staff/:id/sales-involvement` now implements the read-only
projection from `20261208000018_afhomes_staff_sales_involvement.sql`. It requires
both staff-view and customer-view permissions and validates pagination. It uses
one read-only snapshot transaction, grouped before pagination:

- Recorded seller and frozen sale-hierarchy participation.
- Explicit application roles and reservation/sale links.
- Committed original import provenance, excluding superseded sources and aliases.
- Distinct role labels, source references and the source customer-number priority.

It never reconstructs historical participation from current genealogy. Displaying
recorded import provenance does not certify imports, verify money or enable
unported import reconciliation/analytics mutations.

## Verified locally

- **78 API tests / six files passed**, exit 0: member profile edits, team moves,
  native genealogy, account creation, staff involvement and development gates
  (`.mongodb-member-edit-acceptance.log`).
- Final source-parity, credential-reset, populated/empty involvement and adjacent
  organization proof: **20 tests / three files passed**, exit 0
  (`.mongodb-member-profile-final-proof.log`). These overlap the preceding run.
  The reset case first completes the user's
  own first-login change, proves the flag is false, then proves an administrator
  reset returns it to true and rejects the previous credential/session.
- Audit fault injection rolls back email, password, name, profile, role and head
  writes. Denial tests cover anonymous access, deny-only restrictions, peer scope,
  privilege escalation and treating an administrator as an editable member.
- Numeric workbook references retain JSON text semantics; uncommitted import
  rows stay excluded. Authorized contact corrections on inactive roles do not
  reactivate those roles. Both cases have native regression tests.
- Final API TypeScript passed. Source/built environment isolation passed across
  733 browser and 401 server files. Scoped whitespace checks passed.
- Chrome saved a fictional IST's name, employer and job through the unchanged
  editor. Reload preserved them and its original `AAI26100001`; private fields
  stayed masked. Screenshot: `.tmp-bin/mongodb-member-edit-proof.jpg`.
- A refreshed disposable runtime rendered a populated sales-involvement panel
  with its real synthetic seller record, customer link and sale reference after
  reload. No
  browser console errors were recorded. Screenshot:
  `.tmp-bin/mongodb-member-sales-proof.jpg`.
- Fresh disposable HTTP setup also completed the core purchase through full
  verified payment, finalization, membership activation and manual-code VIP
  activation, plus normal IST/directly accredited OST creation.

The complete API suite was not rerun here. No browser source, dependency, CMS
source, production routing or environment file changed. Existing real accounts,
Atlas records/indexes, Supabase data and remote branches were not modified.
Nothing was staged, committed, pushed or deployed.

## Remaining

Follow-up: [native kind conversion checkpoint](MEMBER-KIND-CONVERSION-REPORT.md)
implements both directions. Its remaining browser limit and verification scope
supersede the conversion item below.

Controlled IST/OST kind conversions and remaining official OST correction paths
still require their own history-preserving implementations. Direct OST onboarding
can have no IST-style network profile; ordinary profile editing does not create
one or replace its official accreditation records. Import/workbook continuation,
claim proof/reconciliation, certified analytics/reporting and outstanding public
browser acceptance remain. CMS is last. This is not full-platform cutover.
