import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { isFeaturePathEnabled } from '@afhomes/shared';
import {
  BottomNav,
  Button,
  Dialog,
  ErrorState,
  Icon,
  IconButton,
  Spinner,
  type IconName,
} from '@afhomes/ui';

import { useCustomerSession } from '../lib/customer-session';
import { CustomerGuard } from './CustomerGuard';
import { useCustomerProfileQuery } from '../features/customer/queries';
import { isForbidden, isUnauthorized } from '../features/customer/http';
import { useNotificationsQuery } from '../features/customer/engagement';
import styles from './CustomerLayout.module.css';

/** Header bell: unread count from the server, refreshed every 30s. */
function NotificationBell() {
  const unread = useNotificationsQuery().data?.meta.unreadCount ?? 0;
  return (
    <Link
      to="/customer/notifications"
      className={styles.iconAction}
      title="Notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Icon name="bell" size={20} />
      {unread > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {unread}
        </span>
      )}
    </Link>
  );
}

const NAV_ITEMS = [
  { to: '/customer', label: 'Dashboard', icon: 'home' as IconName, end: true },
  { to: '/customer/membership', label: 'My card', icon: 'card' as IconName, end: false },
  { to: '/customer/points', label: 'Points', icon: 'star' as IconName, end: false },
  { to: '/customer/redemptions', label: 'Redemptions', icon: 'list' as IconName, end: false },
  { to: '/customer/payments', label: 'Payments', icon: 'receipt' as IconName, end: false },
  { to: '/customer/bookings', label: 'Bookings', icon: 'calendar' as IconName, end: false },
  { to: '/customer/messages', label: 'Messages', icon: 'message' as IconName, end: false },
  { to: '/customer/profile', label: 'Profile', icon: 'user' as IconName, end: false },
];
/** Read at render: module switches load at startup and may change. */
const navItems = () => NAV_ITEMS.filter((item) => isFeaturePathEnabled(item.to));

/** Mobile bottom bar: the five everyday destinations; everything else lives under "More". */
const BOTTOM_ITEMS = [
  { to: '/customer', label: 'Home', icon: 'home' as IconName, end: true },
  { to: '/customer/membership', label: 'My card', icon: 'card' as IconName },
  { to: '/customer/points', label: 'Points', icon: 'star' as IconName },
  { to: '/customer/payments', label: 'Payments', icon: 'receipt' as IconName },
  { to: '/customer/profile', label: 'Profile', icon: 'user' as IconName },
];
const bottomItems = () => BOTTOM_ITEMS.filter((item) => isFeaturePathEnabled(item.to));

/** Routes reachable only through "More" on mobile (never dropped, only moved). */
const MORE_ITEMS = [
  { to: '/customer/redemptions', label: 'Redemptions', icon: 'list' as IconName },
  { to: '/customer/bookings', label: 'Bookings', icon: 'calendar' as IconName },
  { to: '/customer/messages', label: 'Messages', icon: 'message' as IconName },
  { to: '/customer/notifications', label: 'Notifications', icon: 'bell' as IconName },
];
const moreItems = () => MORE_ITEMS.filter((item) => isFeaturePathEnabled(item.to));

/**
 * The customer portal shell.
 *
 * It resolves the customer's own profile exactly once, which is also the
 * ownership check: the server answers 403 when the signed-in Auth user is not
 * linked to a customer record, and 401 when there is no usable session. Those
 * two get deliberately different screens, because they mean different things to
 * the person looking at them - a staff member who followed a `/customer` link
 * should be told so, not shown a sign-in form.
 *
 * A suspended or cancelled customer keeps a working shell and can still read
 * their own profile, so the restriction is legible; the server refuses their
 * membership and points, and those screens render that refusal rather than
 * silently hiding anything.
 */
export function CustomerLayout() {
  return (
    <CustomerGuard>
      <CustomerShell />
    </CustomerGuard>
  );
}

function CustomerShell() {
  const { signOut } = useCustomerSession();
  const profile = useCustomerProfileQuery();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  if (profile.isLoading) {
    return (
      <div className={styles.centered} role="status" aria-live="polite">
        <Spinner label="Loading your account" />
      </div>
    );
  }

  if (isUnauthorized(profile.error)) {
    return (
      <div className={styles.centered}>
        <ErrorState title="Your session has expired" message="Please sign in again to continue." />
        <div className={styles.centeredActions}>
          <Button onClick={() => void signOut()} variant="secondary">
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (isForbidden(profile.error)) {
    return (
      <div className={styles.centered}>
        <ErrorState
          title="Customer access unavailable"
          message="Your customer access could not be verified. Please sign out and contact AFhomes if this continues."
        />
        <div className={styles.centeredActions}>
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <div className={styles.centered}>
        <ErrorState
          title="We could not load your account"
          message="Please try again in a moment."
        />
      </div>
    );
  }

  const customer = profile.data;
  const restricted = customer.status !== 'active';
  // Every page needs one h1. The dashboard draws its own; the other tabs get the tab name
  // as a screen-reader heading so the page is not heading-less.
  const tab = navItems().find((item) => !item.end && pathname.startsWith(item.to));

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <img src="/logo.png" alt="AFhomes logo" className={styles.brandLogo} />
            <div className={styles.identity}>
              <p className={styles.eyebrow}>AFhomes Ecofarm</p>
              <p className={styles.customerName}>{customer.fullName}</p>
              <p className={styles.customerNumber}>{customer.customerNumber}</p>
            </div>
          </div>
          <div className={styles.actions}>
            <NotificationBell />
            <IconButton
              icon="logout"
              label="Sign out"
              variant="ghost"
              className={styles.iconAction}
              onClick={() => void signOut()}
            />
          </div>
        </div>
      </header>

      {restricted && (
        <div className={styles.restricted} role="alert">
          <strong>
            {customer.status === 'prospect'
              ? 'Your account is not active yet.'
              : `Your account is ${customer.status}.`}
          </strong>{' '}
          Your card and points are not available while this is in effect. Contact AFhomes Ecofarm to
          restore access.
        </div>
      )}

      <nav className={styles.nav} aria-label="Customer portal">
        {navItems().map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
          >
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className={styles.mobileNav}>
        <BottomNav
          label="Customer portal mobile"
          items={bottomItems()}
          moreItem={{ label: 'More', onClick: () => setMoreOpen(true) }}
        />
      </div>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More" closeLabel="Close">
        <nav aria-label="More destinations">
          <ul className={styles.sheetList}>
            {moreItems().map((item) => (
              <li key={item.to}>
                <Link to={item.to} className={styles.sheetLink} onClick={() => setMoreOpen(false)}>
                  <Icon name={item.icon} size={20} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <hr className={styles.sheetDivider} />
        <button
          type="button"
          className={styles.sheetLink}
          onClick={() => {
            setMoreOpen(false);
            void signOut();
          }}
        >
          <Icon name="logout" size={20} />
          <span>Sign out</span>
        </button>
      </Dialog>

      <main className={`${styles.main} afh-route`}>
        {tab ? <h1 className="sr-only">{tab.label}</h1> : null}
        <Outlet />
      </main>
    </div>
  );
}
