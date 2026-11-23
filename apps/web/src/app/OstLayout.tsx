import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, ErrorState, Icon, IconButton, Spinner, type IconName } from '@afhomes/ui';

import { useCustomerSession } from '../lib/customer-session';
import { OstGuard } from './OstGuard';
import { getAuthPortals } from '../lib/portals';
import { portalDashboard } from '../lib/portal-destination';
import { PortalRedirect } from '../lib/PortalRedirect';
import styles from './OstLayout.module.css';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/ost/dashboard', label: 'Dashboard', icon: 'home' },
  { to: '/ost/sales', label: 'Sales', icon: 'list' },
  { to: '/ost/commissions', label: 'Commissions', icon: 'wallet' },
  { to: '/ost/profile', label: 'Profile', icon: 'user' },
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
  const { pathname } = useLocation();
  // Phone layout: the sidebar is off-canvas until the menu button opens it.
  const [navOpen, setNavOpen] = useState(false);
  const pageTitle =
    NAV.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))?.label ??
    'OST Portal';
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
      <aside
        id="ost-sidebar"
        className={`${styles.sidebar} ${navOpen ? styles.open : ''}`}
        aria-label="OST portal navigation"
      >
        <div className={styles.sidebarBrand}>
          <img src="/logo.png" alt="AFhomes logo" className={styles.brandLogo} />
          <div className={styles.brandText}>
            <span className={styles.brandName}>AFhomes</span>
            <span className={styles.brandTag}>OST Portal</span>
          </div>
        </div>

        <div className={styles.account}>
          <span className={styles.accountLabel}>OST number</span>
          <span className={styles.ostNumber}>{ost.ostNumber}</span>
        </div>

        <nav className={styles.nav} aria-label="OST portal">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.signOutBtn} onClick={() => void signOut()}>
            <Icon name="logout" size={18} />
            <span>Log Out</span>
          </button>
        </div>
      </aside>
      {navOpen ? (
        <div className={styles.backdrop} aria-hidden="true" onClick={() => setNavOpen(false)} />
      ) : null}

      <main className={`${styles.main} afh-route`}>
        {restricted && (
          <div className={styles.restricted} role="alert">
            <strong>Your OST account is {ost.status}.</strong> Your dashboard, sales, commissions,
            and accreditation are not available while this is in effect. Contact your sponsoring
            Sales Manager to restore access.
          </div>
        )}

        <header className={styles.header}>
          <span className={styles.menuButton}>
            <IconButton
              icon={navOpen ? 'close' : 'menu'}
              label={navOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={navOpen}
              aria-controls="ost-sidebar"
              variant="ghost"
              onClick={() => setNavOpen((open) => !open)}
            />
          </span>
          <div>
            <p className={styles.eyebrow}>OST Portal · {ost.ostNumber}</p>
            <h1 className={styles.pageTitle}>{pageTitle}</h1>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
