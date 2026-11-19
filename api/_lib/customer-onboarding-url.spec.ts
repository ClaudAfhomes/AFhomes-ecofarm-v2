import { describe, expect, it } from 'vitest';

import { customerActivationUrl, resolveCustomerPortalOrigin } from './customer-onboarding-url.js';

describe('customer onboarding URL', () => {
  it('uses the configured customer origin and keeps the token out of the query string', () => {
    const url = customerActivationUrl('raw+/= token', {
      AFHOMES_WEB_URL: 'https://portal.afhomes.example/customer/',
    });
    expect(url).toBe('https://portal.afhomes.example/customer/activate#token=raw%2B%2F%3D%20token');
    expect(url).not.toContain('?token=');
  });

  it('uses the deployment host in Preview and the stable host in Production', () => {
    expect(
      resolveCustomerPortalOrigin({
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'afhomes-preview-abc.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'afhomes.example',
      }),
    ).toBe('https://afhomes-preview-abc.vercel.app');
    expect(
      resolveCustomerPortalOrigin({
        VERCEL_ENV: 'production',
        VERCEL_URL: 'afhomes-deployment-abc.vercel.app',
        VERCEL_PROJECT_PRODUCTION_URL: 'afhomes.example',
      }),
    ).toBe('https://afhomes.example');
  });

  it('allows loopback HTTP and rejects credentials, unsafe schemes, and hostile hosts', () => {
    expect(resolveCustomerPortalOrigin({ AFHOMES_WEB_URL: 'http://localhost:5173' })).toBe(
      'http://localhost:5173',
    );
    expect(resolveCustomerPortalOrigin({ AFHOMES_WEB_URL: 'javascript:alert(1)' })).toBeNull();
    expect(
      resolveCustomerPortalOrigin({ AFHOMES_WEB_URL: 'https://user:pass@example.com' }),
    ).toBeNull();
    expect(resolveCustomerPortalOrigin({ VERCEL_URL: 'good.vercel.app@evil.example' })).toBeNull();
  });
});
