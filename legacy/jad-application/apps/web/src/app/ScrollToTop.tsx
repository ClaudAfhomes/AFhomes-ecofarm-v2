import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Centralized scroll restoration for route changes.
 * - If the location has no hash, resets scroll to top instantly before paint.
 * - If the location has a hash, lets the browser handle anchor scrolling.
 *
 * Explicit `behavior: 'auto'` keeps the reset instant even if local smooth
 * scrolling is ever introduced elsewhere; route navigation must never animate.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useLayoutEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [pathname, hash]);

  return null;
}
