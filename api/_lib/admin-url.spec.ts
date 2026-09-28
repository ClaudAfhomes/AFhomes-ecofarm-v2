import { describe, expect, it } from 'vitest';

import { resolveAdminUrl } from './admin-url.js';

describe('resolveAdminUrl', () => {
  it('uses the deployment URL for Preview without hardcoding its hostname', () => {
    expect(
      resolveAdminUrl({
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'afhomes-preview-abc.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'afhomes.example',
      }),
    ).toBe('https://afhomes-preview-abc.vercel.app/admin');
  });

  it('uses the stable project URL in Production', () => {
    expect(
      resolveAdminUrl({
        VERCEL_ENV: 'production',
        VERCEL_URL: 'afhomes-deployment-abc.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'afhomes.example',
      }),
    ).toBe('https://afhomes.example/admin');
  });

  it('lets a valid explicit operator URL win and rejects unsafe values', () => {
    expect(resolveAdminUrl({ AFHOMES_ADMIN_URL: 'https://admin.afhomes.example/admin/' })).toBe(
      'https://admin.afhomes.example/admin',
    );
    expect(resolveAdminUrl({ AFHOMES_ADMIN_URL: 'javascript:alert(1)' })).toBeNull();
    expect(resolveAdminUrl({ VERCEL_URL: 'good.vercel.app@evil.example' })).toBeNull();
  });
});
