import { CustomerLookupPage } from '../features/memberships/CustomerLookupPage';
import { MemberLookupPage } from '../features/memberships/MemberLookupPage';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { staffPortalPath } from '@jad/contracts';
import { useSession } from '../lib/session';
import type { ReactNode } from 'react';
import { roleRoutes } from './role-routes';
import { NotFound } from '@jad/ui';
import { AfHomesDashboardPage } from '../features/afhomes/AfHomesDashboardPage';
import { AfHomesDepartmentsPage } from '../features/afhomes/AfHomesDepartmentsPage';
import { AfHomesRoleDetailPage } from '../features/afhomes/AfHomesRoleDetailPage';
import { AfHomesRolesPage } from '../features/afhomes/AfHomesRolesPage';
import { AfHomesStaffDetailPage } from '../features/afhomes/AfHomesStaffDetailPage';
import { AfHomesStaffPage } from '../features/afhomes/AfHomesStaffPage';
import { BusinessActivationQueuePage } from '../features/business/BusinessActivationQueuePage';
import { BusinessCommissionsPage } from '../features/business/BusinessCommissionsPage';
import { CommissionSettingsPage } from '../features/business/CommissionSettingsPage';
import { BusinessCustomersPage } from '../features/business/BusinessCustomersPage';
import { CustomerImportExportPage } from '../features/business/CustomerImportExportPage';
import { BusinessFinanceQueuePage } from '../features/business/BusinessFinanceQueuePage';
import { BusinessProductsPage } from '../features/business/BusinessProductsPage';
import { BusinessSalesPage } from '../features/business/BusinessSalesPage';
import { PaymentSchemeGuidePage } from '../features/business/PaymentSchemeGuidePage';
import {
  CustomerApplicationEditorPage,
  CustomerApplicationsPage,
  ReservationAgreementEditorPage,
  ReservationAgreementsPage,
} from '../features/business/OfficialFormsPages';
import { RedemptionCatalogPage } from '../features/redemption/RedemptionCatalogPage';
import { RedemptionHistoryPage } from '../features/redemption/RedemptionHistoryPage';
import { RedemptionWorkflowPage } from '../features/redemption/RedemptionWorkflowPage';
import {
  AdminForgotPasswordPage,
  StaffForgotPasswordPage,
} from '../features/auth/AdminForgotPasswordPage';
import { AdminActivateAccountPage } from '../features/auth/AdminActivateAccountPage';
import { AdminLoginPage, StaffLoginPage } from '../features/auth/PortalLoginPage';
import { AdminMfaPage } from '../features/auth/AdminMfaPage';
import {
  AdminResetPasswordPage,
  StaffResetPasswordPage,
} from '../features/auth/AdminResetPasswordPage';
import { MyAccountPage } from '../features/account/MyAccountPage';
import { CmsDocumentPage } from '../features/cms/CmsDocumentPage';
import { CmsHistoryPage } from '../features/cms/CmsHistoryPage';
import { CmsMediaPage } from '../features/cms/CmsMediaPage';
import { CmsPagesPage } from '../features/cms/CmsPagesPage';
import { GenealogyPage } from '../features/genealogy/GenealogyPage';
import { GenealogyDetailsPage } from '../features/genealogy/GenealogyDetailsPage';
import { DocumentsPage } from '../features/documents/DocumentsPage';
import { DocumentReviewPage } from '../features/documents/DocumentReviewPage';
import { MembershipCardPrintPage } from '../features/memberships/MembershipCardPrintPage';
import { MembershipDetailPage } from '../features/memberships/MembershipDetailPage';
import { MembershipsPage } from '../features/memberships/MembershipsPage';
import { OstApplicationDetailPage } from '../features/ost/OstApplicationDetailPage';
import { OstApplicationsPage } from '../features/ost/OstApplicationsPage';
import { OstMembersPage } from '../features/ost/OstMembersPage';
import {
  OstManualRegistrationPage,
  OstAccreditationHistoryPage,
  OstImportExportPage,
} from '../features/ost/OstAccreditationPages';
import { OstReferralCodesPage } from '../features/ost/OstReferralCodesPage';
import { AuditPage } from '../features/reports/AuditPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { AdminLayout } from './AdminLayout';
import { ErrorBoundary } from './ErrorBoundary';
import { RequireRole } from './RequireRole';

const protectedPage = (page: ReactNode) => <RequireRole>{page}</RequireRole>;

export default function App() {
  const location = useLocation();
  const { status, user } = useSession();
  const publicAuth = /\/(login|forgot-password|reset-password|activate-account)$/.test(
    location.pathname,
  );
  const canonical = staffPortalPath(user?.roleSlug, location.pathname);
  if (status === 'authenticated' && !publicAuth && canonical !== location.pathname)
    return <Navigate replace to={`${canonical}${location.search}${location.hash}`} />;
  return (
    <ErrorBoundary>
      <Routes>
        {roleRoutes(
          <>
            <Route path="/admin/login" element={<AdminLoginPage />} />
            <Route path="/admin/mfa" element={protectedPage(<AdminMfaPage />)} />
            <Route path="/staff/login" element={<StaffLoginPage />} />
            <Route path="/admin/activate-account" element={<AdminActivateAccountPage />} />
            {/* Phase 16 recovery: public by necessity (the visitor has no usable
            session), outside RequireRole like the login screen. The staff
            entry has its own forgot/reset pair so recovery returns to the
            Staff Login, never the Administration Login. */}
            <Route path="/admin/forgot-password" element={<AdminForgotPasswordPage />} />
            <Route path="/admin/reset-password" element={<AdminResetPasswordPage />} />
            <Route path="/staff/forgot-password" element={<StaffForgotPasswordPage />} />
            <Route path="/staff/reset-password" element={<StaffResetPasswordPage />} />
            <Route element={<AdminLayout />}>
              {/* GSD / Employee customer desk. Read-only, and gated on the same
          `operations.redemption` view the nav uses, so hiding the link and
          refusing the URL cannot disagree. */}
      <Route path="/admin/customer-lookup" element={protectedPage(<CustomerLookupPage />)} />
      {/* Member TRANSACTION lookup: shows Membership Codes, reachable from
          Redemption rather than from the global nav. */}
      <Route path="/admin/member-lookup" element={protectedPage(<MemberLookupPage />)} />
              <Route path="/admin" element={protectedPage(<AfHomesDashboardPage />)} />
              <Route path="/admin/sales" element={protectedPage(<BusinessSalesPage />)} />
              {/* Internal IST payment-scheme reference. Gated on the
              sales.card_sales nav key like the sales list; customers and
              anonymous visitors never reach the staff app at all. */}
              <Route
                path="/admin/sales/payment-scheme-guide"
                element={protectedPage(<PaymentSchemeGuidePage />)}
              />
              <Route path="/admin/customers" element={protectedPage(<BusinessCustomersPage />)} />
              <Route
                path="/admin/customers/import-export"
                element={protectedPage(<CustomerImportExportPage />)}
              />
              <Route
                path="/admin/customers/applications"
                element={protectedPage(<CustomerApplicationsPage />)}
              />
              <Route
                path="/admin/customers/applications/new"
                element={protectedPage(<CustomerApplicationEditorPage />)}
              />
              <Route
                path="/admin/customers/applications/:id"
                element={protectedPage(<CustomerApplicationEditorPage />)}
              />
              <Route
                path="/admin/sales/reservations"
                element={protectedPage(<ReservationAgreementsPage />)}
              />
              <Route
                path="/admin/sales/reservations/new"
                element={protectedPage(<ReservationAgreementEditorPage />)}
              />
              <Route
                path="/admin/sales/reservations/:id"
                element={protectedPage(<ReservationAgreementEditorPage />)}
              />
              <Route path="/admin/products" element={protectedPage(<BusinessProductsPage />)} />
              <Route
                path="/admin/finance/payments"
                element={protectedPage(<BusinessFinanceQueuePage />)}
              />
              <Route
                path="/admin/finance/activation"
                element={protectedPage(<BusinessActivationQueuePage />)}
              />
              <Route
                path="/admin/finance/commissions"
                element={protectedPage(<BusinessCommissionsPage />)}
              />
              <Route
                path="/admin/finance/commissions/settings"
                element={protectedPage(<CommissionSettingsPage />)}
              />
              <Route
                path="/admin/commissions/settings"
                element={protectedPage(<CommissionSettingsPage />)}
              />
              {/* Redemption. Each route is gated on the module key declared for it in
              ADMIN_NAV_ITEMS, so the sidebar and the guard cannot disagree: the
              workflow and history need `operations.redemption`, the catalog needs
              `operations.catalog`. A redemption operator therefore cannot reach
              pricing. (Backend permission checks remain authoritative regardless.) */}
              <Route path="/admin/redemption" element={protectedPage(<RedemptionWorkflowPage />)} />
              <Route
                path="/admin/redemption/history"
                element={protectedPage(<RedemptionHistoryPage />)}
              />
              <Route
                path="/admin/redemption/items"
                element={protectedPage(<RedemptionCatalogPage />)}
              />
              <Route path="/admin/staff" element={protectedPage(<AfHomesStaffPage />)} />
              <Route path="/admin/genealogy" element={protectedPage(<GenealogyPage />)} />
              <Route
                path="/admin/genealogy/:staffId"
                element={protectedPage(<GenealogyDetailsPage />)}
              />
              {/* OST onboarding. Each route is gated on its own module key via
              ADMIN_NAV_ITEMS, so the sidebar and the guard cannot disagree.
              Review (approve/reject) additionally requires the update grant,
              which the server checks - the SM pipeline is view-scoped. */}
              <Route
                path="/admin/ost/applications"
                element={protectedPage(<OstApplicationsPage />)}
              />
              <Route
                path="/admin/ost/applications/new"
                element={protectedPage(<OstManualRegistrationPage />)}
              />
              <Route
                path="/admin/ost/applications/import-export"
                element={protectedPage(<OstImportExportPage />)}
              />
              <Route
                path="/admin/ost/members/:id"
                element={protectedPage(<OstAccreditationHistoryPage />)}
              />
              <Route
                path="/admin/ost/applications/:id"
                element={protectedPage(<OstApplicationDetailPage />)}
              />
              <Route path="/admin/ost/members" element={protectedPage(<OstMembersPage />)} />
              <Route
                path="/admin/ost/referral-code"
                element={protectedPage(<OstReferralCodesPage />)}
              />
              {/* Membership cards. List/detail/print are gated on the
              finance.card_activation nav key; rotation additionally requires
              the update grant, which the server checks. */}
              <Route path="/admin/memberships" element={protectedPage(<MembershipsPage />)} />
              <Route
                path="/admin/memberships/:id"
                element={protectedPage(<MembershipDetailPage />)}
              />
              {/* ID documents. Gated on the sales.id_documents nav key; the server
              re-checks scope and never returns paths, hashes or raw ID numbers. */}
              <Route path="/admin/documents" element={protectedPage(<DocumentsPage />)} />
              <Route path="/admin/documents/:id" element={protectedPage(<DocumentReviewPage />)} />
              <Route
                path="/admin/memberships/:id/card"
                element={protectedPage(<MembershipCardPrintPage />)}
              />
              <Route
                path="/admin/departments"
                element={protectedPage(<AfHomesDepartmentsPage />)}
              />
              <Route path="/admin/roles" element={protectedPage(<AfHomesRolesPage />)} />
              {/* My Account: the forced first-login password change lives here, so
              the guard must let a gated session through (see RequireRole). */}
              <Route path="/admin/profile" element={protectedPage(<MyAccountPage />)} />
              {/* Phase 15 Reports and Audit Center. `/admin/reports` is visible to
              every role with `dashboard.view`; the screen offers only the
              reports the session allows. `/admin/audit` needs
              `governance.audit` - the guard and the server both enforce it. */}
              <Route path="/admin/reports" element={protectedPage(<ReportsPage />)} />
              <Route path="/admin/audit" element={protectedPage(<AuditPage />)} />
              <Route path="/admin/cms" element={<Navigate to="/admin/cms/pages" replace />} />
              <Route path="/admin/cms/pages" element={protectedPage(<CmsPagesPage />)} />
              <Route path="/admin/cms/media" element={protectedPage(<CmsMediaPage />)} />
              <Route
                path="/admin/cms/stories"
                element={protectedPage(
                  <CmsDocumentPage
                    title="Stories"
                    description="Structured story content rendered by the existing public templates."
                    documentKey="stories"
                  />,
                )}
              />
              <Route
                path="/admin/cms/experiences"
                element={protectedPage(
                  <CmsDocumentPage
                    title="Experiences"
                    description="Structured experience content rendered by the existing public templates."
                    documentKey="experiences"
                  />,
                )}
              />
              <Route
                path="/admin/cms/site-settings"
                element={protectedPage(
                  <CmsDocumentPage
                    title="Site Settings"
                    description="Site identity, contact details, navigation and footer content."
                    documentKey="site"
                  />,
                )}
              />
              <Route
                path="/admin/cms/seo"
                element={protectedPage(
                  <CmsDocumentPage
                    title="Page Content and SEO"
                    description="Structured copy and page-level metadata for the Phase 3 templates."
                    documentKey="pageContent"
                  />,
                )}
              />
              <Route path="/admin/cms/history" element={protectedPage(<CmsHistoryPage />)} />
              <Route path="/admin/staff/:id" element={protectedPage(<AfHomesStaffDetailPage />)} />
              <Route path="/admin/roles/:id" element={protectedPage(<AfHomesRoleDetailPage />)} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </>,
        )}
      </Routes>
    </ErrorBoundary>
  );
}
