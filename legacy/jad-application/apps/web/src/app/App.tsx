import { useEffect } from 'react';
import { NotFound, Skeleton } from '@jad/ui';
import { Navigate, Route, Routes, useLocation } from 'react-router';

import { useCmsRealtime } from '../lib/cmsRealtime';

import { ErrorBoundary } from './ErrorBoundary';
import { ScrollToTop } from './ScrollToTop';
import { PublicLayout } from './PublicLayout';

import { AboutPage } from '../features/public/pages/AboutPage';
import { CategoryPage } from '../features/public/pages/CategoryPage';
import { ContactPage } from '../features/public/pages/ContactPage';
import { FaqsPage } from '../features/public/pages/FaqsPage';
import { HomePage } from '../features/public/pages/HomePage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { NotFoundPage } from '../features/public/pages/NotFoundPage';
import { PoliciesPage as PublicPoliciesPage } from '../features/public/pages/PoliciesPage';
import { PolicyDetailPage as PublicPolicyDetailPage } from '../features/public/pages/PolicyDetailPage';
import { PropertiesPage } from '../features/public/pages/PropertiesPage';
import { PropertyDetailPage } from '../features/public/pages/PropertyDetailPage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { RegistrationStatusPage } from '../features/auth/pages/RegistrationStatusPage';
import { VerifyEmailPage } from '../features/auth/pages/VerifyEmailPage';
import { ForgotPasswordPage } from '../features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../features/auth/pages/ResetPasswordPage';
import { RequireMember } from '../features/member/guards/RequireMember';
import { RequireQualifiedMember } from '../features/member/guards/RequireQualifiedMember';
import { MemberLayout } from '../features/member/layouts/MemberLayout';
import { DashboardPage } from '../features/member/pages/DashboardPage';
import { AddPayoutAccountPage } from '../features/member/pages/AddPayoutAccountPage';
import { CommissionsListPage } from '../features/member/pages/CommissionsListPage';
import { ContentLibraryPage } from '../features/member/pages/ContentLibraryPage';
import { DirectReferralsPage } from '../features/member/pages/DirectReferralsPage';
import { EWalletPage } from '../features/member/pages/EWalletPage';
import { GroupNetworkPage } from '../features/member/pages/GroupNetworkPage';
import { LedgerPage } from '../features/member/pages/LedgerPage';
import { MessagesPage } from '../features/member/pages/MessagesPage';
import { MyGenealogyPage } from '../features/member/pages/MyGenealogyPage';
import { NotificationsPage } from '../features/member/pages/NotificationsPage';
import { PayoutAccountsPage } from '../features/member/pages/PayoutAccountsPage';
import { PoliciesPage } from '../features/member/pages/PoliciesPage';
import { PolicyDetailPage } from '../features/member/pages/PolicyDetailPage';
import { ProfilePage } from '../features/member/pages/ProfilePage';
import { QualificationStatusPage } from '../features/member/pages/QualificationStatusPage';
import { ReferralCodePage } from '../features/member/pages/ReferralCodePage';
import { ResubmitPage } from '../features/member/pages/ResubmitPage';
import { SaleDetailPage } from '../features/member/pages/SaleDetailPage';
import { SalesListPage } from '../features/member/pages/SalesListPage';
import { SaleSubmitPage } from '../features/member/pages/SaleSubmitPage';
import { TotalEarnedPage } from '../features/member/pages/TotalEarnedPage';
import { VoucherDetailPage } from '../features/member/pages/VoucherDetailPage';
import { VouchersListPage } from '../features/member/pages/VouchersListPage';
import { WithdrawalDetailPage } from '../features/member/pages/WithdrawalDetailPage';
import { WithdrawalRequestPage } from '../features/member/pages/WithdrawalRequestPage';
import { WithdrawalsListPage } from '../features/member/pages/WithdrawalsListPage';

function AdminRedirect() {
  const location = useLocation();
  useEffect(() => {
    const rawAdminUrl =
      (import.meta.env as Record<string, string | undefined>).VITE_ADMIN_URL ??
      'http://localhost:5174/admin';
    const base = rawAdminUrl.replace(/\/$/, '');
    const isBaseAdmin = base.endsWith('/admin');
    const path = `${location.pathname}${location.search}${location.hash}`;
    const target = isBaseAdmin ? `${base}${path.replace(/^\/admin/, '') || ''}` : `${base}${path}`;
    window.location.href = target;
  }, [location.pathname, location.search, location.hash]);
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ padding: 'var(--space-8)' }}>
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}

/**
 * Public website routes: Home, About Us, Properties (landing + category +
 * property detail), FAQs, Contacts, plus the friendly not-found state
 * (UI-UX §10 / FRONTEND-ARCHITECTURE §3).
 * Member auth (SCR-AUTH-001..004): Login, Registration, Email Verification,
 * Application Status. The Member panel (F1: SCR-MEM-001..007) lives under
 * `/member/*` behind RequireMember; sales routes additionally require Active +
 * Qualified membership (RequireQualifiedMember). SCR-AUTH-005 resubmit is a
 * member route (REJECTED members only). F2-B adds referral reporting
 * (SCR-MEM-016..019), vouchers (020/021), content/policies/notifications
 * (022..024) under the same guard.
 */

export default function App() {
  useCmsRealtime();
  return (
    <ErrorBoundary>
      <ScrollToTop />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="properties" element={<PropertiesPage />} />
          <Route path="properties/:categorySlug" element={<CategoryPage />} />
          <Route path="properties/:categorySlug/:propertySlug" element={<PropertyDetailPage />} />
          <Route path="faqs" element={<FaqsPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="policies" element={<PublicPoliciesPage />} />
          <Route path="policies/:policyId" element={<PublicPolicyDetailPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="register/verify-email" element={<VerifyEmailPage />} />
          <Route path="register/status" element={<RegistrationStatusPage />} />
          <Route path="auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="auth/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route element={<MemberLayout />}>
          <Route
            path="/member"
            element={
              <RequireMember>
                <DashboardPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/profile"
            element={
              <RequireMember>
                <ProfilePage />
              </RequireMember>
            }
          />
          <Route
            path="/member/qualification"
            element={
              <RequireMember>
                <QualificationStatusPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/referrals"
            element={
              <RequireMember>
                <ReferralCodePage />
              </RequireMember>
            }
          />
          <Route
            path="/member/referrals/direct"
            element={
              <RequireMember>
                <DirectReferralsPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/referrals/network"
            element={
              <RequireMember>
                <GroupNetworkPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/referrals/genealogy"
            element={
              <RequireMember>
                <MyGenealogyPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/referrals/earned"
            element={
              <RequireMember>
                <TotalEarnedPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/sales"
            element={
              <RequireMember>
                <RequireQualifiedMember>
                  <SalesListPage />
                </RequireQualifiedMember>
              </RequireMember>
            }
          />
          <Route
            path="/member/sales/new"
            element={
              <RequireMember>
                <RequireQualifiedMember>
                  <SaleSubmitPage />
                </RequireQualifiedMember>
              </RequireMember>
            }
          />
          <Route
            path="/member/sales/:saleId"
            element={
              <RequireMember>
                <RequireQualifiedMember>
                  <SaleDetailPage />
                </RequireQualifiedMember>
              </RequireMember>
            }
          />
          <Route
            path="/member/resubmit"
            element={
              <RequireMember>
                <ResubmitPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/ewallet"
            element={
              <RequireMember>
                <EWalletPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/ewallet/ledger"
            element={
              <RequireMember>
                <LedgerPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/payouts"
            element={
              <RequireMember>
                <PayoutAccountsPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/payouts/new"
            element={
              <RequireMember>
                <AddPayoutAccountPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/withdrawals"
            element={
              <RequireMember>
                <WithdrawalsListPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/withdrawals/new"
            element={
              <RequireMember>
                <WithdrawalRequestPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/withdrawals/:withdrawalId"
            element={
              <RequireMember>
                <WithdrawalDetailPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/commissions"
            element={
              <RequireMember>
                <CommissionsListPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/vouchers"
            element={
              <RequireMember>
                <VouchersListPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/vouchers/:voucherId"
            element={
              <RequireMember>
                <VoucherDetailPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/marketing-tools"
            element={
              <RequireMember>
                <ContentLibraryPage />
              </RequireMember>
            }
          />
          <Route path="/member/news" element={<Navigate to="/member/marketing-tools" replace />} />
          <Route
            path="/member/policies"
            element={
              <RequireMember>
                <PoliciesPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/policies/:policyId"
            element={
              <RequireMember>
                <PolicyDetailPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/notifications"
            element={
              <RequireMember>
                <NotificationsPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/messages"
            element={
              <RequireMember>
                <MessagesPage />
              </RequireMember>
            }
          />
          <Route
            path="/member/*"
            element={
              <RequireMember>
                <NotFound />
              </RequireMember>
            }
          />
        </Route>
        <Route path="/admin" element={<AdminRedirect />} />
        <Route path="/admin/*" element={<AdminRedirect />} />
      </Routes>
    </ErrorBoundary>
  );
}
