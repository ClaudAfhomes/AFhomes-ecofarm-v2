/**
 * AF Homes Phase 12 - pure document helpers.
 *
 * Deterministic and side-effect free: file-type validation, magic-byte
 * checks, storage-path generation and ID masking live here so they can be
 * tested without storage, a database, or an OCR provider.
 */
import { randomUUID } from 'node:crypto';

import { maskGovernmentId } from '@afhomes/contracts';

export const DOCUMENT_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_ALLOWLIST)[number];

/** Bucket file size ceiling mirrors the storage bucket limit (10 MiB). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<DocumentMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export const CUSTOMER_IDS_BUCKET = 'afhomes-customer-ids';
export const OST_IDS_BUCKET = 'afhomes-ost-ids';

export function bucketForSubject(subjectType: 'customer' | 'ost_application'): string {
  return subjectType === 'customer' ? CUSTOMER_IDS_BUCKET : OST_IDS_BUCKET;
}

/**
 * Server-generated object path. The subject id is a validated UUID supplied
 * by the caller, the leaf defaults to random, and the extension comes from
 * the validated MIME - so traversal and executable uploads are impossible.
 * A non-conforming leaf is replaced rather than trusted.
 */
export function documentObjectPath(
  subjectType: 'customer' | 'ost_application',
  subjectId: string,
  mime: DocumentMime,
  leaf: string = randomUUID(),
): string {
  const scope = subjectType === 'customer' ? 'customer' : 'ost-application';
  const safeLeaf = /^[A-Za-z0-9-]{1,64}$/.test(leaf) ? leaf : randomUUID();
  return `${scope}/${subjectId}/${safeLeaf}.${EXTENSION_BY_MIME[mime]}`;
}

/** File signatures the allowlist actually permits. Extension alone proves nothing. */
export function mimeMatchesSignature(mime: string, bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png')
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** Fields whose values are ID numbers and must be masked on read. */
const ID_NUMBER_KEYS = [/id[_-]?number/i, /document[_-]?number/i, /government[_-]?id/i];

export const isIdNumberKey = (key: string): boolean => ID_NUMBER_KEYS.some((re) => re.test(key));

/** Mask extracted/reviewed fields for list and review reads. */
export function maskExtractedFields(
  fields: Record<string, { value: string | null; confidence: number | null }>,
): Record<string, { value: string | null; confidence: number | null }> {
  const out: Record<string, { value: string | null; confidence: number | null }> = {};
  for (const [key, field] of Object.entries(fields)) {
    out[key] =
      isIdNumberKey(key) && field.value
        ? { value: maskGovernmentId(field.value), confidence: field.confidence }
        : field;
  }
  return out;
}

/** Mask confirmed (reviewed) values the same way. */
export function maskReviewedFields(
  fields: Record<string, string | null>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = isIdNumberKey(key) ? maskGovernmentId(value) : value;
  }
  return out;
}

/** Pull a candidate ID number out of confirmed fields for duplicate flagging. */
export function idNumberFromFields(fields: Record<string, string | null>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (isIdNumberKey(key) && value && value.trim().length >= 4) return value.trim();
  }
  return null;
}

/** Storage-path digest proving bytes arrived. Only a server-verified digest counts. */
export const PENDING_SHA256 = '0'.repeat(64);

/** Minimal row shape the current-ID rule reads. No hashes or paths leave this module. */
export interface CurrentCandidateRow {
  id?: unknown;
  created_at?: unknown;
  verification_status?: unknown;
  storage_path?: unknown;
  sha256?: unknown;
}

/**
 * A reserved path carries no bytes until the server verifies the digest.
 * Shared with the documents handler so both use one definition.
 */
export function hasPersistedFile(row: CurrentCandidateRow): boolean {
  return (
    typeof row.storage_path === 'string' &&
    row.storage_path.length > 0 &&
    typeof row.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(row.sha256) &&
    row.sha256 !== PENDING_SHA256
  );
}

/**
 * THE canonical Current ID rule (server authority, UI must never re-derive).
 *
 * Current is the newest file-backed, non-rejected document by
 * `created_at DESC, id DESC`. Rationale, each clause load-bearing:
 *
 * - File-backed only: a reserved path with no verified bytes cannot identify anyone.
 * - Non-rejected: a rejected document is affirmatively not a valid ID.
 * - `created_at` primary (NOT `reviewed_at`): verifying or human-confirming an
 *   older document must never steal currentness from a newer one. VERIFY and
 *   MAKE-CURRENT are different operations; only creating a newer document row
 *   (an explicit replacement upload) moves currentness.
 * - `id` tiebreak: UUID text order is arbitrary but total, so simultaneous
 *   rows still resolve to exactly one winner deterministically.
 *
 * Pure function of persisted rows: no locks, no writes, idempotent under
 * retry, and immune to completion order. Returns null when nothing qualifies.
 */
export function selectCurrentDocumentId(rows: CurrentCandidateRow[]): string | null {
  const eligible = rows.filter(
    (row) =>
      typeof row.id === 'string' &&
      hasPersistedFile(row) &&
      row.verification_status !== 'rejected',
  );
  eligible.sort((a, b) => {
    const aTime = Date.parse(String(a.created_at));
    const bTime = Date.parse(String(b.created_at));
    const aSafe = Number.isNaN(aTime) ? 0 : aTime;
    const bSafe = Number.isNaN(bTime) ? 0 : bTime;
    if (aSafe !== bSafe) return bSafe - aSafe;
    return String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0;
  });
  const winner = eligible[0];
  return winner && typeof winner.id === 'string' ? winner.id : null;
}
