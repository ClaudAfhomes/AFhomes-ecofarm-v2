import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Scrolls to the top when the route changes (respecting in-page hash anchors).
 * Search-param changes (filters, pagination) keep the current position.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash]);

  return null;
}
