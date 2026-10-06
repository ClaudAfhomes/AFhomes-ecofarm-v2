import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@afhomes/ui';

import { useCustomerSession } from '../lib/customer-session';
import { getAuthPortals } from '../lib/portals';
import { portalDashboard } from '../lib/portal-destination';
import { PortalRedirect } from '../lib/PortalRedirect';

/**
 * OST route guard - UX ONLY.
 *
 * Only an approved OST record (`status === 'active'`) renders the OST
 * portal. Anything else returns to `/ost/login`, which explains pending and
 * missing records. The server is the boundary: `GET /ost/me` resolves the
 * member from the bearer token and refuses anyone else.
 */
export function OstGuard({ children }: { children: ReactNode }) {
  const { status } = useCustomerSession();
  const location = useLocation();
  const portals = useQuery({
    queryKey: ['ost', 'portals'],
    queryFn: getAuthPortals,
    enabled: status === 'authenticated',
    retry: false,
  });

  if (status === 'loading') return <Spinner label="Checking your session" />;
  if (status === 'unauthenticated') {
    return <Navigate to="/ost/login" replace state={{ from: location.pathname }} />;
  }
  if (portals.isLoading) return <Spinner label="Checking your OST record" />;
  if (portals.data?.ost?.status === 'active') return <>{children}</>;
  const destination = portals.data ? portalDashboard(portals.data) : null;
  if (destination && destination !== '/ost/login') return <PortalRedirect to={destination} />;
  return <Navigate to="/ost/login" replace state={{ from: location.pathname }} />;
}
