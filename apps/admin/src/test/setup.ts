import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import Swal from 'sweetalert2';

// Lazy route chunks can take longer than one second to load on a cold Windows checkout.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  // jsdom has no matchMedia; SweetAlert2 reads it for the color-scheme query.
  // Default to a non-matching stub so notification popups render in tests.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  // jsdom logs "Not implemented" for window.scrollTo; ScrollToTop calls it on
  // every route change. Specs that assert scrolling replace this stub.
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(() => {
  cleanup();
  Swal.close();
  vi.unstubAllGlobals();
});
