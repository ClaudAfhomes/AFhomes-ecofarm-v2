import { NavLink, Outlet } from 'react-router';
import { Button, ErrorState, Spinner } from '@jad/ui';

import { useCustomerSession } from '../lib/customer-session';
import { CustomerGuard } from './CustomerGuard';
import { useCustomerProfileQuery } from '../features/customer/queries';
import { isForbidden, isUnauthorized } from '../features/customer/http';
import styles from './CustomerLayout.module.css';

const NAV = [
  { to: '/customer', label: 'Dashboard', end: true },
  { to: '/customer/membership', label: 'My card', end: false },
  { to: '/customer/points', label: 'Points', end: false },
  { to: '/customer/profile', label: 'Profile', end: false },
];

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
        <ErrorState
          title="Your session has expired"
          message="Please sign in again to continue."
        />
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
          title="This is not a customer account"
          message="You are signed in, but this sign-in is not linked to an AF Homes Ecofarm customer record. Staff accounts belong in the administration console."
        />
      </div>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <div className={styles.centered}>
        <ErrorState title="We could not load your account" message="Please try again in a moment." />
      </div>
    );
  }

  const customer = profile.data;
  const restricted = customer.status !== 'active';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AF Homes Ecofarm</p>
          <p className={styles.customerName}>{customer.fullName}</p>
          <p className={styles.customerNumber}>{customer.customerNumber}</p>
        </div>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>

      {restricted && (
        <div className={styles.restricted} role="alert">
          <strong>Your account is {customer.status}.</strong> Your card and points are not
          available while this is in effect. Contact AF Homes Ecofarm to restore access.
        </div>
      )}

      <nav className={styles.nav} aria-label="Customer portal">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
