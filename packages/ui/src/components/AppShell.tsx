import { useCallback, useState, type ReactNode } from 'react';

import { useDisclosure } from '../hooks/useDisclosure';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { MobileDrawer } from './MobileDrawer';
import { Sidebar, type SidebarItem } from './Sidebar';
import { Topbar } from './Topbar';
import styles from './AppShell.module.css';

export interface AppShellProps {
  navItems: SidebarItem[];
  navLabel?: string;
  brand?: ReactNode;
  sidebarFooter?: ReactNode;
  topbarActions?: ReactNode;
  /** Dense task workspace, with an initially collapsed desktop navigation rail. */
  compactWorkspace?: boolean;
  topbarContext?: ReactNode;
  /** Page content rendered inside `<main>`. */
  children: ReactNode;
  /**
   * Mobile bottom navigation (Member app) - optional. May be a render function
   * receiving the drawer `open` callback so a "More" affordance can open the
   * full navigation drawer (UI-UX §4.6).
   */
  bottomNav?: ReactNode | ((openDrawer: () => void) => ReactNode);
  menuLabel?: string;
  mainId?: string;
  mainAriaLabel?: string;
  /** When true, hide the topbar hamburger on mobile (<640px) - used when bottom nav provides access. */
  hideMenuOnMobile?: boolean;
  /** Leading content for the topbar on mobile when menu is hidden (e.g., logo). */
  topbarLeading?: ReactNode;
  /**
   * Position of the hamburger button on mobile (<640px).
   * - `'left'` (default): hamburger on left next to leading content.
   * - `'right'`: hamburger on right next to the action slot (e.g., avatar).
   * Desktop always renders the hamburger on the left for sidebar collapse.
   */
  menuPosition?: 'left' | 'right';
}

/**
 * Dashboard application shell (UI-UX §4): persistent sidebar on desktop,
 * topbar with menu toggle, tablet/mobile drawer, optional mobile bottom nav,
 * and a skip link. Landmarks: `<aside>` (primary nav), `<header>` (topbar),
 * `<main>` (content).
 */
export function AppShell({
  navItems,
  navLabel,
  brand,
  sidebarFooter,
  topbarActions,
  compactWorkspace = false,
  topbarContext,
  children,
  bottomNav,
  menuLabel = 'Open menu',
  mainId = 'main-content',
  mainAriaLabel,
  hideMenuOnMobile = false,
  topbarLeading,
  menuPosition = 'left',
}: AppShellProps) {
  const { isOpen, open, close } = useDisclosure();
  const isDesktop = useMediaQuery(compactWorkspace ? '(min-width: 741px)' : '(min-width: 1024px)');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(compactWorkspace);

  const toggleSidebar = useCallback(() => {
    if (isDesktop) {
      setSidebarCollapsed((prev) => !prev);
    } else {
      if (isOpen) close();
      else open();
    }
  }, [isDesktop, isOpen, open, close]);

  const handleDrawerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      // Only navigation links close the drawer. Category/dropdown buttons
      // (and their icons/chevrons) must keep the drawer open while
      // expanding/collapsing the submenu.
      if (target.closest('a')) close();
    },
    [close],
  );

  // Desktop: selecting a module (any link - a plain item or a dropdown
  // sub-item) collapses the sidebar to icon-only automatically, the same way
  // picking an item closes the mobile drawer above. A category HEADER is a
  // <button>, not a link, so expanding/collapsing a dropdown never collapses
  // the rail.
  const handleSidebarNavClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDesktop) return;
      const target = e.target as HTMLElement;
      if (target.closest('a')) setSidebarCollapsed(true);
    },
    [isDesktop],
  );

  const sidebar = (
    <Sidebar
      brand={brand}
      items={navItems}
      footer={sidebarFooter}
      ariaLabel={navLabel}
      onExpand={() => setSidebarCollapsed(false)}
      collapsed={isDesktop && sidebarCollapsed}
    />
  );

  return (
    <div className={`${styles.shell} ${compactWorkspace ? styles.workspaceShell : ''}`}>
      <a className="skip-link" href={`#${mainId}`}>
        Skip to content
      </a>
      <div
        className={`${styles.sidebarCol} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}
        onClick={handleSidebarNavClick}
      >
        {sidebar}
      </div>
      <div className={styles.mainCol}>
        <Topbar
          onMenuClick={toggleSidebar}
          menuLabel={menuLabel}
          actions={topbarActions}
          leading={topbarLeading}
          context={topbarContext}
          hideMenuOnMobile={hideMenuOnMobile}
          menuPosition={menuPosition}
        />
        <main id={mainId} className={styles.main} tabIndex={-1} aria-label={mainAriaLabel}>
          {children}
        </main>
      </div>
      {!isDesktop ? (
        <MobileDrawer open={isOpen} onClose={close} label={navLabel}>
          <div onClick={handleDrawerClick}>{sidebar}</div>
        </MobileDrawer>
      ) : null}
      {typeof bottomNav === 'function' ? bottomNav(open) : bottomNav}
    </div>
  );
}
