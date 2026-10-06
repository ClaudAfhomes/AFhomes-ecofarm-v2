import type { ReactNode } from 'react';
import { Button, Forbidden, Skeleton, Spinner } from '@afhomes/ui';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../lib/session';
import { entryPortal, loginPathFor } from '../lib/portal';
import { canAccessNavTarget } from './navigation';
import styles from './RequireRole.module.css';
import { operationsPath, staffPortalPath } from '@afhomes/contracts';

function Loading() {
  return (
    <div className={styles.loading} role="status">
      <Spinner />
      <Skeleton />
      <Skeleton />
    </div>
  );
}

export function RequireRole({ children }: { children: ReactNode }) {
  const { status, user, sessionError, revalidate } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status !== 'authenticated') {
    // Return to the entry the user came through, so a staff session that
    // expired mid-shift lands on the Staff Login, not the admin entry.
    return (
      <Navigate to={loginPathFor(entryPortal())} replace state={{ from: location.pathname }} />
    );
  }
  // JAD parity: a session still on its temporary password can only visit
  // My Account until the forced change completes (the server 403s every
  // module-guarded endpoint in the meantime).
  if (user?.mustChangePassword === true && operationsPath(location.pathname) !== '/admin/profile') {
    return <Navigate to={staffPortalPath(user?.roleSlug, '/admin/profile')} replace />;
  }
  if (
    user?.mustChangePassword !== true &&
    user?.mfaRequired &&
    operationsPath(location.pathname) !== '/admin/mfa'
  )
    return <Navigate to="/admin/mfa" replace />;
  if (
    operationsPath(location.pathname) === '/admin/mfa' &&
    !['admin', 'super_admin'].includes(user?.roleSlug ?? '')
  )
    return <Forbidden />;
  if (
    operationsPath(location.pathname) === '/admin/mfa' &&
    ['admin', 'super_admin'].includes(user?.roleSlug ?? '')
  )
    return <>{children}</>;
  if (!canAccessNavTarget(user?.afHomesPermissions, operationsPath(location.pathname)))
    return (
      <Forbidden
        action={sessionError ? <Button onClick={() => void revalidate()}>Retry</Button> : undefined}
      />
    );
  return <>{children}</>;
}
