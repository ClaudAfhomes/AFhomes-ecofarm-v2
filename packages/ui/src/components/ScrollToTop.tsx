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
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Malformed fragments remain literal IDs; never parse them as CSS.
      }
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash]);

  return null;
}
