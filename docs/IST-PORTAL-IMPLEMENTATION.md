# IST portal — Team Commissions revision

Finalization evidence and the later light-theme/browser checks are recorded in [Development verification — 2026-10-23](DEVELOPMENT-FINALIZATION-2026-10-23.md). The verification table below describes the earlier scoped revision, not the finalization run.

2026-10-23. Implemented locally on `claud/clean-develop`. This report supersedes the earlier OST-only Team Commissions behavior. Unrelated local work was preserved. No commit, push, merge, deployment, live SQL, migration, permission grant or financial-record write was performed.

## Root cause and scope

The original Team Commissions report filtered every leader's history to OST beneficiaries. That matched the earlier specification but omitted the personal and management commissions required by the revised position matrix. The presentation also reused the dark IST page background and generic OST performance cards.

The revision changes the existing `/sales/ist/team-commissions` view, its existing read-only API and shared contract. It adds no parallel endpoint or commission calculation system. The subsequent approved color update extends the light theme to My Commissions, My Sales and Team Sales, preserving their existing data scopes.

## Access matrix

| Authenticated position | Personal commissions | Other permitted beneficiaries | Excluded |
| --- | --- | --- | --- |
| VD | Own VD records | Authorized SSM, SM and OST downline | Another VD or another branch |
| SSM | Own SSM records | Authorized OST downline, including through subordinate SMs | Parent VD, other SSMs, SM personal commissions and unrelated OSTs |
| SM | Own SM records | OST members directly assigned through an active authoritative relationship | VD, SSM, other SMs, indirect OSTs and other branches |
| OST | Existing own-record access | None | Team monitoring remains forbidden |
| Other staff roles | Existing endpoints unchanged | None through the IST report | Team report remains forbidden |

Direct OST assignments under VD and SSM work without requiring intermediate management levels. The existing genealogy projection is reused unchanged. Current downline visibility and recorded sale-time hierarchy snapshots must both authorize non-personal commission monitoring; current ancestry never replaces missing historical attribution. Personal records use explicit beneficiary ownership.

## Authorization and aggregation

- Every request re-resolves the principal and effective module permissions. Team monitoring requires an IST role, dashboard view and commission view. Sales figures still require the existing sales-view permission.
- The authenticated role selects the scope. The `role` query field only narrows history; SSM/SM attempts to filter to an unauthorized position receive 403. Client-selected owner/team fields are rejected with 400.
- New narrow role lookups are isolated to Team Commissions. Queries retain date predicates, ordered response-cap pagination and batched IDs.
- Organization records are combined by commission ID before aggregation. Personal and OST totals remain separate. VD organization totals include the VD's personal records without claiming other beneficiaries' earnings as their own.
- Pending includes `pending`, `payment_verified` and `final_qualification_pending`. Earned includes `earned` and `paid` once each; paid is a subset. Cancelled records remain in history but contribute to neither earned nor pending. No unsupported lifecycle state is introduced.
- “My Total Commission” means qualified earnings including paid, with pending excluded. The UI states this definition. Existing recorded amounts are authoritative; sale existence does not create entitlement.
- Exact-decimal helpers and lifecycle/position schemas are reused. No rate, eligibility, verification, qualification, payout or settlement rule changed.
- Reporting remains inclusive UTC: sales use sale creation date and commissions use commission creation date. Table filters do not change full-period summaries.

## UI changes

Team Commissions, My Commissions, My Sales and Team Sales use the system canvas, white raised surfaces, existing green/gold tokens and shared typography. Its cards show organization totals for VD, separate personal and OST figures for SSM/SM, and OST members with/without sales. VD also receives a position breakdown with pending, earned, paid and record counts. Paid-in-earned and pending qualification are explained in plain text.

History includes salesperson, position, commission/sale references, amount, lifecycle status, payment marker, creation date, earned date and paid date. The payment marker reports existing paid status; it introduces no payout process. Allowed-role and lifecycle filters, explicit search/apply, clear and 25-record pagination reuse the URL and typed-client flow. Period/filter changes reset pagination. Search covers visible names and references.

Desktop cards use multiple columns, tablet cards reduce columns, and mobile cards stack. Tables retain shared accessible captions and mobile field labels. Sidebar groups, icons, active states and the collapsible drawer are unchanged.

## Portal identity

`IST Portal` is the existing umbrella label for VD/SSM/SM sessions routed through the `/sales` staff namespace. The header shows the account's actual position. This combination is intentional in the current implementation, rather than an authorization inconsistency. No label or portal restructuring was performed.

## Files modified in this revision

- `api/_handlers/ist-portal.ts`
- `api/_handlers/ist-portal.spec.ts`
- `packages/contracts/src/schemas/ist-portal.ts`
- `apps/admin/src/features/ist/IstPortalPage.tsx`
- `apps/admin/src/features/ist/IstPortalPage.module.css`
- `apps/admin/src/features/ist/IstPortalPage.spec.tsx`
- `apps/admin/src/features/ist/TeamCommissionSummary.tsx` (new presentation component)
- `apps/admin/src/features/ist/services.ts`
- `docs/IST-PORTAL-IMPLEMENTATION.md`

Genealogy, Members, hierarchy assignments, registration, accreditation, commission earning/payout handlers, and customer/payment logic were not edited in this revision.

## Verification

| Check | Result |
| --- | --- |
| API portal, existing Finance commission security, genealogy visibility and router checks | PASS: 114 tests across five files, including 28 portal cases |
| IST frontend tests | PASS: 14 tests, including actual routing, retained date navigation, drawer interaction, light Team layout, VD breakdown and table filters |
| IST, Genealogy, Members and existing analytics dashboard regression subset | PASS: 103 tests across 11 files |
| Shared contracts suite | PASS: 319 tests across 22 files |
| API and Admin typecheck | PASS |
| Admin build | PASS; existing bundle-size warning remains |
| Lint of changed IST frontend files | PASS |
| Browser/server environment isolation | PASS |
| Whitespace check of revision files | PASS |
| Authenticated visual/browser acceptance | NOT VERIFIED: the available local browser redirects to login; an authorized IST session is required. No screenshots of business data were captured. |

Full repository suites were not rerun for this scoped revision. The preceding run had two payment-queue search failures, 34 Admin failures in other screens/mocks, and a web OST-test unused import blocking root gates. Those unrelated files were left intact; focused checks do not establish a fully green repository or release acceptance.

Current logs are in Windows TEMP: `afhomes-team-commission-build.log`, `afhomes-team-commission-regression.log`, `afhomes-team-commission-ui-tests.log` and `afhomes-team-commission-contracts.log`. No migration or new financial policy is required. Live Auth/PostgREST behavior and deployed state remain unverified.
