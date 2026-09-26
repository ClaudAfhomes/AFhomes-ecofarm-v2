import { useEffect } from 'react';

import type { CmsPhoto } from '@jad/contracts';

/**
 * Dynamically updates the favicon from CMS `global.browserIcon`.
 * Falls back to the static `/ja-d-logo.png` if CMS is unavailable.
 * No SSR - Vite SPA only.
 */
export function useDynamicFavicon(browserIcon?: CmsPhoto | null): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!browserIcon?.id) return;

    const href = browserIcon.id;

    // Basic validation: id is already validated by Zod 1-500, but guard against javascript: etc.
    if (/^(javascript|data|vbscript):/i.test(href)) return;

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    // Avoid unnecessary DOM mutation if href already correct
    if (link.href !== href && link.getAttribute('href') !== href) {
      link.href = href;
      // Hint for type if PNG
      if (href.endsWith('.png')) link.type = 'image/png';
      else if (href.endsWith('.svg')) link.type = 'image/svg+xml';
      else if (href.endsWith('.ico')) link.type = 'image/x-icon';
    }
  }, [browserIcon?.id]);
}
