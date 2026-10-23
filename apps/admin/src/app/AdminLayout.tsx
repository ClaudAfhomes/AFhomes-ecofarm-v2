import { Suspense, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AppShell, Breadcrumbs, ConfirmDialog, Icon, Skeleton, UserMenu } from '@afhomes/ui';
import { useSession } from '../lib/session';
import { logoutUrlForRole } from '../lib/portal';
import {
  breadcrumbItems,
  canAccessNavTarget,
  navItemsForPermissions,
  istNavItemsForPermissions,
} from './navigation';
import { AdminForbiddenPage } from './AdminForbiddenPage';
import styles from './AdminLayout.module.css';
import { staffPortalPath, operationsPath, isIstRole } from '@afhomes/contracts';
import { useProfilePhoto } from '../features/account/profile-photo';
import logo from '../assets/logo.png';

export function AdminLayout() {
  const photo = useProfilePhoto();
  const { user, logout, sessionError, revalidate } = useSession();
  const location = useLocation();
  const [confirm, setConfirm] = useState(false);
  const crumbs = useMemo(
    () =>
      breadcrumbItems(operationsPath(location.pathname))?.map((item) => ({
        ...item,
        ...(item.to ? { to: staffPortalPath(user?.roleSlug, item.to) } : {}),
      })),
    [location.pathname, user?.roleSlug],
  );
  // AFHomes pattern: while the temporary password is still in force the normal
  // navigation stays hidden (RequireRole parks the session on My Account).
  const gated = user?.mustChangePassword === true;
  const ist = isIstRole(user?.roleSlug);
  const navigation = ist ? istNavItemsForPermissions : navItemsForPermissions;
  const portalTarget = (target: string) => {
    const path = staffPortalPath(user?.roleSlug, target);
    if (!ist || (target !== '/admin' && !target.startsWith('/admin/ist/'))) return path;
    const params = new URLSearchParams(location.search);
    params.delete('page');
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  };
  // Denied paths render standalone: no sidebar, no topbar, professional card.
  // RequireRole still guards the route; this only removes the shell chrome.
  const denied =
    user &&
    !gated &&
    !canAccessNavTarget(user?.afHomesPermissions, operationsPath(location.pathname));
  if (denied) {
    return <AdminForbiddenPage retry={sessionError ? () => void revalidate() : undefined} />;
  }
  return (
    <>
      <AppShell
        brand={
          <div className={styles.brandBlock}>
            <img src={logo} alt="AFHomes logo" />
            <div className={styles.brandTextBlock}>
              <span className={styles.brandName}>AFHomes</span>
              <span className={styles.brandText}>{ist ? 'IST Portal' : 'Operations'}</span>
            </div>
          </div>
        }
        navItems={
          gated
            ? []
            : navigation(user?.afHomesPermissions).map((item) => ({
                ...item,
                to: portalTarget(item.to),
                dropdown: item.dropdown?.map((child) =>
                  'to' in child
                    ? { ...child, to: portalTarget(child.to) }
                    : child,
                ),
              }))
        }
        navLabel="AFHomes administration"
        menuLabel="Open navigation"
        menuPosition="right"
        sidebarFooter={
          <button
            type="button"
            className={styles.logoutButton}
            title="Log Out"
            aria-label="Log Out"
            onClick={() => setConfirm(true)}
          >
            <span className={styles.logoutIcon} aria-hidden="true">
              <Icon name="logout" size={18} />
            </span>
            <span className="sidebar-footer-label" aria-hidden="true">
              Log Out
            </span>
          </button>
        }
        topbarActions={
          <UserMenu
            photoUrl={photo.photo.data?.url}
            name={user?.name}
            role={user?.roleName}
            items={[
              {
                label: 'My Account',
                icon: 'user',
                to: staffPortalPath(user?.roleSlug, '/admin/profile'),
              },
              { label: '-', icon: 'user' },
              { label: 'Logout', icon: 'logout', danger: true, onClick: () => setConfirm(true) },
            ]}
          />
        }
      >
        <div className={styles.content}>
          {crumbs ? <Breadcrumbs items={crumbs} /> : null}
          {/* Route pages load on demand: the shell stays mounted while the
          page chunk loads, so navigation never blanks. */}
          <Suspense
            fallback={
              <div role="status" aria-label="Loading page">
                <Skeleton />
                <Skeleton />
                <Skeleton />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </AppShell>
      <ConfirmDialog
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          // Sign-out leaves the staff console for the web-hosted entries
          // (`:5173/...` locally, same origin in production). The sign-out is
          // awaited first so no usable session survives the unload - otherwise
          // the entry would bounce straight back into the console.
          const target = logoutUrlForRole(user?.roleSlug);
          setConfirm(false);
          void logout().finally(() => window.location.replace(target));
        }}
        title="Sign out?"
        message="Sign out of AFHomes administration?"
        confirmLabel="Sign out"
        cancelLabel="Cancel"
      />
    </>
  );
}
