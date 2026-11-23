import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { NotFound, ScrollToTop } from '@afhomes/ui';
import { FEATURE_FLAGS } from '@afhomes/shared';

import { LoadingState } from '../marketing/components/ui/Feedback';
import { OstGuard } from './OstGuard';

// Keep each account entry and shell out of unrelated route downloads.
const CustomerActivatePage = lazy(() =>
  import('../features/customer/CustomerActivatePage').then((m) => ({
    default: m.CustomerActivatePage,
  })),
);
const CustomerForgotPasswordPage = lazy(() =>
  import('../features/customer/CustomerForgotPasswordPage').then((m) => ({
    default: m.CustomerForgotPasswordPage,
  })),
);
const CustomerLoginPage = lazy(() =>
  import('../features/customer/CustomerLoginPage').then((m) => ({ default: m.CustomerLoginPage })),
);
const CustomerResetPasswordPage = lazy(() =>
  import('../features/customer/CustomerResetPasswordPage').then((m) => ({
    default: m.CustomerResetPasswordPage,
  })),
);
const AdminEntryPage = lazy(() =>
  import('../features/staff/StaffEntryPage').then((m) => ({ default: m.AdminEntryPage })),
);
const StaffLoginEntryPage = lazy(() =>
  import('../features/staff/StaffEntryPage').then((m) => ({ default: m.StaffLoginEntryPage })),
);
const OstLoginPage = lazy(() =>
  import('../features/ost/OstLoginPage').then((m) => ({ default: m.OstLoginPage })),
);
const OstForgotPasswordPage = lazy(() =>
  import('../features/ost/OstForgotPasswordPage').then((m) => ({
    default: m.OstForgotPasswordPage,
  })),
);
const OstResetPasswordPage = lazy(() =>
  import('../features/ost/OstResetPasswordPage').then((m) => ({ default: m.OstResetPasswordPage })),
);
const MarketingLayout = lazy(() =>
  import('../marketing/MarketingLayout').then((m) => ({ default: m.MarketingLayout })),
);
const CustomerLayout = lazy(() =>
  import('./CustomerLayout').then((m) => ({ default: m.CustomerLayout })),
);
const OstLayout = lazy(() => import('./OstLayout').then((m) => ({ default: m.OstLayout })));

// Portal screens load only when opened, like the marketing routes below.
const CustomerDashboardPage = lazy(() =>
  import('../features/customer/CustomerDashboardPage').then((m) => ({
    default: m.CustomerDashboardPage,
  })),
);
const CustomerMembershipPage = lazy(() =>
  import('../features/customer/CustomerMembershipPage').then((m) => ({
    default: m.CustomerMembershipPage,
  })),
);
const CustomerPaymentsPage = lazy(() =>
  import('../features/customer/CustomerPaymentsPage').then((m) => ({
    default: m.CustomerPaymentsPage,
  })),
);
const CustomerPointsPage = lazy(() =>
  import('../features/customer/CustomerPointsPage').then((m) => ({
    default: m.CustomerPointsPage,
  })),
);
const CustomerProfilePage = lazy(() =>
  import('../features/customer/CustomerProfilePage').then((m) => ({
    default: m.CustomerProfilePage,
  })),
);
const CustomerRedemptionsPage = lazy(() =>
  import('../features/customer/CustomerRedemptionsPage').then((m) => ({
    default: m.CustomerRedemptionsPage,
  })),
);
const CustomerBookingsPage = lazy(() =>
  import('../features/customer/CustomerBookingsPage').then((m) => ({
    default: m.CustomerBookingsPage,
  })),
);
const CustomerMessagesPage = lazy(() =>
  import('../features/customer/CustomerMessagesPage').then((m) => ({
    default: m.CustomerMessagesPage,
  })),
);
const CustomerNotificationsPage = lazy(() =>
  import('../features/customer/CustomerNotificationsPage').then((m) => ({
    default: m.CustomerNotificationsPage,
  })),
);
const OstRegisterPage = lazy(() =>
  import('../features/ost/OstRegisterPage').then((m) => ({ default: m.OstRegisterPage })),
);
const OstDashboardPage = lazy(() =>
  import('../features/ost/OstDashboardPage').then((m) => ({ default: m.OstDashboardPage })),
);
const OstSalesPage = lazy(() =>
  import('../features/ost/OstSalesPage').then((m) => ({ default: m.OstSalesPage })),
);
const OstCommissionsPage = lazy(() =>
  import('../features/ost/OstCommissionsPage').then((m) => ({ default: m.OstCommissionsPage })),
);
const OstAccreditationPage = lazy(() =>
  import('../features/ost/OstAccreditationPage').then((m) => ({ default: m.OstAccreditationPage })),
);
const OstProfilePage = lazy(() =>
  import('../features/ost/OstProfilePage').then((m) => ({ default: m.OstProfilePage })),
);
const OstRenewalPage = lazy(() =>
  import('../features/ost/OstRenewalPage').then((m) => ({ default: m.OstRenewalPage })),
);

const HomePage = lazy(() =>
  import('../features/customer/HomeLoginPage').then((m) => ({ default: m.HomeLoginPage })),
);
const ExperiencesPage = lazy(() => import('../marketing/pages/Experiences'));
const SmartWellnessHotelPage = lazy(() => import('../marketing/pages/SmartWellnessHotel'));
const ALMJapaneseRestaurantPage = lazy(() => import('../marketing/pages/ALMJapaneseRestaurant'));
const HotspringEcofarmPage = lazy(() => import('../marketing/pages/HotspringEcofarm'));
const ExperienceDetailPage = lazy(() => import('../marketing/pages/ExperienceDetail'));
const VIPPrivilegePage = lazy(() => import('../marketing/pages/VIPPrivilege'));
const AboutPage = lazy(() => import('../marketing/pages/About'));
const StoriesPage = lazy(() => import('../marketing/pages/Stories'));
const CmsPage = lazy(() => import('../marketing/pages/CmsPage'));
const StoryDetailPage = lazy(() => import('../marketing/pages/StoryDetail'));
const FAQPage = lazy(() => import('../marketing/pages/FAQ'));
const CompliancePage = lazy(() => import('../marketing/pages/Compliance'));
const ContactPage = lazy(() => import('../marketing/pages/Contact'));
const SaleTeamSearchPage = lazy(() => import('../marketing/pages/SaleTeamSearch'));
const MarketingNotFoundPage = lazy(() => import('../marketing/pages/NotFound'));

/**
 * Public site + customer portal routes.
 *
 * `/` is the homepage WITH the member sign-in beside the hero (same CMS copy
 * and imagery as the marketing hero, all other sections unchanged). Customer
 * auth (`/customer/login`, activate, recovery) and the OST portal
 * (`/ost/login`, `/ost/register`, `/ost/dashboard`) are public by necessity;
 * the customer portal stays guarded behind `CustomerLayout`, the OST portal
 * behind `OstLayout`, and each portal keeps its own `*` fallback.
 *
 * Route precedence note: static segments (`/customer/...`, `/ost/...`)
 * always outrank the root `*`, so public routes can never swallow them — and
 * `/admin/*` + `/api/*` never reach this SPA at all (Vercel rewrites).
 */
export default function App() {
  return (
    <>
    <ScrollToTop />
    <Suspense fallback={<LoadingState />}>
    <Routes>
      <Route
        element={
          <Suspense fallback={<LoadingState />}>
            <MarketingLayout />
          </Suspense>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="experiences" element={<ExperiencesPage />} />
        <Route path="experiences/smart-wellness-hotel" element={<SmartWellnessHotelPage />} />
        <Route path="experiences/alm-japanese-restaurant" element={<ALMJapaneseRestaurantPage />} />
        <Route path="experiences/hotspring-ecofarm-resort" element={<HotspringEcofarmPage />} />
        <Route path="experiences/:slug" element={<ExperienceDetailPage />} />
        <Route path="vip" element={<VIPPrivilegePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="stories" element={<StoriesPage />} />
        <Route path="stories/:slug" element={<StoryDetailPage />} />
        <Route path="faq" element={<FAQPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="sale-team-search" element={<SaleTeamSearchPage />} />
        <Route path=":slug" element={<CmsPage />} />
      </Route>

      <Route path="/customer/login" element={<CustomerLoginPage />} />
      {/* Local-dev staff entry (see StaffEntryPage). Production serves
          `/admin/*` from the admin bundle via vercel.json, so these web routes
          are a dev convenience: sign in here, continue on the staff console
          origin. Bare paths render the matching login (never a dashboard). */}
      <Route path="/admin/login" element={<AdminEntryPage />} />
      <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
      <Route path="/staff/login" element={<StaffLoginEntryPage />} />
      <Route path="/staff" element={<Navigate to="/staff/login" replace />} />
      <Route path="/customer/activate" element={<CustomerActivatePage />} />
      {/* Phase 16 recovery: public by necessity, alongside login/activate.
          Static segments outrank the marketing `:slug`, so these can never be
          swallowed by the CMS routes. */}
      <Route path="/customer/forgot-password" element={<CustomerForgotPasswordPage />} />
      <Route path="/customer/reset-password" element={<CustomerResetPasswordPage />} />
      {/* Public OST portal. Registration is referral-first and login needs an
          approved OST record; the dashboard is guarded separately below. */}
      <Route path="/ost/register" element={<OstRegisterPage />} />
      <Route
        path="/ost/renewal"
        element={
          <OstGuard>
            <OstRenewalPage />
          </OstGuard>
        }
      />
      <Route path="/ost/login" element={<OstLoginPage />} />
      <Route path="/ost/forgot-password" element={<OstForgotPasswordPage />} />
      <Route path="/ost/reset-password" element={<OstResetPasswordPage />} />
      <Route path="/ost/change-password" element={<OstResetPasswordPage firstLogin />} />
      <Route
        path="/ost"
        element={
          <OstLayout />
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<OstDashboardPage />} />
        <Route path="sales" element={<OstSalesPage />} />
        <Route path="commissions" element={<OstCommissionsPage />} />
        <Route path="accreditation" element={<OstAccreditationPage />} />
        <Route path="profile" element={<OstProfilePage />} />
      </Route>

      <Route path="/customer" element={<CustomerLayout />}>
        <Route index element={<CustomerDashboardPage />} />
        <Route path="membership" element={<CustomerMembershipPage />} />
        <Route path="points" element={FEATURE_FLAGS.services ? <CustomerPointsPage /> : <NotFound />} />
        <Route path="redemptions" element={FEATURE_FLAGS.redemption ? <CustomerRedemptionsPage /> : <NotFound />} />
        <Route path="payments" element={<CustomerPaymentsPage />} />
        <Route path="bookings" element={<CustomerBookingsPage />} />
        <Route path="messages" element={<CustomerMessagesPage />} />
        <Route path="notifications" element={<CustomerNotificationsPage />} />
        <Route path="profile" element={<CustomerProfilePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<MarketingNotFoundPage />} />
    </Routes>
    </Suspense>
    </>
  );
}
