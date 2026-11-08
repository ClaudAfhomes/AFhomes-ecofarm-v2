import type { ReactNode } from 'react';

import { IconButton } from './IconButton';
import styles from './Topbar.module.css';

export interface TopbarProps {
  /** Opens the mobile/tablet navigation drawer or toggles the desktop sidebar. */
  onMenuClick: () => void;
  menuLabel?: string;
  actions?: ReactNode;
  /** Optional leading content for mobile (e.g., logo) when menu is hidden on mobile. */
  leading?: ReactNode;
  context?: ReactNode;
  /** When true, hide the menu button on mobile (<640px) - used when bottom nav provides drawer access. */
  hideMenuOnMobile?: boolean;
  /**
   * Position of the menu button on mobile (<640px).
   * - `'left'` (default): hamburger renders on the left next to leading content.
   * - `'right'`: hamburger renders on the right next to the action slot (e.g., avatar).
   * Desktop always renders the hamburger on the left for sidebar collapse.
   */
  menuPosition?: 'left' | 'right';
}

/** App header bar: sidebar/drawer toggle and action slot. */
export function Topbar({
  onMenuClick,
  menuLabel = 'Open menu',
  actions,
  leading,
  context,
  hideMenuOnMobile = false,
  menuPosition = 'left',
}: TopbarProps) {
  const menuBtn = <IconButton icon="menu" label={menuLabel} onClick={onMenuClick} />;

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        {leading ? <span className={styles.mobileLeading}>{leading}</span> : null}
        {menuPosition === 'left' ? (
          <span className={hideMenuOnMobile ? styles.menuHiddenOnMobile : undefined}>
            {menuBtn}
          </span>
        ) : (
          <span className={styles.menuOnDesktopOnly}>{menuBtn}</span>
        )}
        {context}
      </div>
      {actions || menuPosition === 'right' ? (
        <div className={styles.actions}>
          {actions}
          {menuPosition === 'right' ? (
            <span
              className={hideMenuOnMobile ? styles.menuHiddenOnMobile : styles.menuOnMobileOnly}
            >
              {menuBtn}
            </span>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
