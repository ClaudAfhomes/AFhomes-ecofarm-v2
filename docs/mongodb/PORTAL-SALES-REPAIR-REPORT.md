# Portal sales, first login and disabled modules

28 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

## Source comparison

The live `develop` reference and local `origin/develop` both resolve to
`f512c1416550feaf0c79a6bb204c51d08fa990f6`. Its navigation includes Accreditation,
and its forced password change continues to the dashboard. The user explicitly
requested sidebar removal and automatic sign-out/login redirection instead.
No source branch, remote data or deployment was changed.

## Changes

- Native analytics now implements `team-sales` and `team-sales/overview`, using
  existing contracts, role permissions, date ranges and qualifying sale status.
  The former returned “Analytics route not found.” Team attribution requires
  frozen sale hierarchy snapshots; current genealogy cannot invent missing
  history. Admin/Finance can select an active VD/SSM/SM root, ordinary sellers
  cannot select another account, and the overview requires global/Finance scope.
- IST and OST sidebars no longer show Accreditation. Its source, private profile
  card and permission-controlled routes remain available; this request did not
  retire the underlying accreditation/renewal history.
- A forced staff password change now awaits sign-out and returns to the staff
  or admin login. Voluntary password changes retain their previous behavior.
  OST first-login setup now uses MongoDB portal/session information without a
  Supabase client, signs out and redirects to OST Login. Existing server-side
  temporary-password checks remain enforced.
- A self-only native `GET /sales-involvement` reuses the existing recorded staff
  involvement projection. VD, SSM, SM and OST portals show a paginated
  “Recorded sales participation” panel under their sales view, including the
  application/sale status and recorded role. The identity comes from the current
  active staff session, not query parameters. Sales/customer view permissions
  and deny-only restrictions apply. The administrative involvement endpoint
  retains its existing organization/customer permission requirements.
- Reports and Website CMS are off through shared feature flags, including
  navigation, direct portal routes and API entry points. Audit writes continue;
  the Reports/Audit viewing surface is disabled. Retained source and existing CMS
  edits were preserved. Redemption and Services remain off; manual points
  recording stays enabled independently.

## Existing records

Read-only inspection found four applications naming the same active VD, SSM, SM
and OST participants; all four identities have the required view permissions.
Two applications link to active normal sales recorded with Super Admin as seller
and no frozen seller ancestry. The participants can now read their recorded roles
and statuses. Those facts do not authorize rewriting seller identity, commission
beneficiaries or frozen history; direct seller/team KPI counts remain distinct
from application participation. No database repair or reference seed was needed.

## Verification

- 247 API tests passed across native analytics, real disposable HTTP portal
  participation, involvement, development access, router, retained reports,
  source IST and source analytics suites. Native HTTP proof covers all four
  participant roles, unlinked and finalized application statuses, anonymous and
  restricted denial, foreign-ID isolation, temporary-password gates, cookie
  revocation on logout, old-password rejection and new-password login.
- 59 admin UI tests, 17 public/OST UI tests and two feature-flag tests passed.
- API, UI, admin and web TypeScript checks and environment isolation passed.
  Repository lint passed with existing warnings and no errors.
- Live browser read-only check: Super Admin sidebar omits Reports/CMS; the
  Genealogy Team Sales Activity overview loads with validated data. A screenshot
  is kept locally in ignored `.tmp-bin/mongodb-team-sales-overview.png`.
- Individual role participation screens and first-login changes were tested with
  disposable HTTP/React fixtures, not by changing real user passwords in the
  browser. Manual browser acceptance for each sales role remains pending.

No existing passwords, seller records, commissions, snapshots or permissions were
modified. No migration, invitations, paid services, commit, push or deployment.
