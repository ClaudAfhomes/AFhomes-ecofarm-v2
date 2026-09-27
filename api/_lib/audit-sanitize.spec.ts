import { describe, expect, it } from 'vitest';

import { auditSummary, maskEmail, maskPhone, sanitizeAuditValue } from './audit-sanitize.js';

describe('audit metadata redaction', () => {
  it('redacts tokens, hashes, paths, OCR text, and auth ids at any depth', () => {
    const out = sanitizeAuditValue({
      status: 'earned',
      qr_token_hash: 'a'.repeat(64),
      fallback_code_hash: 'b'.repeat(64),
      nested: { onboarding_token: 'raw-once', receipt_storage_path: 'bucket/x.jpg' },
      ocr: { raw_text: 'ID 1234-5678' },
      auth_user_id: 'user-id',
      government_id_number: '0011-2233',
    }) as Record<string, unknown>;
    expect(out.status).toBe('earned');
    expect(out.qr_token_hash).toBe('[redacted]');
    expect(out.fallback_code_hash).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).onboarding_token).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).receipt_storage_path).toBe('[redacted]');
    // A key NAMED ocr is itself sensitive, so the whole subtree is redacted.
    // Suggestion-only OCR text under a neutral key is still capped + kept.
    expect(out.ocr).toBe('[redacted]');
    const extraction = sanitizeAuditValue({ extraction: { raw_text: 'ID 1234' } }) as Record<
      string,
      Record<string, unknown>
    >;
    expect(extraction.extraction.raw_text).toBe('[redacted]');
    expect(out.auth_user_id).toBe('[redacted]');
    expect(out.government_id_number).toBe('[redacted]');
  });

  it('redacts bare hex blobs, caps strings, depth, breadth, and arrays', () => {
    expect(sanitizeAuditValue('a'.repeat(64))).toBe('[redacted]');
    const long = sanitizeAuditValue('x'.repeat(600)) as string;
    expect(long).toContain('[truncated]');
    expect(sanitizeAuditValue({ a: { b: { c: { d: { e: 'deep' } } } } })).toEqual({
      a: { b: { c: { d: '[depth-capped]' } } },
    });
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i += 1) wide[`k${i}`] = i;
    expect((sanitizeAuditValue(wide) as Record<string, unknown>)['…']).toBe('[keys-capped]');
    const many = sanitizeAuditValue(Array.from({ length: 30 }, (_, i) => i)) as unknown[];
    expect(many).toHaveLength(21);
    expect(many[20]).toMatch(/more/);
  });

  it('never leaks payload data through the one-line summary', () => {
    expect(auditSummary('COMMISSION_QUALIFIED', 'commission', 'abc')).toBe(
      'COMMISSION_QUALIFIED · commission abc',
    );
  });

  it('masks contact fields while keeping them routable', () => {
    expect(maskEmail('juan@example.com')).toBe('j***@example.com');
    expect(maskPhone('09185550101')).toBe('***0101');
    expect(maskEmail('not-an-email')).toBeNull();
    expect(maskPhone('12')).toBeNull();
  });
});
