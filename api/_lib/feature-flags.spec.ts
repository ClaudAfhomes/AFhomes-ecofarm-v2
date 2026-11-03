import { expect, it } from 'vitest';
import { selectHandler } from './router.js';

it('blocks disabled modules at the server router before any handler or database access', () => {
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
