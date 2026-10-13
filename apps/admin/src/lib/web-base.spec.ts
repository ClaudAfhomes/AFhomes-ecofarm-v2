import { afterEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ VITE_WEB_URL: 'http://localhost:5173' }));
vi.mock('./env', () => ({ env: config }));
import { webBase } from './portal';

afterEach(() => {
  vi.unstubAllGlobals();
  config.VITE_WEB_URL = 'http://localhost:5173';
});

describe('cross-portal web base', () => {
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'])(
    'keeps a deployed portal on its origin when configured with %s', (base) => {
      config.VITE_WEB_URL = base;
      vi.stubGlobal('location', new URL('https://preview.example/admin/login'));
      expect(webBase()).toBe('https://preview.example');
    },
  );

  it('preserves the separate local web development port', () => {
    vi.stubGlobal('location', new URL('http://localhost:5174/admin/login'));
    expect(webBase()).toBe('http://localhost:5173');
  });

  it('preserves an explicitly configured online web portal', () => {
    config.VITE_WEB_URL = 'https://members.example';
    vi.stubGlobal('location', new URL('https://admin.example/admin/login'));
    expect(webBase()).toBe('https://members.example');
  });
});
