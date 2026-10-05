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

/**
 * The Customer Code. A SEPARATE identifier from the Customer ID
 * (`AF-CUS-*`): this is the stable customer-facing lookup/reference code, and
 * the two are independently generated. 8 characters, not 5.
 */
export const AF_CODE_PREFIX = 'AF-CC';
export type AfCodePrefix = typeof AF_CODE_PREFIX;
export type AfBusinessPrefix = AfIdPrefix | AfCodePrefix;

/** Suffix length per prefix. Customer Code is the only 8-character value. */
export const AF_SUFFIX_LENGTH: Record<AfBusinessPrefix, number> = {
  'AF-CUS': 5,
  'AF-SALES': 5,
  'AF-CSALE': 5,
  'AF-EMP': 5,
  'AF-APP': 5,
  'AF-RES': 5,
  'AF-OST': 5,
  'AF-ACC': 5,
  'AF-REN': 5,
  'AF-PAY': 5,
  'AF-COM': 5,
  'AF-RED': 5,
  'AF-IMP': 5,
  [AF_CODE_PREFIX]: 8,
};

/** Strict `PREFIX-XXXXX` (or `AF-CC-XXXXXXXX`) matcher. Legacy numbers never match. */
export const afIdPattern = (prefix: AfBusinessPrefix): RegExp =>
  new RegExp(`^${prefix}-[${AF_ID_ALPHABET}]{${AF_SUFFIX_LENGTH[prefix]}}$`);

export const isAfId = (prefix: AfBusinessPrefix, value: unknown): boolean =>
  typeof value === 'string' && afIdPattern(prefix).test(value);

/** Response field: present once the business-ids migration has run. */
export const afBusinessIdSchema = (prefix: AfBusinessPrefix) =>
  z
    .string()
    .regex(afIdPattern(prefix))
    .nullish();

/** Customer Code field. Additive and nullish so a pre-migration payload parses. */
export const customerCodeSchema = afBusinessIdSchema(AF_CODE_PREFIX);

/**
 * Search matching shared by client and handler tests: case-insensitive
 * substring over the business ID, so legacy and AF values resolve alike.
 */
export const matchesBusinessId = (stored: unknown, term: unknown): boolean => {
  if (typeof stored !== 'string' || typeof term !== 'string') return false;
  const needle = term.trim().toLowerCase();
  return needle.length > 0 && stored.toLowerCase().includes(needle);
};
