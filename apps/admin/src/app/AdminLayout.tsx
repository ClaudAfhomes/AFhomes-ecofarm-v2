import { useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AppShell, Breadcrumbs, ConfirmDialog, UserMenu } from '@jad/ui';
import { useSession } from '../lib/session';
import { breadcrumbItems, navItemsForPermissions } from './navigation';
import styles from './AdminLayout.module.css';

export function AdminLayout() {
  const { user, logout } = useSession();
  const location = useLocation();
  const [confirm, setConfirm] = useState(false);
  const crumbs = useMemo(() => breadcrumbItems(location.pathname), [location.pathname]);
  return (
    <>
      <AppShell
        brand={
          <div className={styles.brandBlock}>
            <div className={styles.brandTextBlock}>
              <span className={styles.brandName}>AF Homes</span>
              <span className={styles.brandText}>Ecofarm Administration</span>
            </div>
          </div>
        }
        navItems={navItemsForPermissions(user?.afHomesPermissions)}
        navLabel="AF Homes administration"
        menuLabel="Open navigation"
        menuPosition="right"
        topbarActions={
          <UserMenu
            name={user?.name}
            role={user?.roleName}
            items={[
              { label: 'Logout', icon: 'logout', danger: true, onClick: () => setConfirm(true) },
            ]}
          />
        }
        topbarLeading={
          <div className={styles.topbarBrand} aria-hidden="true">
            <span className={styles.topbarWordmark}>AF Homes</span>
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
          setConfirm(false);
          logout();
        }}
        title="Sign out?"
        message="Sign out of AF Homes administration?"
        confirmLabel="Sign out"
        cancelLabel="Cancel"
      />
    </>
  );
}
