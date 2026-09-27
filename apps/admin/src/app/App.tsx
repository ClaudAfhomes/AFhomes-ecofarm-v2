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
import { AdminLayout } from './AdminLayout';
import { ErrorBoundary } from './ErrorBoundary';
import { RequireRole } from './RequireRole';

const protectedPage = (page: ReactNode) => <RequireRole>{page}</RequireRole>;

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={protectedPage(<AfHomesDashboardPage />)} />
          <Route path="/admin/sales" element={protectedPage(<BusinessSalesPage />)} />
          <Route path="/admin/customers" element={protectedPage(<BusinessCustomersPage />)} />
          <Route path="/admin/products" element={protectedPage(<BusinessProductsPage />)} />
          <Route path="/admin/finance/payments" element={protectedPage(<BusinessFinanceQueuePage />)} />
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
          <Route path="/admin/departments" element={protectedPage(<AfHomesDepartmentsPage />)} />
          <Route path="/admin/roles" element={protectedPage(<AfHomesRolesPage />)} />
          <Route path="/admin/staff/:id" element={<Navigate to="/admin/staff" replace />} />
          <Route path="/admin/roles/:id" element={<Navigate to="/admin/roles" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
