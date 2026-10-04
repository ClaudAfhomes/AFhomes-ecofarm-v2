import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Spinner } from '@jad/ui';
import { useQuery } from '@tanstack/react-query';
import { getAuthPortals } from '../lib/portals';
import { portalDashboard } from '../lib/portal-destination';
import { PortalRedirect } from '../lib/PortalRedirect';

import { useCustomerSession } from '../lib/customer-session';
import styles from './CustomerGuard.module.css';

/**
 * Customer route guard - UX ONLY.
 *
 * This decides which screen to paint. It is emphatically NOT the security
 * boundary: every customer endpoint resolves the principal from
 * `customers.auth_user_id` on the server and RLS re-checks ownership, so a
 * caller who bypasses this component gets 401/403, never data.
 *
 * The server identity is resolved before painting protected customer content.
 * Wrong-portal entries replace history with the authorized dashboard.
 */
export function CustomerGuard({ children }: { children: ReactNode }) {
  const { status, user } = useCustomerSession();
  const identity = useQuery({
    queryKey: ['auth-portals', user?.authUserId],
    queryFn: getAuthPortals,
    enabled: status === 'authenticated',
    retry: false,
    staleTime: 0,
  });
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className={styles.centered} role="status" aria-live="polite">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    // `state.from` lets the sign-in screen return the member to where they were.
    return <Navigate to="/customer/login" replace state={{ from: location.pathname }} />;
  }

  if (identity.isPending) return <Spinner label="Checking your account" />;
  if (identity.isError)
    return <p role="alert">Could not verify your account. Please reload to retry.</p>;
  const destination = identity.data ? portalDashboard(identity.data, 'customer') : null;
  if (destination && destination !== '/customer') return <PortalRedirect to={destination} />;
  if (!identity.data?.customer)
    return <p role="alert">No customer access is assigned to this account.</p>;
  return <>{children}</>;
}
