import { preload } from 'react-dom';
import { authBrandImage } from '@afhomes/ui/brand-image';

/** Download the requested route while feature switches load; rendering stays gated. */
export function preloadInitialRoute(pathname: string) {
  const path = pathname.replace(/\/$/, '') || '/';
  // The same bundled image backs the default homepage hero and account login screens.
  if (path === '/' || ['/customer/login', '/ost/login', '/admin/login', '/staff/login'].includes(path)) {
    preload(authBrandImage, { as: 'image', fetchPriority: 'high' });
  }
  const routes: Record<string, () => Promise<unknown>[]> = {
    '/': () => [
      import('../marketing/MarketingLayout'),
      import('../features/customer/HomeLoginPage'),
    ],
    '/customer/login': () => [
      import('../features/customer/CustomerLoginPage'),
      import('../features/customer/CustomerLoginForm'),
    ],
    '/ost/login': () => [import('../features/ost/OstLoginPage')],
    '/admin/login': () => [import('../features/staff/StaffEntryPage')],
    '/staff/login': () => [import('../features/staff/StaffEntryPage')],
    '/customer': () => [
      import('./CustomerLayout'),
      import('../features/customer/CustomerDashboardPage'),
    ],
    '/ost/dashboard': () => [import('./OstLayout'), import('../features/ost/OstDashboardPage')],
  };
  // A speculative download failure must not block startup; the route retains its normal error path.
  return Promise.allSettled(routes[path]?.() ?? []);
}
