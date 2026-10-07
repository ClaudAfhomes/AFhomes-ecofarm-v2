import { useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AppShell, Breadcrumbs, ConfirmDialog, UserMenu } from '@afhomes/ui';
import { useSession } from '../lib/session';
import { logoutUrlForRole } from '../lib/portal';
import { breadcrumbItems, navItemsForPermissions } from './navigation';
import styles from './AdminLayout.module.css';
import { staffPortalPath, operationsPath } from '@afhomes/contracts';

export function AdminLayout() {
  const { user, logout } = useSession();
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
  // AF Homes pattern: while the temporary password is still in force the normal
  // navigation stays hidden (RequireRole parks the session on My Account).
  const gated = user?.mustChangePassword === true;
  return (
    <>
      <AppShell
        brand={
          <div className={styles.brandBlock}>
            <div className={styles.brandTextBlock}>
              <span className={styles.brandName}>AF Homes</span>
              <span className={styles.brandText}>Ecofarm Operations</span>
            </div>
          </div>
        }
        navItems={
          gated
            ? []
            : navItemsForPermissions(user?.afHomesPermissions, user?.roleSlug).map((item) => ({
                ...item,
                to: staffPortalPath(user?.roleSlug, item.to),
                dropdown: item.dropdown?.map((child) =>
                  'to' in child
                    ? { ...child, to: staffPortalPath(user?.roleSlug, child.to) }
                    : child,
                ),
              }))
        }
        navLabel="AF Homes administration"
        menuLabel="Open navigation"
        menuPosition="right"
        topbarActions={
          <UserMenu
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
        topbarLeading={
          <div className={styles.topbarBrand} aria-hidden="true">
            <span className={styles.topbarWordmark}>{crumbs?.at(-1)?.label ?? 'AF Homes'}</span>
          </div>
        }
      >
        <div className={styles.content}>
          {crumbs ? <Breadcrumbs items={crumbs} /> : null}
          <Outlet />
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
        message="Sign out of AF Homes administration?"
        confirmLabel="Sign out"
        cancelLabel="Cancel"
      />
    </>
  );
}
