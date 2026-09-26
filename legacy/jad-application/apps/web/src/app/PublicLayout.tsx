import { Outlet, useLocation } from 'react-router';

import { useQuery } from '@tanstack/react-query';

import { getGlobalCmsPublic } from '@/lib/cms';
import { useDynamicFavicon } from '@/lib/favicon';
import { Footer } from './Footer';
import { Header } from './Header';
import { MessengerButton } from '../components/MessengerButton';
import { isAuthPath } from '../features/auth/content';
import styles from './PublicLayout.module.css';

/**
 * Shared public layout: header nav, main, footer (UI-UX §4.1 public hierarchy).
 * Includes skip link (UI-UX §12.3) and semantic landmarks.
 *
 * The floating "Let's Talk" Messenger button is a public marketing-page
 * affordance; it is hidden on member auth screens (Login/Register) where the
 * sticky header + brand panel already own the top-left corner and the contact
 * path is the form's own support links.
 *
 * Scroll reset is handled centrally by <ScrollToTop /> in App.
 * This prevents visible scroll animation during route transitions.
 */
export function PublicLayout() {
  const { pathname } = useLocation();
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  useDynamicFavicon(globalCms?.browserIcon ?? null);
  const hideOnAuth = globalCms?.messenger?.hideOnAuth ?? true;
  const shouldHideMessenger = hideOnAuth ? isAuthPath(pathname) : false;
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
      <Footer />
      {shouldHideMessenger ? null : <MessengerButton />}
    </div>
  );
}
