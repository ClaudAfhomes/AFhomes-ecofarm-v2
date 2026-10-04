import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';

import { NotFound } from '@jad/ui';

import { CustomerActivatePage } from '../features/customer/CustomerActivatePage';
import { CustomerDashboardPage } from '../features/customer/CustomerDashboardPage';
import { CustomerForgotPasswordPage } from '../features/customer/CustomerForgotPasswordPage';
import { CustomerLoginPage } from '../features/customer/CustomerLoginPage';
import { CustomerResetPasswordPage } from '../features/customer/CustomerResetPasswordPage';
import { CustomerMembershipPage } from '../features/customer/CustomerMembershipPage';
import { CustomerPaymentsPage } from '../features/customer/CustomerPaymentsPage';
import { CustomerPointsPage } from '../features/customer/CustomerPointsPage';
import { CustomerProfilePage } from '../features/customer/CustomerProfilePage';
import { CustomerRedemptionsPage } from '../features/customer/CustomerRedemptionsPage';
import { OstRegisterPage } from '../features/ost/OstRegisterPage';
import { OstLoginPage } from '../features/ost/OstLoginPage';
import { OstDashboardPage } from '../features/ost/OstDashboardPage';
import { OstRenewalPage } from '../features/ost/OstRenewalPage';
import { OstForgotPasswordPage } from '../features/ost/OstForgotPasswordPage';
import { OstResetPasswordPage } from '../features/ost/OstResetPasswordPage';
import { LoadingState } from '../marketing/components/ui/Feedback';
import { MarketingLayout } from '../marketing/MarketingLayout';
import { CustomerLayout } from './CustomerLayout';
import { OstGuard } from './OstGuard';

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
const MarketingNotFoundPage = lazy(() => import('../marketing/pages/NotFound'));

/**
 * Public site + customer portal routes.
 *
 * `/` is the homepage WITH the member sign-in beside the hero (same CMS copy
 * and imagery as the marketing hero, all other sections unchanged). Customer
 * auth (`/customer/login`, activate, recovery) and the OST portal
 * (`/ost/login`, `/ost/register`, `/ost/dashboard`) are public by necessity;
 * the customer portal stays guarded behind `CustomerLayout`, the OST portal
 * behind `OstGuard`, and each portal keeps its own `*` fallback.
 *
 * Route precedence note: static segments (`/customer/...`, `/ost/...`)
 * always outrank the root `*`, so public routes can never swallow them — and
 * `/admin/*` + `/api/*` never reach this SPA at all (Vercel rewrites).
 */
export default function App() {
  return (
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
        <Route path=":slug" element={<CmsPage />} />
      </Route>

      <Route path="/customer/login" element={<CustomerLoginPage />} />
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
      <Route
        path="/ost/dashboard"
        element={
          <OstGuard>
            <OstDashboardPage />
          </OstGuard>
        }
      />

      <Route path="/customer" element={<CustomerLayout />}>
        <Route index element={<CustomerDashboardPage />} />
        <Route path="membership" element={<CustomerMembershipPage />} />
        <Route path="points" element={<CustomerPointsPage />} />
        <Route path="redemptions" element={<CustomerRedemptionsPage />} />
        <Route path="payments" element={<CustomerPaymentsPage />} />
        <Route path="profile" element={<CustomerProfilePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<MarketingNotFoundPage />} />
    </Routes>
  );
}
