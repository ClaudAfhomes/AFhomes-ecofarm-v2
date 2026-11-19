import { expect, it } from 'vitest';
import { migrationFingerprint } from './migration-fingerprint.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';

it('retains existing JSON digests and distinguishes BSON dates, timestamps and empty objects', () => {
  const json = { z: ['value', 9], a: { n: null, timestamp: '2026-11-02T00:00:00.000Z' } };
  expect(migrationFingerprint(json)).toBe(purchaseFingerprint(json));
  const date = new Date('2026-11-02T00:00:00.000Z');
  expect(migrationFingerprint({ date, z: 1 })).toBe(migrationFingerprint({ z: 1, date: new Date(date) }));
  const digests = [date, new Date(date.valueOf() + 1), date.toISOString(), {}, null].map(value => migrationFingerprint({ nested: [value] }));
  expect(new Set(digests).size).toBe(digests.length);
});
