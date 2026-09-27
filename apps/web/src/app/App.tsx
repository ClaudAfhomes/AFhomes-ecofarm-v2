import { Route, Routes } from 'react-router';

import { NotFound } from '@jad/ui';

import { CustomerActivatePage } from '../features/customer/CustomerActivatePage';
import { CustomerDashboardPage } from '../features/customer/CustomerDashboardPage';
import { CustomerLoginPage } from '../features/customer/CustomerLoginPage';
import { CustomerMembershipPage } from '../features/customer/CustomerMembershipPage';
import { CustomerPointsPage } from '../features/customer/CustomerPointsPage';
import { CustomerProfilePage } from '../features/customer/CustomerProfilePage';
import { CustomerLayout } from './CustomerLayout';
import { PublicHome } from './PublicHome';

/**
 * Public site routes.
 *
 * `/` remains the minimal public landing placeholder: this phase delivers the
 * customer portal, not a marketing site.
 *
 * Every route below `/customer` is a real screen backed by a real endpoint.
 * There are no placeholder routes: `/customer`, `/customer/profile`,
 * `/customer/membership` and `/customer/points` all render, and the two
 * unauthenticated entry screens (`login`, `activate`) are what the guard sends
 * an anonymous visitor to.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicHome />} />

      <Route path="/customer/login" element={<CustomerLoginPage />} />
      <Route path="/customer/activate" element={<CustomerActivatePage />} />

      <Route path="/customer" element={<CustomerLayout />}>
        <Route index element={<CustomerDashboardPage />} />
        <Route path="membership" element={<CustomerMembershipPage />} />
        <Route path="points" element={<CustomerPointsPage />} />
        <Route path="profile" element={<CustomerProfilePage />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
