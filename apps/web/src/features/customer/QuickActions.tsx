import { Link } from 'react-router';
import { isFeaturePathEnabled } from '@afhomes/shared';
import { Icon, type IconName } from '@afhomes/ui';

import { ui } from './portal-ui';
import styles from './dashboard.module.css';

interface QuickAction {
  to: string;
  label: string;
  icon: IconName;
  /** Needs an active membership to be useful. */
  needsMembership: boolean;
}

const ACTIONS: QuickAction[] = [
  { to: '/customer/membership', label: 'My Card', icon: 'card', needsMembership: true },
  { to: '/customer/points', label: 'Points', icon: 'star', needsMembership: true },
  { to: '/customer/payments', label: 'Payments', icon: 'receipt', needsMembership: false },
  { to: '/customer/bookings', label: 'Bookings', icon: 'calendar', needsMembership: true },
  { to: '/customer/messages', label: 'Messages', icon: 'message', needsMembership: false },
  { to: '/customer/redemptions', label: 'Redemptions', icon: 'list', needsMembership: true },
  { to: '/customer/profile', label: 'Profile', icon: 'user', needsMembership: false },
];

/**
 * Shortcuts to the customer routes that are currently enabled. Visibility uses
 * the same `isFeaturePathEnabled` switch as the shell navigation; it is UX only,
 * the server still authorizes every request.
 */
export function QuickActions({ hasMembership }: { hasMembership: boolean }) {
  const items = ACTIONS.filter(
    (item) => (hasMembership || !item.needsMembership) && isFeaturePathEnabled(item.to),
  );
  if (items.length === 0) return null;
  return (
    <nav aria-label="Quick actions">
      <ul className={styles.actions}>
        {items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className={`${ui.surface} ${ui.surfaceLink} ${styles.action}`}>
              <span className={styles.actionIcon} aria-hidden="true">
                <Icon name={item.icon} size={18} />
              </span>
              <span className={styles.actionLabel}>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
