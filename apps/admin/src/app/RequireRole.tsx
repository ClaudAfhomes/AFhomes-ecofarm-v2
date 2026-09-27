import { useEffect, type ReactNode } from 'react';
import { Button, Forbidden, Skeleton, Spinner } from '@jad/ui';
import { useLocation } from 'react-router';
import { useSession } from '../lib/session';
import { canViewModule, findNavItem, findNavSubItem } from './navigation';
import styles from './RequireRole.module.css';

/**
 * The absolute URL of the shared sign-in page, or `null` when it cannot be known.
 *
 * Why `null` is possible in a production build: `VITE_WEB_URL` is what tells the
 * admin app where the public origin actually is. When it is missing, the old
 * behaviour was to fall back to `http://localhost:5173/login`. In development
 * that is exactly right. In production it is a silent dead end - the browser
 * navigates to a host that does not exist and the user is left staring at a
 * spinner with no error, which is indistinguishable from a broken app.
 *
 * So the localhost default is development-only. In a production build a missing
 * or malformed `VITE_WEB_URL` is reported as a configuration error instead of
 * being papered over. A client route guard is UX only, so this is presentation
 * - the server remains the security boundary either way.
 */
export function getValidatedWebLoginUrl(): string | null {
  const configured = (import.meta.env as Record<string, string | undefined>).VITE_WEB_URL;
  if (!configured?.trim()) {
    return import.meta.env.DEV ? 'http://localhost:5173/login' : null;
  }
  try {
    const url = new URL(configured.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    const base = url.toString().replace(/\/$/, '');
    return base.endsWith('/login') ? base : `${base}/login`;
  } catch {
    return import.meta.env.DEV ? 'http://localhost:5173/login' : null;
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

/** Shown instead of navigating when the sign-in origin is not configured. */
function Misconfigured() {
  return (
    <div className={styles.loading} role="alert">
      <h1>Admin sign-in is not configured</h1>
      <p>
        <code>VITE_WEB_URL</code> is not set, so this app does not know where the sign-in page
        lives. Set it to the public site origin (for example{' '}
        <code>https://your-domain.example</code>) in the Vercel project environment and redeploy.
      </p>
    </div>
  );
}
function Redirect() {
  const target = getValidatedWebLoginUrl();
  useEffect(() => {
    if (target) window.location.href = target;
  }, [target]);
  if (!target) return <Misconfigured />;
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
