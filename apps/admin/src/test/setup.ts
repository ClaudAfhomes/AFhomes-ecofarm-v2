import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import Swal from 'sweetalert2';

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
});
