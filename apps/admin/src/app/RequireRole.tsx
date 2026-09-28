import type { ReactNode } from 'react';
import { Button, Forbidden, Skeleton, Spinner } from '@jad/ui';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../lib/session';
import { canAccessNavTarget } from './navigation';
import styles from './RequireRole.module.css';

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
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  if (!canAccessNavTarget(user?.afHomesPermissions, location.pathname))
    return (
      <Forbidden
        action={sessionError ? <Button onClick={() => void revalidate()}>Retry</Button> : undefined}
      />
    );
  return <>{children}</>;
}
