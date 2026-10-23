import { NavLink, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, ErrorState, Spinner } from '@afhomes/ui';

import { useCustomerSession } from '../lib/customer-session';
import { OstGuard } from './OstGuard';
import { getAuthPortals } from '../lib/portals';
import { portalDashboard } from '../lib/portal-destination';
import { PortalRedirect } from '../lib/PortalRedirect';
import styles from './OstLayout.module.css';

const NAV = [
  { to: '/ost/dashboard', label: 'Dashboard' },
  { to: '/ost/sales', label: 'Sales' },
  { to: '/ost/commissions', label: 'Commissions' },
  { to: '/ost/accreditation', label: 'Accreditation' },
  { to: '/ost/profile', label: 'Profile' },
];

/**
 * The OST portal shell with left sidebar navigation.
 *
 * Resolves the OST member's portals and enforces self-only access.
 * The server is the boundary: GET /ost/me resolves from bearer token.
 */
export function OstLayout() {
  return (
    <OstGuard>
      <OstShell />
    </OstGuard>
  );
}

function OstShell() {
  const { signOut } = useCustomerSession();
  const portals = useQuery({
    queryKey: ['ost', 'portals'],
    queryFn: getAuthPortals,
    retry: false,
  });

  if (portals.isLoading) {
    return (
      <div className={styles.centered} role="status" aria-live="polite">
        <Spinner label="Loading your OST portal" />
      </div>
    );
  }

  if (portals.isError || !portals.data?.ost) {
    return (
      <div className={styles.centered}>
        <ErrorState
          title="OST portal unavailable"
          message="We could not load your OST record. Please sign out and sign in again."
        />
        <div className={styles.centeredActions}>
          <Button onClick={() => void signOut()} variant="secondary">
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const ost = portals.data.ost;
  const restricted = ost.status !== 'active';

  if (portals.data.staff?.mustChangePassword) {
    const destination = portalDashboard(portals.data);
    if (destination) return <PortalRedirect to={destination} />;
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="OST portal navigation">
        <div className={styles.sidebarBrand}>
          <p className={styles.eyebrow}>AFHomes Ecofarm</p>
          <p className={styles.ostNumber}>{ost.ostNumber}</p>
        </div>

        <nav className={styles.nav} aria-label="OST portal">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <Button variant="secondary" className={styles.signOutBtn} onClick={() => void signOut()}>
            Log Out
          </Button>
        </div>
      </aside>

      <main className={styles.main}>
        {restricted && (
          <div className={styles.restricted} role="alert">
            <strong>Your OST account is {ost.status}.</strong> Your dashboard, sales, commissions, and
            accreditation are not available while this is in effect. Contact your sponsoring Sales
            Manager to restore access.
          </div>
        )}

        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>AFHomes Ecofarm</p>
            <h1 className={styles.pageTitle}>{ost.ostNumber}</h1>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}