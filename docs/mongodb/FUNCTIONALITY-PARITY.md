# AFHomes MongoDB Conversion â€” Functionality Parity Ledger

**Status:** Phase 1 deliverable. This inventory captures every enabled UI action/route, API method, background/operator dependency, RPC, and required invariant from the source AFHomes application (snapshot `f512c1416550feaf0c79a6bb204c51d08fa990f6`). Disabled modules (Redemption, Services) are explicitly classified; their source is preserved but not converted.

**Status Codes:**
- **NOT STARTED** â€” No MongoDB implementation exists
- **IMPLEMENTED** â€” MongoDB code written but not verified
- **UNIT VERIFIED** â€” Unit/handler tests pass against fake/mock
- **DATABASE VERIFIED** â€” Integration tests pass against real local MongoDB
- **BROWSER VERIFIED** â€” E2E browser tests pass with real persistence
- **BLOCKED** â€” Explicit blocker documented (see Phase 0 status)

---

## 1. Authentication & Session Management

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 1.1 | Staff login (email/password) | `apps/admin/src/features/auth/PortalLoginPage.tsx`, `apps/admin/src/lib/session.tsx` | `POST /api/v1/auth/identity/sign-in/email` (Better Auth) | `afHomesSessionSchema` | Supabase Auth session â†’ `resolveAfHomesPrincipal` â†’ RBAC | Better Auth email/password, HttpOnly cookies | DATABASE + HTTP VERIFIED; Mongo UI implemented, browser acceptance pending |
| 1.2 | Staff forced first-login password change | `apps/admin/src/features/auth/AdminActivateAccountPage.tsx`, `api/_handlers/admin/afhomes.ts` (PATCH/POST session) | `GET /admin/afhomes/session`, `PATCH /admin/afhomes/session`, `POST /admin/afhomes/session/password` | `changeAfHomesStaffPasswordSchema`, `updateAfHomesStaffProfileSchema` | `mustChangePassword: true` gates ALL module endpoints via `authorizeAfHomes` | Better Auth password update + `staff_users.must_change_password` flag | DATABASE + HTTP VERIFIED; forced-change gate, current-password check, other-session revocation; browser pending |
| 1.3 | Staff MFA (TOTP) enrollment & verification | `apps/admin/src/features/auth/AdminMfaPage.tsx`, `api/_lib/afhomes-access.ts` (verifiedAssuranceLevel) | Better Auth `/sign-in/totp`, `/two-factor/*` | TOTP plugin schemas | `mfaRequired` on `admin`/`super_admin` roles; `aal2` required for sensitive ops | Better Auth TOTP plugin | DATABASE VERIFIED real TOTP enrollment and new-login challenge; native UI implemented, browser pending |
| 1.4 | Staff password recovery (forgot/reset) | `apps/admin/src/features/auth/AdminForgotPasswordPage.tsx`, `AdminResetPasswordPage.tsx` | Better Auth `/request-password-reset`, `/reset-password` | Auth recovery schemas | Generic responses; approved callback origins; session revocation | Better Auth password reset flow | DATABASE + HTTP VERIFIED provider recovery callback; UI UNIT VERIFIED; real delivery unconfigured |
| 1.5 | Staff logout (revoke session + clear cache) | `apps/admin/src/lib/session.tsx` (logout) | `POST /api/v1/auth/identity/sign-out` | â€” | `queryClient.clear()` on logout; Supabase `signOut()` revokes server-side | Better Auth sign-out + cookie clearing | DATABASE VERIFIED provider logout; native cache clearing implemented; browser pending |
| 1.6 | Staff session revalidation (focus, auth change, cookie change) | `apps/admin/src/lib/session.tsx` (resolve, subscriptions) | `GET /admin/afhomes/session` | `afHomesSessionSchema` | Per-request principal resolution; immediate effect on permission change | Better Auth session + `/admin/afhomes/session` endpoint | DATABASE + UNIT VERIFIED fresh principal, denial and account-switch cache boundary; browser pending |
| 1.7 | Customer login (email/password) | `apps/web/src/features/customer/CustomerLoginPage.tsx`, `apps/web/src/lib/customer-session.tsx` | Better Auth `/sign-in/email` | `CustomerSessionUser` | Ownership only: `customers.auth_user_id` link; no RBAC | Better Auth email/password | DATABASE + HTTP VERIFIED; explicit Mongo UI implemented, browser pending |
| 1.8 | Customer VIP activation (code/link â†’ password) | `apps/web/src/features/customer/CustomerActivatePage.tsx`, `api/_handlers/customer-activation.ts` | `POST /api/v1/auth/customer/activate` (unauthenticated) | `customerActivationRequestSchema`, `customerActivationResultSchema` | Single-use, expiring token; atomic claim + link; `CLAIMED`/`ALREADY_LINKED` idempotency | `customer_onboarding_tokens` collection + Better Auth user creation | DATABASE + HTTP VERIFIED activation/replay/expiry/ownership/concurrency; browser pending |
| 1.9 | Customer password recovery | `apps/web/src/features/customer/CustomerForgotPasswordPage.tsx`, `CustomerResetPasswordPage.tsx` | Better Auth `/request-password-reset`, `/reset-password` | Auth recovery schemas | Ownership-preserving; no staff RBAC involvement | Better Auth password reset | DATABASE + HTTP VERIFIED single-use reset and session revocation; UI UNIT VERIFIED; real delivery unconfigured |
| 1.10 | Customer session & portal guard | `apps/web/src/lib/customer-session.tsx`, `apps/web/src/app/CustomerLayout.tsx` | `GET /api/v1/customer/*` | `CustomerSessionUser` | `CustomerSessionProvider` resolves auth only; server owns authorization | Better Auth session + ownership checks | DATABASE + HTTP VERIFIED ownership; native cookie provider implemented, browser pending |
| 1.11 | OST login/registration/portal | `apps/web/src/features/ost/*`, `apps/web/src/app/OstLayout.tsx`, `OstGuard.tsx` | Better Auth + `GET /api/v1/ist-portal/*`, `/api/v1/ost/*` | `istPortalSessionSchema` | Referral-first registration; approved OST record required; separate portal | Better Auth + OST ownership | NOT STARTED |

---

## 2. Organization & RBAC (Staff)

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 2.1 | Staff list (paginated, filtered) | `apps/admin/src/features/afhomes/AfHomesStaffPage.tsx`, `api/_handlers/admin/afhomes.ts` | `GET /api/v1/admin/afhomes/staff` | `afHomesStaffSchema` | `organization.staff` view | `staff_users` + joins | NOT STARTED |
| 2.2 | Create staff (admin-set temp password) | `apps/admin/src/features/afhomes/AfHomesStaffPage.tsx`, `api/_handlers/admin/afhomes.ts` | `POST /api/v1/admin/afhomes/staff` | `createAfHomesStaffSchema` | `organization.staff` create; Super Admin only for `super_admin` role; `ost`/`customer` roles blocked | `staff_users` insert + Better Auth `createUser` with temp password | NOT STARTED |
| 2.3 | Staff detail (permissions, history) | `AfHomesStaffDetailPage.tsx` | `GET /api/v1/admin/afhomes/staff/:id` | `afHomesStaffSchema` | `organization.staff` view | `staff_users` + restrictions + assignments | NOT STARTED |
| 2.4 | Update staff (status, department, role) | `AfHomesStaffDetailPage.tsx` | `PATCH /api/v1/admin/afhomes/staff/:id` | Staff update schema | `organization.staff` update; subset rule; cannot edit own role | `staff_users` update + role assignment | NOT STARTED |
| 2.5 | Deactivate/suspend/reactivate staff | `AfHomesStaffDetailPage.tsx` | `PATCH /api/v1/admin/afhomes/staff/:id` (status) | Status enum | `organization.staff` update; inactive/suspended â†’ immediate API denial | `staff_users.status` update | NOT STARTED |
| 2.6 | Delete staff (protected-history blockers) | `AfHomesStaffDetailPage.tsx` | `DELETE /api/v1/admin/afhomes/staff/:id` | `staffTestPurgeResponseSchema` | Super Admin only; `STAFF_DELETE_BLOCKER_CHECKS`; test-purge env gate | Soft delete with blockers; test purge separate | NOT STARTED |
| 2.7 | Departments CRUD | `AfHomesDepartmentsPage.tsx` | `GET/POST/PATCH/DELETE /api/v1/admin/afhomes/departments` | `afHomesDepartmentSchema` | `organization.departments` (view/create/update/delete) | `departments` collection | NOT STARTED |
| 2.8 | Roles CRUD + permissions matrix | `AfHomesRolesPage.tsx`, `AfHomesRoleDetailPage.tsx` | `GET/POST/PATCH/DELETE /api/v1/admin/afhomes/roles*` | `afHomesRoleSchema`, `afHomesPermissionSchema` | `organization.roles`; subset rule; system roles protected | `roles`, `role_permissions`, `modules` | NOT STARTED |
| 2.9 | Staff permission restrictions (deny-only) | `AfHomesRoleDetailPage.tsx` (restrictions tab) | `POST/DELETE /api/v1/admin/afhomes/staff/:id/restrictions` | `afHomesRestrictionSchema` | `organization.staff` update; deny-only; applies to Super Admin | `staff_permission_restrictions` | NOT STARTED |
| 2.10 | Staff role assignment | `AfHomesStaffDetailPage.tsx` | `PATCH /api/v1/admin/afhomes/staff/:id` (roleId) | â€” | `organization.staff` update; subset rule enforced | `staff_role_assignments` | NOT STARTED |
| 2.11 | Public verification settings | `PublicVerificationSettingsPage.tsx` | `GET/PUT /api/v1/admin/afhomes/public-verification-settings` | `publicVerificationSettingsSchema` | `governance.config` (admin/super_admin only) | RPC `get_public_verification_settings` / `update_public_verification_settings` | NOT STARTED |
| 2.12 | Super Admin bootstrap | `supabase/invite-superadmin.ts` | CLI only (`pnpm bootstrap:superadmin`) | â€” | Idempotent; invites via Auth admin; owner sets password | Better Auth admin API + `staff_users` | NOT STARTED |

---

## 3. Sales & Customers (Card Products, Sales Lifecycle)

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 3.1 | Card categories: list/create/edit/deactivate (no DELETE) | `BusinessProductsPage.tsx`, `card-categories.ts` | `GET/POST/PATCH /api/v1/card-categories*` | `cardCategorySchema` | `sales.card_plans`; seller visibility | `card_categories` | DATABASE VERIFIED; mounted only in controlled local runtime; browser pending |
| 3.2 | Card plans: list/create/edit/deactivate (no DELETE) | `BusinessProductsPage.tsx`, `cards.ts` | `GET/POST/PATCH /api/v1/card-products*` | `cardProductSchema` | `sales.card_plans`; seller visibility | `card_plans` | DATABASE VERIFIED; mounted only in controlled local runtime; browser pending |
| 3.3 | Customer directory (search, filter, paginate) | `BusinessCustomersPage.tsx`, `CustomerDetailPage.tsx` | `GET /api/v1/customers*` | `customerSchema`, `customerDirectoryQuerySchema` | `sales.customers` view | `customers` + indexes | DATABASE + HTTP VERIFIED directory, filters, exact totals, stable pagination; browser pending |
| 3.4 | Customer detail (profile, IDs, sales, memberships) | `CustomerDetailPage.tsx` | `GET /api/v1/customers/:id` | `customerDetailSchema` | `sales.customers` view; confidential fields projected out | `customers` + `identity_documents` | PARTIAL: customer detail DATABASE VERIFIED; related sales/memberships and documents remain unconverted |
| 3.5 | Create/update customer | `CustomerDetailPage.tsx`, `CustomerCompanyEditDialog.tsx` | `POST/PATCH /api/v1/customers` | `createCustomerSchema`, `updateCustomerSchema` | `sales.customers` create/update; confidential fields write-only | `customers` upsert | DATABASE + HTTP VERIFIED full source company fields and atomic identifiers/audit; browser pending |
| 3.6 | Customer government ID (write-only, masked read) | `CustomerIdImage.tsx`, `customer-portal.ts` | `GET /api/v1/customers/:id/id-documents` | `identityDocumentSchema` | Column-level SELECT grants; `governmentIdMasked` in API | `identity_documents` + column grants | NOT STARTED |
| 3.7 | Sale creation (numbering, hierarchy snapshot) | `SalesRecordsPage.tsx`, `sales.ts` handler | `POST /api/v1/sales` | `createSaleSchema` | `sales.card_sales` create; seller resolution; atomic numbering | `card_sales` + `card_sale_hierarchy_snapshots` | NOT STARTED |
| 3.8 | Sale detail (payments, membership, commission) | `SalesRecordsPage.tsx` | `GET /api/v1/sales/:id` | `saleDetailSchema` | `sales.card_sales` view | `card_sales` + payments + memberships | NOT STARTED |
| 3.9 | Sale status lifecycle (pending â†’ down_payment â†’ qualified â†’ final_qualification_pending â†’ activated) | `sales.ts` handler, `lifecycle.ts` | `PATCH /api/v1/sales/:id` (status transitions) | `saleStatusTransitionSchema` | Legal transitions only; `lifecycle.ts` is SSOT | Conditional updates + transactions | NOT STARTED |
| 3.10 | Payment recording (recorded â†’ verified/rejected/voided) | `BusinessFinanceQueuePage.tsx`, `sales.ts` | `POST /api/v1/payments`, `PATCH /api/v1/payments/:id` | `recordPaymentSchema`, `verifyPaymentSchema` | `finance.payment_verification` create/update; ONLY verified counts | `payments` + conditional transitions | NOT STARTED |
| 3.11 | Sale activation (full verified payment required) | `BusinessActivationQueuePage.tsx`, `sales.ts` | `POST /api/v1/sales/:id/activate` | `activateSaleSchema` | `finance.card_activation`; re-checks verified totals; idempotent | `activate_card_sale` RPC equivalent in transaction | NOT STARTED |
| 3.12 | Membership creation (on activation) | `sales.ts` (activate_card_sale) | Internal (part of activation) | `membershipSchema` | Exactly one per sale; QR token + fallback code hashed | `memberships` + credentials rotation | NOT STARTED |
| 3.13 | Commission creation (on activation) | `sales.ts` (activate_card_sale) | Internal | `commissionSchema` | Frozen hierarchy snapshot; rates from sale snapshot | `commissions` + `card_sale_hierarchy_snapshots` | NOT STARTED |
| 3.14 | Commission qualification (manual, audited) | `BusinessCommissionsPage.tsx`, `commissions.ts` | `PATCH /api/v1/commissions/:id` | `commissionStatusSchema` | `finance.final_qualification`; manual gated; notes mandatory | `commissions` + `final_qualifications` | NOT STARTED |
| 3.15 | Commission correction | `BusinessCommissionsPage.tsx` | `PATCH /api/v1/commissions/:id/correct` | `correctCommissionSchema` | `finance.commission_payouts`; audit trail | `commissions` update with history | NOT STARTED |
| 3.16 | Payment queue (recorded, filter, verify/reject/void) | `BusinessFinanceQueuePage.tsx` | `GET /api/v1/payments`, `PATCH /api/v1/payments/:id` | `paymentQueueItemSchema` | `finance.payment_verification` view/update | `payments` with status index | NOT STARTED |
| 3.17 | Activation queue (qualified sales, activate) | `BusinessActivationQueuePage.tsx` | `GET /api/v1/sales?status=qualified` | `saleQueueItemSchema` | `finance.card_activation` view | `card_sales` status index | NOT STARTED |
| 3.18 | Final qualification queue | `BusinessCommissionsPage.tsx` | `GET /api/v1/commissions?status=final_qualification_pending` | `commissionQueueSchema` | `finance.final_qualification` view | `commissions` + `final_qualifications` | NOT STARTED |
| 3.19 | Sale hierarchy snapshot (immutable) | `sales.ts` (activate) | Internal | `cardSaleHierarchySnapshotSchema` | Frozen at activation; never recomputed from current graph | `card_sale_hierarchy_snapshots` | NOT STARTED |
| 3.20 | Customer onboarding token issuance | `CustomerDetailPage.tsx`, `customers.ts` | `POST /api/v1/customers/:id/onboarding-token` | Existing onboarding result shape | `sales.customers` update; active unlinked customer + active membership | `customer_onboarding_tokens` | DATABASE + HTTP VERIFIED staff issuance, manual code/link, real cookie authorization; browser pending |
| 3.21 | Customer import (workbook, guided XLSX, legacy) | `CustomerImportExportPage.tsx`, `customer-imports.ts` | `POST /api/v1/customer-imports*`, `POST /api/v1/customer-imports/continue` | `customerImportJobSchema`, `customerImportRowSchema` | `governance.customer_import`; resumable; per-row idempotency | `customer_import_jobs`, `customer_import_rows` | NOT STARTED |

---

## 4. Customer Portal (VIP)

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 4.1 | Customer dashboard (profile/membership/points position) | `CustomerDashboardPage.tsx` | `GET /api/v1/customer`, `/membership`, `/points/position` | Existing customer schemas | Ownership only | `customers`, memberships, points | DATABASE + HTTP VERIFIED profile/membership/position; browser pending |
| 4.2 | Customer membership card (persistent QR/member code; secrets unavailable) | `CustomerMembershipPage.tsx` | `GET /api/v1/customer/membership` | `customerMembershipSchema` | Owner + active customer; no secret hashes | `memberships`, card_plans, card_sales | DATABASE VERIFIED; controlled local runtime; browser pending |
| 4.3 | Customer payment history (all own recorded statuses, source behavior) | `CustomerPaymentsPage.tsx` | `GET /api/v1/customer/payments` | `customerPaymentSchema` list | Ownership through own card sales; no finance-private fields | `card_sales`, payments | DATABASE VERIFIED; controlled local runtime; browser pending |
| 4.4 | Customer points summary/position/ledger | Customer services/dashboard | `GET /api/v1/customer/points`, `/points/position`, `/points/ledger` | `customerPointsSummarySchema`, position/ledger schemas | Owner + active customer | points_accounts, periods, ledger | DATABASE + HTTP VERIFIED position, periods, caps/debt/allowances, cursor ledger; browser pending |
| 4.5 | Customer profile (read-only, source behavior) | `CustomerProfilePage.tsx` | `GET /api/v1/customer` | `customerProfileSchema` | Ownership; confidential fields omitted | customers | DATABASE + HTTP VERIFIED; browser pending |
| 4.6 | Membership credentials reissue (rotate, not recover) | `CustomerMembershipPage.tsx` | `POST /api/v1/customer/membership/credentials` | `reissueCredentialsSchema` | Ownership + customer status check in SQL; returns plaintext once | `memberships` QR/fallback rotation | DATABASE + HTTP VERIFIED ownership, hash-only rotation, atomic audit; browser pending |
| 4.7 | Customer activation (code/link entry) | `CustomerActivatePage.tsx` | `POST /api/v1/auth/customer/activate` | `customerActivationRequestSchema`, `customerActivationResultSchema` | Unauthenticated; token purpose/expiry/single-use/ownership | `customer_onboarding_tokens` claim | DATABASE + HTTP VERIFIED code/link and provider login; browser pending |

---

## 5. IST/OST & Sales Network

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 5.1 | OST registration (referral-first) | `OstApplicationsPage.tsx`, `ost.ts` handler | `POST /api/v1/ost/applications` | `ostApplicationSchema` | Public (unauthenticated); referral code required | `ost_applications` + `referral_codes` | NOT STARTED |
| 5.2 | OST application review (submit/approve/endorse/reject) | `OstApplicationsPage.tsx`, `OstApplicationDetailPage.tsx` | `PATCH /api/v1/ost/applications/:id` | `ostApplicationReviewSchema` | `network.ost_registrations` (SM+); `network.ost_members` (approve) | `ost_applications` status transitions | NOT STARTED |
| 5.3 | OST accreditation workflow | `OstAccreditationPages.tsx`, `ost-accreditation.ts` | `GET/POST/PATCH /api/v1/ost-accreditation*` | `ostAccreditationSchema` | `network.ost_members` + accreditation modules | `ost_members` + accreditation records | NOT STARTED |
| 5.4 | OST renewal (submit/approve/endorse/reject) | `OstRenewalPage.tsx`, `ost-accreditation.ts` | `POST /api/v1/ost/renewal`, `PATCH /api/v1/ost/renewal/:id` | `ostRenewalSchema` | Manual workflow; no auto-renewal | `ost_members` + renewal records | NOT STARTED |
| 5.5 | OST team transfer / IST conversion | `OstTeamTransferDialog.tsx`, `TransferToIstDialog.tsx` | `POST /api/v1/members/:id/team-transfer` | `teamTransferSchema` | `network.members` update; cycle prevention; hierarchy freeze | `ost_members` + `referral_relationships` | NOT STARTED |
| 5.6 | Referral relationships (genealogy) | `GenealogyPage.tsx`, `GenealogyTree.tsx`, `referrals.ts` | `GET /api/v1/genealogy*`, `/referrals*` | `referralRelationshipSchema` | Exact transitions; cycle prevention; freeze sponsor at registration | `referral_relationships` + `referral_codes` | NOT STARTED |
| 5.7 | Public sale team search (minimal output) | `SaleTeamSearchPage.tsx`, `sale-team.ts` | `GET /api/v1/sale-team/search` | `saleTeamSearchSchema` | Public; privacy/readiness gates; anti-abuse | `ost_members` + `referral_relationships` projection | NOT STARTED |
| 5.8 | Network members (sellers with profiles) | `MembersPage.tsx`, `members.ts` handler | `GET/POST/PATCH /api/v1/members*` | `networkMemberSchema` | `network.members` module; hierarchy sellers only | `network_member_profiles` + `ost_members` | NOT STARTED |
| 5.9 | OST portal (dashboard, sales, commissions, accreditation) | `OstDashboardPage.tsx`, `OstSalesPage.tsx`, `OstCommissionsPage.tsx` | `GET /api/v1/ist-portal/*` | `istPortalSessionSchema` | OST ownership; separate from staff RBAC | `ost_members` + sales + commissions | NOT STARTED |

---

## 6. Applications, Reservations & Official Forms

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 6.1 | Customer application wizard (multi-step) | `official-forms-applications.tsx` | `POST/GET /api/v1/official-forms/applications*` | `customerApplicationSchema` | `sales.customers` create; draft/review/edit locks | `customer_applications` + holders + terms | NOT STARTED |
| 6.2 | Application purchase flow (reserve â†’ review â†’ approve â†’ continue) | `official-forms-applications.tsx`, `purchase-flow.ts` | `POST /api/v1/official-forms/purchase*` | `purchaseApplicationSchema` | Idempotency keys; versioned snapshots; authorized gates | `purchases` + `purchase_lines` + reservations | NOT STARTED |
| 6.3 | Reservation agreements (schedule, holders, terms) | `official-forms-reservations.tsx` | `GET/POST/PATCH /api/v1/official-forms/reservations*` | `reservationAgreementSchema` | Versioned; signed/generated artifacts frozen | `reservation_agreements` + schedule + holders | NOT STARTED |
| 6.4 | Official forms (generation, signatures, versioning) | `OfficialFormsPages.tsx`, `official-forms.ts` | `GET/POST /api/v1/official-forms*` | `officialFormSchema` | `sales.id_documents` for uploads; generated docs versioned | `cms_documents` + signatures | NOT STARTED |
| 6.5 | Document upload/review (ID docs, OCR-assisted) | `CustomerIdImage.tsx`, `documents.ts` | `POST/GET/PATCH /api/v1/documents*` | `identityDocumentSchema` | `sales.id_documents`; private storage; human review | `identity_documents` + storage metadata | NOT STARTED |
| 6.6 | Application import continuation/payment claims | `CustomerImportExportPage.tsx`, `customer-imports.ts` | `POST /api/v1/customer-imports/continue`, `/payment-claims` | `continuationSchema`, `paymentClaimSchema` | `governance.customer_import`; atomic claims; fingerprint | `customer_import_jobs` + rows + claims | NOT STARTED |

---

## 7. Points Engine (Enabled: Earning & Balance; Disabled: Redemption)

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 7.1 | Points earning (purchase recording, claims) | `points.ts` handler, `RecordPointsDialog.tsx` | `GET/POST /api/v1/earning*` | `earningClaimSchema` | `operations.redemption` (reused); `sales.customers` for QR claim | `points_ledger` + `points_accounts` | NOT STARTED |
| 7.2 | Points balance (per membership) | `PointsRulesPage.tsx`, `BusinessPointsPage.tsx` | `GET /api/v1/points/balance/:membershipId` | `pointsBalanceSchema` | `finance.points` view | `points_accounts` (authoritative) | NOT STARTED |
| 7.3 | Points ledger (immutable history) | `PointsRulesPage.tsx` | `GET /api/v1/points/ledger/:membershipId` | `pointsLedgerSchema` | `finance.points` view | `points_ledger` (append-only) | NOT STARTED |
| 7.4 | Points rules/catalog (earning) | `PointsRulesPage.tsx` | `GET/POST/PATCH /api/v1/earning/rules` | `pointEarningRuleSchema` | `operations.catalog` | `point_earning_rules` | NOT STARTED |
| 7.5 | **DISABLED: Redemption (POS, catalog, history)** | `RedemptionWorkflowPage.tsx`, `RedemptionHistoryPage.tsx` | `/api/v1/redemptions*` | `redemptionSchema` | `operations.redemption` + `operations.catalog` | `redemption_items`, `redemptions` | **DISABLED** |
| 7.6 | **DISABLED: Customer redemptions/refunds** | `CustomerRedemptionsPage.tsx`, `CustomerRefundHistory.tsx` | `/api/v1/customer/redemptions*`, `/customer/refunds` | `customerRedemptionSchema` | `operations.redemption` (customer) | `redemptions` + refunds | **DISABLED** |

---

## 8. Reports, Analytics & Audit

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 8.1 | Reports dashboard (10 scoped reports) | `ReportsPage.tsx`, `reports.ts` handler | `GET /api/v1/reports/:reportKey` | `reportSchema` (per report) | Per-report module key; `dashboard.view` for group visibility | MongoDB aggregations + projections | NOT STARTED |
| 8.2 | Report exports (CSV/Excel, authorized) | `ReportsPage.tsx` (export buttons) | `GET /api/v1/reports/:reportKey/export` | `reportExportSchema` | Same as screen; no elevated export permission | Aggregation + streaming export | NOT STARTED |
| 8.3 | Audit log (append-only, paginated) | `AuditPage.tsx` | `GET /api/v1/admin/afhomes/roles/:id/audit`, `GET /api/v1/admin/audit` | `auditEventSchema` | `governance.audit` only | `audit_events` (immutable) | NOT STARTED |
| 8.4 | Analytics (trend, queues, totals) | `AfHomesDashboardPage.tsx`, `analytics.ts` | `GET /api/v1/analytics/dashboard` | `afHomesDashboardSchema` | `dashboard.view` | Aggregations from sales/payments/memberships | NOT STARTED |

---

## 9. CMS & Public Marketing

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 9.1 | Public pages (home, experiences, VIP, about, stories, FAQ) | `apps/web/src/marketing/pages/*.tsx` | `GET /:slug` (CMS) | `cmsPageSchema` | Public read; `cms.pages` for admin | `cms_pages` + versions + sections | NOT STARTED |
| 9.2 | CMS page editor (versions, sections, publish) | `CmsPagesPage.tsx`, `CmsDocumentPage.tsx` | `GET/POST/PATCH /api/v1/cms/pages*` | `cmsPageSchema` | `cms.pages` (create/update), `cms.settings` | `cms_pages`, `cms_page_versions`, `cms_page_sections` | NOT STARTED |
| 9.3 | CMS media (upload, delete, signed delivery) | `CmsMediaPage.tsx`, `cms.ts` handler | `POST/GET/DELETE /api/v1/cms/media` | `cmsMediaAssetSchema` | `cms.media`; private bucket; signed URLs | `cms_media_assets` + `afhomes-cms-media` bucket | NOT STARTED |
| 9.4 | CMS settings (SEO, site config) | `CmsSettingsPage.tsx` | `GET/PATCH /api/v1/cms/settings` | `cmsSettingsSchema` | `cms.settings` | `cms_settings` document | NOT STARTED |
| 9.5 | CMS history (versions, diffs) | `CmsHistoryPage.tsx` | `GET /api/v1/cms/history` | `cmsHistorySchema` | `cms.history` | `cms_page_versions` + `cms_document_versions` | NOT STARTED |

---

## 10. File Storage & Private Delivery

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 10.1 | Customer ID documents (private, signed URLs) | `CustomerIdImage.tsx`, `documents.ts` | `POST /api/v1/documents`, `GET /api/v1/documents/:id/signed-url` | `identityDocumentSchema` | `sales.id_documents`; private bucket; short-lived signed URLs | `identity_documents` + storage metadata | NOT STARTED |
| 10.2 | Payment receipts (private, signed URLs) | `SalesRecordsPage.tsx`, `storage.ts` | `POST /api/v1/sales/:id/receipt`, `GET /.../signed-url` | `paymentReceiptSchema` | `finance.payment_verification`; private bucket | `payment_receipts` + `afhomes-payment-receipts` bucket | NOT STARTED |
| 10.3 | OST ID photos (private, signed URLs) | `OstApplicationDetailPage.tsx` | `POST /api/v1/ost/applications/:id/photo`, `GET /.../signed-url` | `ostPhotoSchema` | `network.ost_members`; private bucket | `ost_photos` + `afhomes-ost-ids` bucket | NOT STARTED |
| 10.4 | Profile photos (private, signed URLs) | `ProfilePhotoCard.tsx`, `profile-photo.ts` | `POST /api/v1/profile-photo`, `GET /.../signed-url` | `profilePhotoSchema` | Ownership (staff/customer/OST); private bucket | `profile_photos` + bucket | NOT STARTED |
| 10.5 | CMS media (public read, private write) | `CmsMediaPage.tsx` | `POST/GET/DELETE /api/v1/cms/media` | `cmsMediaAssetSchema` | `cms.media`/`cms.settings`; public bucket read | `cms_media_assets` + `afhomes-cms-media` bucket | NOT STARTED |

---

## 11. Background Jobs, Imports & Recovery

| # | Feature | Source Files | API Routes | Contracts | Auth/Scope Rules | MongoDB Target | Status |
|---|---------|--------------|------------|-----------|------------------|----------------|--------|
| 11.1 | Customer import jobs (workbook, validation, resumable) | `CustomerImportExportPage.tsx`, `customer-imports.ts` | `POST/GET /api/v1/customer-imports*` | `customerImportJobSchema` | `governance.customer_import`; atomic row claims; fingerprint | `customer_import_jobs`, `customer_import_rows` | NOT STARTED |
| 11.2 | Member workbook import (OST/IST) | `MemberWorkbookDialog.tsx`, `member-workbook-handler.ts` | `POST/GET /api/v1/members/workbook*` | `memberWorkbookSchema` | `network.members`; per-row idempotency | `member_workbook_jobs`, `member_workbook_rows` | NOT STARTED |
| 11.3 | OST import (bulk, preview, stage) | `OstApplicationsPage.tsx` (import), `ost-import-handler.ts` | `POST/GET /api/v1/ost/import*` | `ostImportSchema` | `network.ost_registrations` | `ost_import_jobs` | NOT STARTED |
| 11.4 | Cleanup/readiness/scheduler prerequisites | `supabase/seed.ts`, `supabase/apply-migrations.ts` | CLI only | â€” | Operator-only; never browser-accessible | Separate MongoDB admin scripts | NOT STARTED |
| 11.5 | Durable outbox (email, external side effects) | `customer-onboarding-email.ts`, `api/_lib/handler-kit.ts` | Internal | â€” | Transaction callback may retry; outbox after commit | `outbox_events` collection | NOT STARTED |

---

## 12. Disabled Modules (Preserved, Not Converted)

| Module | Feature Flag | Source Files Preserved | API Routes Blocked | UI Paths Hidden |
|--------|--------------|------------------------|-------------------|-----------------|
| **Redemption** | `redemption: false` | `api/_handlers/redemptions.ts`, `api/_handlers/points.ts` (earning), `apps/admin/src/features/redemption/*`, `apps/web/src/features/customer/CustomerRedemptionsPage.tsx` | `/api/v1/redemptions*`, `/api/v1/earning*`, `/api/v1/reports/redemptions` | `/admin/redemption`, `/admin/member-lookup`, `/customer/redemptions`, `/reports/redemptions` |
| **Operational Services** | `services: false` | `api/_handlers/_service-catalog.ts`, `_service-refunds.ts`, `_point-approvals.ts`, `_point-refunds.ts`, `_imported-sales.ts`, `apps/admin/src/features/business/ServiceCatalogEditor.tsx`, `UseVipPointsPage.tsx`, `ServiceRefundPanel.tsx`, `apps/web/src/features/customer/CustomerRefundHistory.tsx` | `/api/v1/admin/points*`, `/api/v1/customer/refunds`, `/api/v1/earning*` | `/admin/points`, `/customer/refunds`, `/customer/points` (non-API) |

**Note:** Sales/Finance payments, memberships, customer dashboard points (read-only) remain ENABLED. Only the separate operational Services catalog and Redemption POS are disabled.

---

## 13. Cross-Cutting Invariants (Must Hold in MongoDB)

| # | Invariant | Source Evidence | MongoDB Translation |
|---|-----------|-----------------|---------------------|
| 13.1 | **Exact money** â€” canonical decimal strings, BigInt arithmetic, no float | `@afhomes/shared` money helpers, `private.money()` SQL, CHECK regex on money columns | Store as Decimal128 or string; validate on read/write; BigInt helpers unchanged |
| 13.2 | **Only VERIFIED money counts** â€” recorded/rejected/voided never activate | `activate_card_sale` RPC, payment status CHECK | Conditional aggregation on `payments.status = 'verified'` |
| 13.3 | **Sale = frozen commercial record** â€” snapshots never recomputed | `card_sales` snapshots, `card_sale_hierarchy_snapshots` | Embed snapshots in `card_sales`; immutable hierarchy collection |
| 13.4 | **Activation requires full verified payment** â€” re-checked in transaction | `activate_card_sale` RPC idempotent | Transaction: sum verified payments â‰¥ total â†’ create membership |
| 13.5 | **Deny-only restrictions** â€” subtract, never add | `staff_permission_restrictions`, `permissionsAreSubset()` | Same logic in `resolveAfHomesPrincipal`; restriction check before grant |
| 13.6 | **Identifiers never authorize** â€” QR/fallback are lookup only, hashed | `identifier.ts`, `memberships` QR/fallback hashes | `GET /memberships/resolve` only path; hashes in DB; plaintext once |
| 13.7 | **Government ID write-only** â€” never returned, masked in API | Phase 3 migration column grants, `governmentIdMasked` | Column-level projection; excluded from all API responses |
| 13.8 | **No cascading deletion of business history** â€” blockers on staff/customer delete | `STAFF_DELETE_BLOCKER_CHECKS`, `customerHasActivity` | Explicit blocker checks before delete; soft delete or anonymize |
| 13.9 | **Atomic business-number allocation** â€” counters + unique index | `next_customer_number`, `next_sale_number` RPCs | `counters` collection + `findOneAndUpdate` + unique index |
| 13.10 | **Transaction callback retries** â€” outbox for side effects | `handler-kit.ts`, conversion plan Â§151-160 | `session.withTransaction` + outbox collection |
| 13.11 | **Permission change = next request** â€” no cache in principal resolution | `resolveAfHomesPrincipal` per request | Same: resolve per request from MongoDB |
| 13.12 | **Customer ownership separate from staff RBAC** â€” never meet | `customer-access.ts` imports nothing from `afhomes-access.ts` | Separate resolver; ownership via `customers.auth_user_id` |
| 13.13 | **Credentials rotated, never recovered** â€” QR/fallback reissued | `reissue_membership_credentials` RPC | `memberships` QR/fallback rotation; plaintext returned once |
| 13.14 | **Historical team attribution frozen** â€” genealogy never rewrites past sales | `card_sale_hierarchy_snapshots`, `referral_relationships` | Immutable snapshots; current genealogy separate |
| 13.15 | **Health probe reflects DB only** â€” no credentials, stable shape | `health.ts` handler | MongoDB ping + `modules` equivalent; 503 on DB error |

---

## 14. API Handler Inventory (All Enabled Routes)

| Handler File | Route Prefix | Module Key(s) | Enabled |
|--------------|--------------|---------------|---------|
| `admin/afhomes.ts` | `/admin/afhomes/*` | `dashboard.view`, `organization.*`, `governance.config` | âœ… |
| `address.ts` | `/address` | `sales.customers` | âœ… |
| `analytics.ts` | `/analytics` | `dashboard.view` | âœ… |
| `auth-portals.ts` | `/auth/portals` | `auth` (unauthenticated) | âœ… |
| `card-categories.ts` | `/card-categories` | `sales.card_plans` | âœ… |
| `cards.ts` | `/card-products` | `sales.card_plans` | âœ… |
| `cms.ts` | `/cms` | `cms.*` | âœ… |
| `commissions.ts` | `/commissions` | `network.commissions`, `finance.*` | âœ… |
| `customer-activation.ts` | `/auth/customer/activate` | `auth` (unauthenticated) | âœ… |
| `customer-imports.ts` | `/customer-imports` | `governance.customer_import` | âœ… |
| `customer-portal.ts` | `/customer` | `customer` (ownership) | âœ… |
| `customers.ts` | `/customers` | `sales.customers` | âœ… |
| `documents.ts` | `/documents` | `sales.id_documents` | âœ… |
| `genealogy.ts` | `/genealogy` | `network.genealogy` | âœ… |
| `health.ts` | `/health` | â€” (public) | âœ… |
| `ist-portal.ts` | `/ist-portal` | `sales.card_sales`, `network.commissions` | âœ… |
| `members.ts` | `/members` | `network.members` | âœ… |
| `memberships.ts` | `/memberships`, `/points` | `finance.card_activation`, `finance.points` | âœ… |
| `official-forms.ts` | `/official-forms` | `sales.customers`, `sales.card_sales` | âœ… |
| `ost-accreditation.ts` | `/ost-accreditation` | `network.ost_members`, `network.ost_registrations` | âœ… |
| `ost.ts` | `/ost` | `network.ost_registrations`, `network.ost_members` | âœ… |
| `profile-photo.ts` | `/profile-photo` | Ownership | âœ… |
| `queues.ts` | `/queues` | `finance.payment_verification`, `finance.card_activation` | âœ… |
| `referrals.ts` | `/referrals` | `network.referrals` | âœ… |
| `reports.ts` | `/reports` | Per-report module keys | âœ… |
| `sale-team.ts` | `/sale-team` | `network.genealogy` (public search) | âœ… |
| `sales.ts` | `/sales`, `/payments` | `sales.card_sales`, `finance.payment_verification` | âœ… |
| **DISABLED** | | | |
| `redemptions.ts` | `/redemptions` | `operations.redemption` | âŒ Flag |
| `points.ts` (earning) | `/earning` | `operations.redemption` | âŒ Flag |

---

## 15. Database Collections Mapping (Proposed)

| Source Table(s) | MongoDB Collection | Key Constraints/Indexes |
|-----------------|-------------------|------------------------|
| `staff_users`, `staff_invitations`, `staff_role_assignments`, `staff_permission_restrictions` | `staff_users`, `staff_invitations`, `staff_role_assignments`, `staff_permission_restrictions` | Unique email; unique assignment; unique restriction; status index |
| `roles`, `modules`, `role_permissions`, `departments` | `roles`, `modules`, `role_permissions`, `departments` | Unique slug/key; role-module unique; department code unique |
| `customers`, `customer_onboarding_tokens`, `identity_documents`, `customer_applications`... | `customers`, `customer_onboarding_tokens`, `identity_documents`, `customer_applications`... | Unique customer_number; partial unique auth_user_id; token hash unique + TTL |
| `card_categories`, `card_plans`, `card_sales`, `payments`, `memberships`, `commissions`... | `card_categories`, `card_plans`, `card_sales`, `payments`, `memberships`, `commissions`... | Unique sale_number/payment_number; sale membership unique; hierarchy snapshot embed |
| `ost_members`, `ost_applications`, `referral_codes`, `referral_relationships`... | `ost_members`, `ost_applications`, `referral_codes`, `referral_relationships`... | Unique AA number; referral code unique; active ownership links |
| `points_accounts`, `points_ledger` | `points_accounts`, `points_ledger` | Unique account per membership; ledger immutable; event reference unique |
| `audit_events` | `audit_events` | Append-only; actor/time index |
| `cms_pages`, `cms_page_versions`, `cms_page_sections`, `cms_documents`... | `cms_pages`, `cms_page_versions`, `cms_page_sections`, `cms_documents`... | Version history; published index |
| **Disabled** `redemption_items`, `redemptions`, `service_catalog`... | **Preserved in source only** | â€” |

---

## 16. Acceptance Test Mapping (Per Feature)

Each enabled feature row above must eventually have:

| Test Layer | Command | Evidence Required |
|------------|---------|-------------------|
| Unit | `corepack pnpm --filter api exec vitest run <handler>.spec.ts` | Handler logic tests pass with fake |
| Database | `corepack pnpm test:db:local` (new Mongo harness) | Real MongoDB transactions, indexes, uniqueness, concurrency |
| Browser | Playwright E2E (`playwright-e2e` skill) | Real user flows: login â†’ action â†’ persistence â†’ reload |
| Denial | Same suites + negative cases | 403/404 on wrong role, cross-scope, disabled flag, expired token |

---

## 17. Phase 1 Completion Criteria

- [x] Inventory complete (this document)
- [ ] Every enabled UI route/component mapped to API handler + contract
- [ ] Every API handler mapped to MongoDB collection(s) + indexes
- [ ] Every RPC/transactional invariant mapped to MongoDB transaction/outbox
- [ ] Disabled modules explicitly listed with source preservation confirmed
- [ ] Auth/scope rules documented for every endpoint
- [ ] Parity ledger reviewed and approved before Phase 2 begins

---

**Next Phase:** Phase 2 â€” Local MongoDB integration and integrity foundation (disposable replica set, collection/index/validator setup, ID/value mapping, transactions, synthetic fixtures).
