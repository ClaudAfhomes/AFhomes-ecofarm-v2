import { ButtonLink } from '../components/ButtonLink';
import { PublicNavLink } from '../components/PublicNavLink';

import type { NavItem } from '../features/public/content/types';
import styles from './MobileNavigation.module.css';

export interface MobileNavigationProps {
  items: NavItem[];
  authItems?: NavItem[];
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.link} ${styles.active}` : styles.link;

/**
 * Public primary navigation. One `<nav id="primary-nav">` serves every
 * viewport: inline on desktop (≥1024px), and a fixed, scrollable slide-down
 * panel below that (with a backdrop, Escape/outside-click close, body scroll
 * lock in `Header`). Labels never force horizontal page overflow.
 */
export function MobileNavigation({
  items,
  authItems,
  open,
  onToggle,
  onNavigate,
}: MobileNavigationProps) {
  return (
    <>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls="primary-nav"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        onClick={onToggle}
      >
        <span
          className={`${styles.toggleIcon} ${open ? styles.toggleIconOpen : ''}`}
          aria-hidden="true"
        />
      </button>

      {open ? <div className={styles.backdrop} aria-hidden="true" onClick={onToggle} /> : null}

      <nav
        id="primary-nav"
        aria-label="Primary"
        className={`${styles.nav} ${open ? styles.navOpen : ''}`}
      >
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.to} className={styles.item}>
              <PublicNavLink
                to={item.to}
                className={navLinkClass}
                end={item.to === '/'}
                onClick={onNavigate}
              >
                {item.label}
              </PublicNavLink>
            </li>
          ))}
        </ul>
        {authItems?.length ? (
          <div className={styles.authGroup}>
            {authItems.map((item) => (
              <ButtonLink
                key={item.to}
                to={item.to}
                variant={item.to === '/register' ? 'light' : 'outlineLight'}
                className={styles.authLink}
                onClick={onNavigate}
              >
                {item.label}
              </ButtonLink>
            ))}
          </div>
        ) : null}
      </nav>
    </>
  );
}
