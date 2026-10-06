import { Suspense, lazy } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AuthLayout, Button } from '@jad/ui';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import { portalDashboard } from '../../lib/portal-destination';
import { PortalRedirect } from '../../lib/PortalRedirect';
import formStyles from './auth.module.css';
import styles from './CustomerLoginScreen.module.css';

const CustomerLoginForm = lazy(() =>
  import('./CustomerLoginForm').then((module) => ({ default: module.CustomerLoginForm })),
);

/**
 * Standalone member sign-in (`/customer/login`).
 *
 * Same `AuthLayout` shell as the staff and admin entries: brand panel beside
 * a floating form card on desktop, slim masthead + centered card on mobile.
 * The form itself stays route-split so portal API code only downloads for
 * visitors who sign in. Sessions created here are ordinary customer
 * sessions; post-login routing lives in the shared form, and an
 * already-authenticated visit resolves to its dashboard instead of a second
 * form. Auth screens are never indexable (enforced by `AuthLayout`).
 */
export function CustomerLoginScreen() {
  const { status, signOut } = useCustomerSession();

  return (
    <AuthLayout
      eyebrow="Member Login"
      title="Sign in to your card"
      brandTitle="Amazing & Fun. Your Home Away From Home."
      brandLead="Hospitality, wellness, dining, nature and experiences in Laguna, Philippines."
    >
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link className={styles.crumbLink} to="/">
          Home
        </Link>
        <span className={styles.crumbSeparator} aria-hidden="true">
          &gt;
        </span>
        <span className={styles.crumbCurrent} aria-current="page">
          Customer Login
        </span>
      </nav>
      {status === 'authenticated' ? (
        <SignedInPanel onSignOut={() => void signOut()} />
      ) : (
        <Suspense
          fallback={
            <p role="status" className={formStyles.prompt}>
              Loading sign in…
            </p>
          }
        >
          <CustomerLoginForm />
        </Suspense>
      )}
    </AuthLayout>
  );
}

function SignedInPanel({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useCustomerSession();
  const identity = useQuery({
    queryKey: ['auth-portals', user?.authUserId],
    queryFn: getAuthPortals,
    retry: false,
    staleTime: 0,
  });
  const to = identity.data ? portalDashboard(identity.data) : null;
  if (to) return <PortalRedirect to={to} />;
  return (
    <div>
      <p className={formStyles.prompt} role="status">
        {identity.isError
          ? 'Could not verify your account. Reload to retry.'
          : 'Checking your account…'}
      </p>
      <p className={formStyles.prompt}>
        <Button variant="ghost" type="button" onClick={onSignOut}>
          Sign out
        </Button>
      </p>
    </div>
  );
}
