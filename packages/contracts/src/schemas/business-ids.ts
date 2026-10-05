/**
 * AF Homes public business IDs (AF-*).
 *
 * Single source for the AF-* vocabulary shared by handlers, the client and
 * tests. The database remains authoritative for generation
 * (`private.af_candidate` / `private.claim_af_id` in the business-ids
 * migration); this module only validates and matches. The alphabet constant
 * below MUST stay identical to the SQL `alphabet` literal - the business-ids
 * spec asserts both strings match.
 */
import { z } from 'zod';

/** Readable alphabet: no I, O, 0 or 1. 32 symbols, 32^5 suffixes per prefix. */
export const AF_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const AF_ID_PREFIXES = [
  'AF-CUS',
  'AF-SALES',
  'AF-CSALE',
  'AF-EMP',
  'AF-APP',
  'AF-RES',
  'AF-OST',
  'AF-ACC',
  'AF-REN',
  'AF-PAY',
  'AF-COM',
  'AF-RED',
  'AF-IMP',
] as const;
export type AfIdPrefix = (typeof AF_ID_PREFIXES)[number];

/** Strict `PREFIX-XXXXX` matcher. Legacy numbers (CUS-, SALE-, ...) never match. */
export const afIdPattern = (prefix: AfIdPrefix): RegExp =>
  new RegExp(`^${prefix}-[${AF_ID_ALPHABET}]{5}$`);

export const isAfId = (prefix: AfIdPrefix, value: unknown): boolean =>
  typeof value === 'string' && afIdPattern(prefix).test(value);

/** Response field: present once the business-ids migration has run. */
export const afBusinessIdSchema = (prefix: AfIdPrefix) =>
  z
    .string()
    .regex(afIdPattern(prefix))
    .nullish();

/**
 * Search matching shared by client and handler tests: case-insensitive
 * substring over the business ID, so legacy and AF values resolve alike.
 */
export const matchesBusinessId = (stored: unknown, term: unknown): boolean => {
  if (typeof stored !== 'string' || typeof term !== 'string') return false;
  const needle = term.trim().toLowerCase();
  return needle.length > 0 && stored.toLowerCase().includes(needle);
};
