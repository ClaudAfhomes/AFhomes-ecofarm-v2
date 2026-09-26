import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import Swal from 'sweetalert2';

// Generous async timeout: the full suite runs files in parallel and heavy
// pages (multi-step form, galleries) can exceed the 1s default under load.
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
});

afterEach(() => {
  cleanup();
  Swal.close();
  vi.unstubAllGlobals();
  try {
    localStorage.removeItem('jad:mock:session');
  } catch {
    // storage unavailable
  }
  try {
    sessionStorage.removeItem('jad:register:draft:v1');
    sessionStorage.removeItem('jad:register:draft:v2');
    sessionStorage.removeItem('jad:register:email');
    sessionStorage.removeItem('jad:register:draft');
  } catch {
    // storage unavailable
  }
});
