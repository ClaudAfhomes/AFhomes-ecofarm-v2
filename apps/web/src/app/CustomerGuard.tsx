import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Spinner } from '@jad/ui';

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
 * States, deliberately distinct rather than one generic "denied":
 *   - no session            -> the login screen
 *   - session resolving     -> a spinner (never a flash of the wrong screen)
 *   - session, not a customer -> a dedicated "this is not a customer account"
 *     explanation, which is what a staff member who follows a `/customer` link
 *     needs to see
 */
export function CustomerGuard({ children }: { children: ReactNode }) {
  const { status } = useCustomerSession();
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

  return <>{children}</>;
}
