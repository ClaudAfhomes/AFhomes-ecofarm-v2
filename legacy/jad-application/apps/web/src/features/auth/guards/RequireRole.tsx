import { Navigate, useLocation } from 'react-router';
import { Skeleton } from '@jad/ui';
import { normalizeRole } from '@jad/contracts';

import { useSession } from '../../../lib/session';

export function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { status, role } = useSession();
  const location = useLocation();

  if (status === 'loading') return <Skeleton />;

  if (status === 'unauthenticated' || !role) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const normalized = normalizeRole(role);
  const allowed = roles.map((r) => normalizeRole(r));
  if (!allowed.includes(normalized)) {
    // Cross-role: redirect to their own dashboard, not flash protected content
    if (normalized === 'admin') return <Navigate to="/admin" replace />;
    if (normalized === 'user') return <Navigate to="/user" replace />;
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
