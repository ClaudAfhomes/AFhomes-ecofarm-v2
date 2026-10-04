import { describe, expect, it } from 'vitest';

import {
  bucketForSubject,
  DOCUMENT_MAX_BYTES,
  documentObjectPath,
  idNumberFromFields,
  isIdNumberKey,
  maskExtractedFields,
  maskReviewedFields,
  mimeMatchesSignature,
  selectCurrentDocumentId,
} from './documents.js';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('document file validation', () => {
  it('accepts each allowlisted type by its magic bytes', () => {
    expect(mimeMatchesSignature('image/jpeg', JPEG)).toBe(true);
    expect(mimeMatchesSignature('image/png', PNG)).toBe(true);
    expect(mimeMatchesSignature('application/pdf', PDF)).toBe(true);
  });

  it('rejects cross-type content regardless of the declared MIME', () => {
    expect(mimeMatchesSignature('image/jpeg', PNG)).toBe(false);
    expect(mimeMatchesSignature('image/png', PDF)).toBe(false);
    expect(mimeMatchesSignature('application/pdf', JPEG)).toBe(false);
    expect(mimeMatchesSignature('image/gif', JPEG)).toBe(false);
  });

  it('rejects truncated input that cannot carry a signature', () => {
    expect(mimeMatchesSignature('image/jpeg', new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(mimeMatchesSignature('image/png', new Uint8Array([]))).toBe(false);
  });

  it('caps uploads at the 10 MiB bucket limit', () => {
    expect(DOCUMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('storage paths', () => {
  it('keeps customer and OST documents in separate private buckets', () => {
    expect(bucketForSubject('customer')).toBe('afhomes-customer-ids');
    expect(bucketForSubject('ost_application')).toBe('afhomes-ost-ids');
  });

  it('generates paths with no user-controlled traversal or executable extension', () => {
    const path = documentObjectPath(
      'customer',
      '11111111-1111-4111-8111-111111111111',
      'image/jpeg',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(path).toBe(
      'customer/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg',
    );
    expect(path).not.toContain('..');
    // A hostile leaf is replaced with a random one, never trusted.
    const hostile = documentObjectPath('customer', 'id', 'application/pdf', '../../x');
    expect(hostile.endsWith('.pdf')).toBe(true);
    expect(hostile).not.toContain('..');
  });
});

describe('ID masking', () => {
  it('masks ID-number fields and leaves ordinary fields alone', () => {
    const masked = maskExtractedFields({
      idNumber: { value: '7788-9900-1122', confidence: 0.9 },
      firstName: { value: 'Ana', confidence: 0.9 },
    });
    expect(masked.idNumber!.value).toBe('**********1122');
    expect(masked.firstName!.value).toBe('Ana');
  });

  it('masks confirmed values the same way', () => {
    expect(maskReviewedFields({ documentNumber: 'P1234567', firstName: 'Ana' })).toEqual({
      documentNumber: '****4567',
      firstName: 'Ana',
    });
  });

  it('finds a candidate ID number for duplicate flagging', () => {
    expect(idNumberFromFields({ firstName: 'Ana', idNumber: 'P1234567' })).toBe('P1234567');
    expect(idNumberFromFields({ firstName: 'Ana' })).toBeNull();
    expect(isIdNumberKey('governmentId')).toBe(true);
    expect(isIdNumberKey('firstName')).toBe(false);
  });
});

describe('canonical Current ID selection', () => {
  const file = (over: Record<string, unknown> = {}) => ({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    created_at: '2026-09-20T00:00:00.000Z',
    verification_status: 'pending_review',
    storage_path: 'afhomes-customer-ids/customer/x.jpg',
    sha256: 'a'.repeat(64),
    ...over,
  });

  it('returns null when nothing qualifies', () => {
    expect(selectCurrentDocumentId([])).toBeNull();
  });

  it('ignores rows without verified bytes and rejected documents', () => {
    const pending = file({ id: 'a', storage_path: '', sha256: '0'.repeat(64) });
    const rejected = file({
      id: 'b',
      created_at: '2026-09-21T00:00:00.000Z',
      verification_status: 'rejected',
    });
    expect(selectCurrentDocumentId([pending, rejected])).toBeNull();
  });

  it('prefers the newest file-backed document regardless of verification status', () => {
    const old = file({ id: 'a', verification_status: 'confirmed' });
    const current = file({
      id: 'b',
      created_at: '2026-09-21T00:00:00.000Z',
      verification_status: 'pending_review',
    });
    expect(selectCurrentDocumentId([old, current])).toBe('b');
    expect(selectCurrentDocumentId([current, old])).toBe('b');
  });

  it('breaks created_at ties deterministically by id', () => {
    const a = file({ id: 'aaaaaaaa-0000-4000-8000-000000000001' });
    const b = file({ id: 'bbbbbbbb-0000-4000-8000-000000000002' });
    expect(selectCurrentDocumentId([a, b])).toBe('bbbbbbbb-0000-4000-8000-000000000002');
    expect(selectCurrentDocumentId([b, a])).toBe('bbbbbbbb-0000-4000-8000-000000000002');
  });

  it('falls back past unparseable timestamps without throwing', () => {
    const bad = file({ id: 'a', created_at: 'not-a-date' });
    const good = file({ id: 'b', created_at: '2026-09-21T00:00:00.000Z' });
    expect(selectCurrentDocumentId([bad, good])).toBe('b');
  });
});
