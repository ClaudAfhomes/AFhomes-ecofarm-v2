import { useEffect, type ReactNode } from 'react';
import { Button, Forbidden, Skeleton, Spinner } from '@jad/ui';
import { useLocation } from 'react-router';
import { useSession } from '../lib/session';
import { canViewModule, findNavItem, findNavSubItem } from './navigation';
import styles from './RequireRole.module.css';

export function getValidatedWebLoginUrl() {
  const raw =
    (import.meta.env as Record<string, string | undefined>).VITE_WEB_URL ?? 'http://localhost:5173';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    const base = url.toString().replace(/\/$/, '');
    return base.endsWith('/login') ? base : `${base}/login`;
  } catch {
    return 'http://localhost:5173/login';
  }
}
function Loading() {
  return (
    <div className={styles.loading} role="status">
      <Spinner />
      <Skeleton />
      <Skeleton />
    </div>
  );
}
function Redirect() {
  useEffect(() => {
    window.location.href = getValidatedWebLoginUrl();
  }, []);
  return <Loading />;
}

export function RequireRole({ children }: { children: ReactNode }) {
  const { status, user, sessionError, revalidate } = useSession();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status !== 'authenticated') return <Redirect />;
  const sub = findNavSubItem(location.pathname);
  const item = findNavItem(location.pathname);
  const key = sub?.sub.module ?? item?.module;
  if (key && !canViewModule(user?.afHomesPermissions, key))
    return (
      <Forbidden
        action={sessionError ? <Button onClick={() => void revalidate()}>Retry</Button> : undefined}
      />
    );
  return <>{children}</>;
}
