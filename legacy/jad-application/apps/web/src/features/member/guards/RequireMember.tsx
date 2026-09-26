import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { normalizeRole } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { Forbidden, Skeleton, Spinner } from '@jad/ui';

import styles from './RequireMember.module.css';

function LoadingState() {
  return (
    <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
      <Spinner className={styles.loadingSpinner} />
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}

/**
 * Member route guard. Unauthenticated visitors are redirected to the login
 * preview with their destination preserved; authenticated non-members see
 * Forbidden. The real backend enforces authorization - visibility is never
 * authorization (FRONTEND-ARCHITECTURE).
 */
export function RequireMember({ children }: { children: ReactNode }) {
  const { status, role } = useSession();
  const location = useLocation();

  if (status === 'loading') return <LoadingState />;
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  const normalized = role ? normalizeRole(role) : null;
  if (normalized !== 'user') {
    if (normalized === 'admin') return <Navigate to="/admin" replace />;
    return <Forbidden />;
  }
  return <>{children}</>;
}
