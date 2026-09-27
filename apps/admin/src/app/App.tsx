import { Navigate, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import { NotFound } from '@jad/ui';
import { AfHomesDashboardPage } from '../features/afhomes/AfHomesDashboardPage';
import { AfHomesDepartmentsPage } from '../features/afhomes/AfHomesDepartmentsPage';
import { AfHomesRolesPage } from '../features/afhomes/AfHomesRolesPage';
import { AfHomesStaffPage } from '../features/afhomes/AfHomesStaffPage';
import { BusinessActivationQueuePage } from '../features/business/BusinessActivationQueuePage';
import { BusinessCustomersPage } from '../features/business/BusinessCustomersPage';
import { BusinessFinanceQueuePage } from '../features/business/BusinessFinanceQueuePage';
import { BusinessProductsPage } from '../features/business/BusinessProductsPage';
import { BusinessSalesPage } from '../features/business/BusinessSalesPage';
import { RedemptionCatalogPage } from '../features/redemption/RedemptionCatalogPage';
import { RedemptionHistoryPage } from '../features/redemption/RedemptionHistoryPage';
import { RedemptionWorkflowPage } from '../features/redemption/RedemptionWorkflowPage';
import { AdminLoginPage } from '../features/auth/AdminLoginPage';
import { CmsDocumentPage } from '../features/cms/CmsDocumentPage';
import { CmsHistoryPage } from '../features/cms/CmsHistoryPage';
import { CmsMediaPage } from '../features/cms/CmsMediaPage';
import { CmsPagesPage } from '../features/cms/CmsPagesPage';
import { GenealogyPage } from '../features/genealogy/GenealogyPage';
import { GenealogyDetailsPage } from '../features/genealogy/GenealogyDetailsPage';
import { OstApplicationDetailPage } from '../features/ost/OstApplicationDetailPage';
import { OstApplicationsPage } from '../features/ost/OstApplicationsPage';
import { OstMembersPage } from '../features/ost/OstMembersPage';
import { OstReferralCodesPage } from '../features/ost/OstReferralCodesPage';
import { AdminLayout } from './AdminLayout';
import { ErrorBoundary } from './ErrorBoundary';
import { RequireRole } from './RequireRole';

const protectedPage = (page: ReactNode) => <RequireRole>{page}</RequireRole>;

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={protectedPage(<AfHomesDashboardPage />)} />
          <Route path="/admin/sales" element={protectedPage(<BusinessSalesPage />)} />
          <Route path="/admin/customers" element={protectedPage(<BusinessCustomersPage />)} />
          <Route path="/admin/products" element={protectedPage(<BusinessProductsPage />)} />
          <Route
            path="/admin/finance/payments"
            element={protectedPage(<BusinessFinanceQueuePage />)}
          />
          <Route
            path="/admin/finance/activation"
            element={protectedPage(<BusinessActivationQueuePage />)}
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
          <Route path="/admin/ost/applications" element={protectedPage(<OstApplicationsPage />)} />
          <Route
            path="/admin/ost/applications/:id"
            element={protectedPage(<OstApplicationDetailPage />)}
          />
          <Route path="/admin/ost/members" element={protectedPage(<OstMembersPage />)} />
          <Route
            path="/admin/ost/referral-code"
            element={protectedPage(<OstReferralCodesPage />)}
          />
          <Route path="/admin/departments" element={protectedPage(<AfHomesDepartmentsPage />)} />
          <Route path="/admin/roles" element={protectedPage(<AfHomesRolesPage />)} />
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
          <Route path="/admin/staff/:id" element={<Navigate to="/admin/staff" replace />} />
          <Route path="/admin/roles/:id" element={<Navigate to="/admin/roles" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
