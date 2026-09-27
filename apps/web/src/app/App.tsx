import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';

import { NotFound } from '@jad/ui';

import { CustomerActivatePage } from '../features/customer/CustomerActivatePage';
import { CustomerDashboardPage } from '../features/customer/CustomerDashboardPage';
import { CustomerLoginPage } from '../features/customer/CustomerLoginPage';
import { CustomerMembershipPage } from '../features/customer/CustomerMembershipPage';
import { CustomerPointsPage } from '../features/customer/CustomerPointsPage';
import { CustomerProfilePage } from '../features/customer/CustomerProfilePage';
import { OstRegisterPage } from '../features/ost/OstRegisterPage';
import { LoadingState } from '../marketing/components/ui/Feedback';
import { MarketingLayout } from '../marketing/MarketingLayout';
import { CustomerLayout } from './CustomerLayout';

const HomePage = lazy(() => import('../marketing/pages/Home'));
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
 * Marketing pages live under the marketing layout (scoped styles, CMS-free
 * static content in Phase 3). The customer portal is untouched: `/customer`
 * screens stay guarded behind `CustomerLayout`, and the portal keeps its own
 * `*` fallback so an unknown portal path never renders marketing chrome.
 * Anything else falls through to the marketing 404.
 *
 * Route precedence note: static segments (`/customer/...`) always outrank
 * the root `*`, so public routes can never swallow `/customer/*` — and
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
      {/* Public OST registration. Outside the customer layout on purpose:
          the applicant has no account yet, so none of the portal guards apply. */}
      <Route path="/ost/register" element={<OstRegisterPage />} />

      <Route path="/customer" element={<CustomerLayout />}>
        <Route index element={<CustomerDashboardPage />} />
        <Route path="membership" element={<CustomerMembershipPage />} />
        <Route path="points" element={<CustomerPointsPage />} />
        <Route path="profile" element={<CustomerProfilePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<MarketingNotFoundPage />} />
    </Routes>
  );
}
