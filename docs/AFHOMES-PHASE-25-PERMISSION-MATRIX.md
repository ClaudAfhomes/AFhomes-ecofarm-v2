# Phase 25 permission and portal matrix

This report is derived from `DEFAULT_ROLE_BASELINE`, the implicit Super Admin
rule, and the separate customer ownership model. `V`, `C`, `U`, and `D` mean
view, create, update, and delete. An omitted action is denied. No baseline role
has delete. Per-user restrictions can only subtract from these effective grants.

| Role | Effective baseline modules | Actual staff navigation | Direct API result |
|---|---|---|---|
| Super Admin | Every active module, implicit full CRUD | Every implemented destination | Allowed where an endpoint exists; protected Super Admin mutations remain blocked |
| Admin | dashboard V; card sales VC; plans VU; customers VCU; ID documents V; uplines VCU; payment verification VU; activation VU; points V; commissions VU; genealogy V; OST members V; OST registrations V; referrals V; catalog VCU; redemption V; departments VC; roles VCU; staff VCU; audit V | Dashboard, Sales & Customers, Finance, Redemption, Sales Network, Organization, Reports, Audit | Allowed only for the listed action grant; role assignment remains capped to the caller's effective subset |
| Finance | dashboard V; payment verification VU; activation VU; points V; commissions V; customers V; card sales V; plans V | Dashboard, Sales & Customers reads, Finance, Reports | Financial reads and update workflows allowed; HR, CMS, genealogy correction, catalog mutation, and OST approval denied |
| HR | dashboard V; staff VCU; departments VC | Dashboard, Organization | Staff/department actions allowed by grant; finance, sales, genealogy, redemption, CMS, and OST APIs denied |
| Vice Director | dashboard V; card sales VC; customers VCU; ID documents V; plans V; genealogy V; referrals V; OST members V; OST registrations V; commissions V | Dashboard, Sales & Customers, Sales Network, Reports | Seller/team-scoped reads and permitted creates allowed; unrelated teams and administrative updates denied |
| Senior Sales Manager | dashboard V; card sales VC; customers VCU; ID documents V; plans V; genealogy V; referrals V; commissions V | Dashboard, Sales & Customers, Sales Network, Reports | Team-scoped reads and permitted creates allowed; unrelated teams and OST approval denied |
| Sales Manager | dashboard V; card sales VC; customers VCU; ID documents V; plans V; genealogy V; referrals V; OST members V; OST registrations V; commissions V | Dashboard, Sales & Customers, Sales Network, Reports | Team/sponsor-scoped reads and permitted creates allowed; OST approval is denied because update is absent |
| OST | dashboard V; card sales VC; customers VCU; ID documents V; plans V; commissions V; referrals V; genealogy V | Dashboard, Sales & Customers, Sales Network, Reports | Self-scoped seller, customer, commission, and network access; other OSTs and generic admin APIs denied |
| Employee | dashboard V; redemption VC; catalog V | Dashboard, Redemption, Reports | Redemption execution and catalog read allowed; catalog mutation and all unrelated operational APIs denied |
| Customer | No staff modules | Customer portal only | Ownership-scoped customer endpoints only; staff admin APIs denied |

Navigation and direct-page authorization consume the same effective permission
payload returned by the session API. The server re-resolves the principal and
permissions for every API request. Current genealogy determines current team
membership; immutable sale hierarchy snapshots determine historical team sales.

## Multiple roles and status

`staff_role_assignments.staff_id` is the primary key, so the current model has
exactly one role assignment per staff member and no role switch or permission
union. A staff profile must be active and its assigned role must be active.
Inactive or suspended staff and inactive roles fail authorization.

## Test identities

All role and hierarchy checks use in-memory or disposable fixtures. The seller
chain is VD -> SSM -> SM -> OST. Customer fixtures use the separate ownership
resolver. No production identity is created by Phase 25.
