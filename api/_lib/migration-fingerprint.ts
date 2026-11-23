import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import { purchaseFingerprint } from './purchase-fingerprint.js';
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}
/** Native BSON Date and ordinary JSON must remain distinguishable in reconciliation. */
const hasDate = (value: unknown): boolean => value instanceof Date || (!!value && typeof value === 'object' && Object.values(value).some(hasDate));
export const migrationFingerprint = (value: unknown) => hasDate(value)
  ? createHash('sha256').update('afhomes-native-bson-v1\0').update(BSON.serialize({ value: canonical(value) })).digest('hex')
  : purchaseFingerprint(value);
