import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20261005000001_afhomes_phase12_identity_ocr.sql'),
  'utf8',
);

describe('PHASE 12 identity OCR migration', () => {
  it('adds uploader attribution plus only OCR and verification state', () => {
    for (const column of ['uploaded_by', 'ocr_status', 'ocr_provider', 'verification_status']) {
      expect(sql, column).toContain(column);
    }
    expect(sql).toContain('add column if not exists');
    expect(sql).not.toMatch(/qr_token|fallback_code|hash_token/);
  });

  it('keeps OCR success and human verification in separate state machines', () => {
    expect(sql).toContain(`'not_requested', 'completed', 'failed', 'unavailable'`);
    expect(sql).toContain(`'pending_review', 'confirmed', 'rejected'`);
  });

  it('creates no duplicate constraint and migrates no secrets', () => {
    expect(sql).not.toMatch(/unique/i);
    expect(sql).not.toMatch(/create\s+role|alter\s+role/i);
    expect(sql).not.toMatch(/set\s+[a-z_.]+\s*=\s*'[^']{16,}'/i);
  });

  it('keeps browser reads scoped without widening to Finance', () => {
    expect(sql).toContain('identity_documents_read');
    expect(sql).toContain('uploaded_by = (select auth.uid())');
    expect(sql).not.toContain('finance.');
    expect(sql).not.toMatch(/grant (insert|update|delete)/i);
  });

  it('guards its precondition and stays forward-only', () => {
    expect(sql).toContain('PHASE12_PREREQ_MISSING:identity_documents');
    expect(sql).not.toMatch(/drop table/i);
  });
});
