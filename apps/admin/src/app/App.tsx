import { lazy } from 'react';
const PublicVerificationSettingsPage = lazy(() =>
  import('../features/afhomes/PublicVerificationSettingsPage').then((m) => ({
    default: m.PublicVerificationSettingsPage,
  })),
);

// Route pages load on demand: one chunk per feature module.
// Auth screens, layout, and guards stay eager for first paint.
const CustomerLookupPage = lazy(() =>
  import('../features/memberships/CustomerLookupPage').then((m) => ({
    default: m.CustomerLookupPage,
  })),
);
const MemberLookupPage = lazy(() =>
  import('../features/memberships/MemberLookupPage').then((m) => ({ default: m.MemberLookupPage })),
);
const AfHomesDashboardPage = lazy(() =>
  import('../features/afhomes/AfHomesDashboardPage').then((m) => ({
    default: m.AfHomesDashboardPage,
  })),
);
const AfHomesDepartmentsPage = lazy(() =>
  import('../features/afhomes/AfHomesDepartmentsPage').then((m) => ({
    default: m.AfHomesDepartmentsPage,
  })),
);
const AfHomesRoleDetailPage = lazy(() =>
  import('../features/afhomes/AfHomesRoleDetailPage').then((m) => ({
    default: m.AfHomesRoleDetailPage,
  })),
);
const AfHomesRolesPage = lazy(() =>
  import('../features/afhomes/AfHomesRolesPage').then((m) => ({ default: m.AfHomesRolesPage })),
);
const AfHomesStaffDetailPage = lazy(() =>
  import('../features/afhomes/AfHomesStaffDetailPage').then((m) => ({
    default: m.AfHomesStaffDetailPage,
  })),
);
const AfHomesStaffPage = lazy(() =>
  import('../features/afhomes/AfHomesStaffPage').then((m) => ({ default: m.AfHomesStaffPage })),
);
const BusinessActivationQueuePage = lazy(() =>
  import('../features/business/BusinessActivationQueuePage').then((m) => ({
    default: m.BusinessActivationQueuePage,
  })),
);
const BusinessCommissionsPage = lazy(() =>
  import('../features/business/BusinessCommissionsPage').then((m) => ({
    default: m.BusinessCommissionsPage,
  })),
);
const CommissionSettingsPage = lazy(() =>
  import('../features/business/CommissionSettingsPage').then((m) => ({
    default: m.CommissionSettingsPage,
  })),
);
const BusinessCustomersPage = lazy(() =>
  import('../features/business/BusinessCustomersPage').then((m) => ({
    default: m.BusinessCustomersPage,
  })),
);
const CustomerDetailPage = lazy(() =>
  import('../features/business/CustomerDetailPage').then((m) => ({
    default: m.CustomerDetailPage,
  })),
);
const CustomerImportExportPage = lazy(() =>
  import('../features/business/CustomerImportExportPage').then((m) => ({
    default: m.CustomerImportExportPage,
  })),
);
const BusinessFinanceQueuePage = lazy(() =>
  import('../features/business/BusinessFinanceQueuePage').then((m) => ({
    default: m.BusinessFinanceQueuePage,
  })),
);
const BusinessPointsPage = lazy(() =>
  import('../features/business/BusinessPointsPage').then((m) => ({
    default: m.BusinessPointsPage,
  })),
);
const UseVipPointsPage = lazy(() =>
  import('../features/business/UseVipPointsPage').then((m) => ({ default: m.UseVipPointsPage })),
);
const PointsRulesPage = lazy(() =>
  import('../features/business/PointsRulesPage').then((m) => ({ default: m.PointsRulesPage })),
);
const SalesRecordsPage = lazy(() =>
  import('../features/business/SalesRecordsPage').then((m) => ({ default: m.SalesRecordsPage })),
);
const PurchasePaymentsPage = lazy(() =>
  import('../features/business/PurchasePaymentsPage').then((m) => ({
    default: m.PurchasePaymentsPage,
  })),
);
const BusinessProductsPage = lazy(() =>
  import('../features/business/BusinessProductsPage').then((m) => ({
    default: m.BusinessProductsPage,
  })),
);
const PaymentSchemeGuidePage = lazy(() =>
  import('../features/business/PaymentSchemeGuidePage').then((m) => ({
    default: m.PaymentSchemeGuidePage,
  })),
);
const CustomerApplicationEditorPage = lazy(() =>
  import('../features/business/OfficialFormsPages').then((m) => ({
    default: m.CustomerApplicationEditorPage,
  })),
);
const ReservationAgreementEditorPage = lazy(() =>
  import('../features/business/OfficialFormsPages').then((m) => ({
    default: m.ReservationAgreementEditorPage,
  })),
);
const ReservationAgreementsPage = lazy(() =>
  import('../features/business/OfficialFormsPages').then((m) => ({
    default: m.ReservationAgreementsPage,
  })),
);
const LegacyRedemptionHistoryPage = lazy(() =>
  import('../features/redemption/LegacyRedemptionHistoryPage').then((m) => ({
    default: m.LegacyRedemptionHistoryPage,
  })),
);
const RedemptionHistoryPage = lazy(() =>
  import('../features/redemption/RedemptionHistoryPage').then((m) => ({
    default: m.RedemptionHistoryPage,
  })),
);
const RedemptionWorkflowPage = lazy(() =>
  import('../features/redemption/RedemptionWorkflowPage').then((m) => ({
    default: m.RedemptionWorkflowPage,
  })),
);
const MyAccountPage = lazy(() =>
  import('../features/account/MyAccountPage').then((m) => ({ default: m.MyAccountPage })),
);
const CmsDocumentPage = lazy(() =>
  import('../features/cms/CmsDocumentPage').then((m) => ({ default: m.CmsDocumentPage })),
);
const CmsHistoryPage = lazy(() =>
  import('../features/cms/CmsHistoryPage').then((m) => ({ default: m.CmsHistoryPage })),
);
const CmsMediaPage = lazy(() =>
  import('../features/cms/CmsMediaPage').then((m) => ({ default: m.CmsMediaPage })),
);
const CmsPagesPage = lazy(() =>
  import('../features/cms/CmsPagesPage').then((m) => ({ default: m.CmsPagesPage })),
);
const GenealogyPage = lazy(() =>
  import('../features/genealogy/GenealogyPage').then((m) => ({ default: m.GenealogyPage })),
);
const GenealogyDetailsPage = lazy(() =>
  import('../features/genealogy/GenealogyDetailsPage').then((m) => ({
    default: m.GenealogyDetailsPage,
  })),
);
const MembersPage = lazy(() =>
  import('../features/network-members/MembersPage').then((m) => ({ default: m.MembersPage })),
);
// ID documents are no longer reviewed on their own screen: the uploaded scan
// follows the status of the customer application that created it. The image is
// still loaded on the customer record via the (kept) current/access-url
// endpoints, but there is no list or review route any more.
const MembershipCardPrintPage = lazy(() =>
  import('../features/memberships/MembershipCardPrintPage').then((m) => ({
    default: m.MembershipCardPrintPage,
  })),
);
const MembershipDetailPage = lazy(() =>
  import('../features/memberships/MembershipDetailPage').then((m) => ({
    default: m.MembershipDetailPage,
  })),
);
const MembershipsPage = lazy(() =>
  import('../features/memberships/MembershipsPage').then((m) => ({ default: m.MembershipsPage })),
);
const OstApplicationDetailPage = lazy(() =>
  import('../features/ost/OstApplicationDetailPage').then((m) => ({
    default: m.OstApplicationDetailPage,
  })),
);
const OstApplicationsPage = lazy(() =>
  import('../features/ost/OstApplicationsPage').then((m) => ({ default: m.OstApplicationsPage })),
);
const OstManualRegistrationPage = lazy(() =>
  import('../features/ost/OstAccreditationPages').then((m) => ({
    default: m.OstManualRegistrationPage,
  })),
);
const OstAccreditationHistoryPage = lazy(() =>
  import('../features/ost/OstAccreditationPages').then((m) => ({
    default: m.OstAccreditationHistoryPage,
  })),
);
const OstImportExportPage = lazy(() =>
  import('../features/ost/OstAccreditationPages').then((m) => ({ default: m.OstImportExportPage })),
);
const OstReferralCodesPage = lazy(() =>
  import('../features/ost/OstReferralCodesPage').then((m) => ({ default: m.OstReferralCodesPage })),
);
const AuditPage = lazy(() =>
  import('../features/reports/AuditPage').then((m) => ({ default: m.AuditPage })),
);
const ReportsPage = lazy(() =>
  import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);

import { Navigate, Route, Routes, useLocation } from 'react-router';
import { staffPortalPath } from '@afhomes/contracts';
import { useSession } from '../lib/session';
import type { ReactNode } from 'react';
import { roleRoutes } from './role-routes';
import { NotFound } from '@afhomes/ui';
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
import { AdminLayout } from './AdminLayout';
import { ErrorBoundary } from './ErrorBoundary';
import { RequireRole } from './RequireRole';
import { isIstRole } from '@afhomes/contracts';

const IstPortalPage = lazy(() => import('../features/ist/IstPortalPage').then(m => ({ default: m.IstPortalPage })));
const IstAccreditationPage = lazy(() => import('../features/ist/IstPortalPage').then(m => ({ default: m.IstAccreditationPage })));

const protectedPage = (page: ReactNode) => <RequireRole>{page}</RequireRole>;

export default function App() {
  const location = useLocation();
  const { status, user } = useSession();
  const publicAuth = /\/(login|forgot-password|reset-password|activate-account)$/.test(
    location.pathname,
  );
  const canonical = staffPortalPath(user?.roleSlug, location.pathname);
  if (status === 'authenticated' && user?.roleSlug === 'ost' && !publicAuth)
    return <Navigate replace to="/staff/login" />;
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
          `operations.customer_lookup` view the nav uses, so hiding the link and
          refusing the URL cannot disagree. */}
              <Route
                path="/admin/customer-lookup"
                element={protectedPage(<CustomerLookupPage />)}
              />
              {/* Member TRANSACTION lookup: shows Membership Codes, reachable from
          Redemption rather than from the global nav. */}
              <Route path="/admin/member-lookup" element={protectedPage(<MemberLookupPage />)} />
              <Route path="/admin" element={protectedPage(isIstRole(user?.roleSlug) ? <IstPortalPage /> : <AfHomesDashboardPage />)} />
              <Route path="/admin/ist/my-sales" element={protectedPage(<IstPortalPage view="my-sales" />)} />
              <Route path="/admin/ist/team-sales" element={protectedPage(<IstPortalPage view="team-sales" />)} />
              <Route path="/admin/ist/my-commissions" element={protectedPage(<IstPortalPage view="my-commissions" />)} />
              <Route path="/admin/ist/team-commissions" element={protectedPage(<IstPortalPage view="team-commissions" />)} />
              <Route path="/admin/ist/accreditation" element={protectedPage(<IstAccreditationPage />)} />
              {/* Internal IST payment-scheme reference. Gated on the
              sales.card_sales nav key like the sales list; customers and
              anonymous visitors never reach the staff app at all. */}
              <Route
                path="/admin/sales/payment-scheme-guide"
                element={protectedPage(<PaymentSchemeGuidePage />)}
              />
              <Route path="/admin/customers" element={protectedPage(<BusinessCustomersPage />)} />
              {/*
                The customer area is exactly THREE screens: main (list), create,
                and detail. The create screen IS the application builder - the
                builder is what creates the customer, so a separate
                "/admin/customers/create" page would be a second form for one
                action. The main screen carries two views, People and
                Applications, on two real addresses so the sidebar can highlight
                whichever is on screen. The retired
                `/admin/customers/applications/*` addresses below redirect rather
                than 404, because operators have them bookmarked.
              */}
              <Route
                path="/admin/customers/new"
                element={protectedPage(<CustomerApplicationEditorPage />)}
              />
              <Route path="/admin/customers/:id" element={protectedPage(<CustomerDetailPage />)} />
              <Route
                path="/admin/customers/applications"
                element={protectedPage(<BusinessCustomersPage />)}
              />
              <Route
                path="/admin/customers/applications/import-export"
                element={protectedPage(<CustomerImportExportPage />)}
              />
              <Route
                path="/admin/customers/applications/new"
                element={<Navigate to="/admin/customers/new" replace />}
              />
              <Route
                path="/admin/customers/applications/:id"
                element={protectedPage(<CustomerApplicationEditorPage />)}
              />
              <Route
                path="/admin/customers/applications/:id/edit"
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
              {/* Order is irrelevant to React Router (static segments outrank the
                  bare prefix), but the deeper path is listed first so it reads as
                  a child of Earn Points. */}
              <Route path="/admin/points/records" element={protectedPage(<SalesRecordsPage />)} />
              <Route path="/admin/points/rules" element={protectedPage(<PointsRulesPage />)} />
              <Route path="/admin/points/use" element={protectedPage(<UseVipPointsPage />)} />
              <Route
                path="/admin/points/discount"
                element={protectedPage(<Navigate replace to="/admin/redemption" />)}
              />
              <Route
                path="/admin/points/payments"
                element={protectedPage(<PurchasePaymentsPage />)}
              />
              <Route path="/admin/points" element={protectedPage(<BusinessPointsPage />)} />
              {/* Canonical Commission Settings live at /admin/commissions/settings
              (the Finance sidebar entry). This /finance/ twin exists only so
              old bookmarks keep working; it redirects instead of rendering so
              the sidebar guard and breadcrumb resolve the canonical entry and
              its `network.commissions` key - never the Finance parent prefix. */}
              <Route
                path="/admin/finance/commissions/settings"
                element={protectedPage(<Navigate replace to="/admin/commissions/settings" />)}
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
                element={protectedPage(<Navigate replace to="/admin/redemption" />)}
              />
              <Route
                path="/admin/redemption/legacy-history"
                element={protectedPage(<LegacyRedemptionHistoryPage />)}
              />
              <Route path="/admin/staff" element={protectedPage(<AfHomesStaffPage />)} />
              <Route path="/admin/genealogy" element={protectedPage(<GenealogyPage />)} />
              <Route
                path="/admin/genealogy/:staffId"
                element={protectedPage(<GenealogyDetailsPage />)}
              />
              <Route
                path="/admin/network/members"
                element={protectedPage(<MembersPage />)}
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
              {/* ID documents are no longer reviewed on their own screen; the scan
              travels with the customer application that created it. The upload and
              current/access-url endpoints remain for intake and display. */}
              <Route
                path="/admin/memberships/:id/card"
                element={protectedPage(<MembershipCardPrintPage />)}
              />
              <Route
                path="/admin/departments"
                element={protectedPage(<AfHomesDepartmentsPage />)}
              />
              <Route path="/admin/roles" element={protectedPage(<AfHomesRolesPage />)} />
              <Route path="/admin/settings/public-verification" element={protectedPage(<PublicVerificationSettingsPage />)} />
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
              <Route path="/admin/cms/faq" element={protectedPage(<CmsDocumentPage title="FAQ" description="Questions and answers for the public website." documentKey="faq" />)} />
              <Route path="/admin/cms/vip" element={protectedPage(<CmsDocumentPage title="VIP Website Content" description="Marketing names and imagery; operational entitlements are read-only." documentKey="vip" />)} />
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
                    description="Site identity, public contacts, navigation and footer content."
                    mode="site"
                    documentKey="site"
                  />,
                )}
              />
              <Route
                path="/admin/cms/seo"
                element={protectedPage(
                  <CmsDocumentPage
                    title="SEO"
                    mode="seo"
                    description="Global and page-specific search and sharing metadata."
                    documentKey="site"
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
