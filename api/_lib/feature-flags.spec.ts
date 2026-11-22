import { afterEach, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, setFeatureFlags } from '@afhomes/shared';
import { selectHandler } from './router.js';

afterEach(() => setFeatureFlags(DEFAULT_FEATURE_FLAGS));

it('blocks switched-off modules at the server router before any handler or database access', () => {
  setFeatureFlags({ services: false, redemption: false, reports: false, cms: false });
  for (const prefix of ['/api', '/api/v1']) {
    for (const path of [
      '/redemptions',
      '/earning/purchases',
      '/earning/public/services',
      '/reports/redemptions',
      '/reports/sales',
      '/cms/public',
      '/customer/refunds',
    ]) {
      expect(selectHandler(prefix + path, {}), prefix + path).toBeNull();
    }
    for (const path of [
      '/sales',
      '/payments',
      '/customers',
      '/ost',
      '/genealogy',
      '/customer/points',
      '/customer/points/ledger',
    ]) {
      expect(selectHandler(prefix + path, {}), prefix + path).not.toBeNull();
    }
  }
});
