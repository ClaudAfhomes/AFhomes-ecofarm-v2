import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { useSession } from '../../../lib/session';
import { EmptyState, Skeleton, Spinner } from '@jad/ui';
import { useQualification } from '../hooks/useMember';

import styles from './RequireQualifiedMember.module.css';

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
 * Sales route guard (BR-SAL qualification, FR-SAL-002): only Active + Qualified
 * members may submit or view sales. The decision reads the SERVER-authoritative
 * qualification summary (not the session snapshot captured at login), so an
 * admin grant/revoke or registration approval takes effect immediately without
 * a re-login. On a transient API failure the guard falls back to the session
 * flag so a blip never hard-blocks sales.
 */
export function RequireQualifiedMember({ children }: { children: ReactNode }) {
  const { status, isQualified: sessionQualified } = useSession();
  const { data: qualification, isPending } = useQualification();

  if (status === 'loading') return <LoadingState />;
  // Loading the first qualification summary (authenticated) - hold on a
  // skeleton rather than flashing "not qualified" to an approved member.
  if (status === 'authenticated' && isPending && !qualification) return <LoadingState />;
  const qualified = qualification !== undefined ? qualification.isQualified : sessionQualified;

  if (!qualified) {
    return (
      <EmptyState
        title="Sales require an Active + Qualified membership"
        description="Submit and track qualifying sales once you have satisfied the qualification requirements."
        action={
          <Link className={styles.link} to="/member/qualification?highlight=unmet">
            View qualification status
          </Link>
        }
      />
    );
  }
  return <>{children}</>;
}
