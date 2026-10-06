import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { Spinner } from '@afhomes/ui';

export function PortalRedirect({ to }: { to: string }) {
  const external = to.startsWith('/admin');
  useEffect(() => {
    if (external) window.location.replace(to);
  }, [external, to]);
  return external ? (
    <Spinner label="Opening your authorized portal" />
  ) : (
    <Navigate to={to} replace />
  );
}
