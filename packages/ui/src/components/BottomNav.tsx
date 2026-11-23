import { NavLink } from 'react-router';

import { Icon, type IconName } from './Icon';
import styles from './BottomNav.module.css';

export interface BottomNavItem {
  to: string;
  label: string;
  icon?: IconName;
  end?: boolean;
}

export interface BottomNavProps {
  items: BottomNavItem[];
  /** "More" affordance opening the full navigation drawer. */
  moreItem?: {
    label: string;
    onClick: () => void;
    /** True when the current page is reached through More. */ active?: boolean;
  };
  label?: string;
}

/**
 * Mobile bottom navigation (Member app, UI-UX §4.6): the 5 most frequent
 * destinations plus a "More" drawer affordance. Visible below the `sm`
 * breakpoint; hidden on tablet/desktop (drawer takes over).
 */
export function BottomNav({ items, moreItem, label = 'Primary' }: BottomNavProps) {
  return (
    <nav className={styles.bottomNav} aria-label={label}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.to} className={styles.item}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
            >
              {item.icon ? (
                <span aria-hidden="true">
                  <Icon name={item.icon} size={20} />
                </span>
              ) : null}
              <span className={styles.label}>{item.label}</span>
            </NavLink>
          </li>
        ))}
        {moreItem ? (
          <li className={styles.item}>
            <button
              type="button"
              className={`${styles.link} ${moreItem.active ? styles.active : ''}`}
              data-active={moreItem.active ? 'true' : undefined}
              onClick={moreItem.onClick}
              aria-haspopup="dialog"
            >
              <span aria-hidden="true">
                <Icon name="menu" size={20} />
              </span>
              <span className={styles.label}>{moreItem.label}</span>
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
