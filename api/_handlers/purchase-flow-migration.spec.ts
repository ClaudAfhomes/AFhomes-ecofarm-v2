import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = new URL(
  '../../supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql',
  import.meta.url,
);
const sql = () => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe('Gate 2 application purchase schema contract', () => {
  it('preserves legacy sources and permits pre-sale reservation payments', () => {
    expect(sql()).toContain('alter column sale_id drop not null');
    expect(sql()).toContain("origin = 'sale' and sale_id is not null and reservation_id is null");
    expect(sql()).toContain('payments_reservation_sale_fk');
    expect(sql()).toContain('deferrable initially deferred');
  });
  it('pins exact terms using a composite application/version reference', () => {
    expect(sql()).toContain('customer_application_purchase_terms');
    expect(sql()).toContain('foreign key (customer_application_id, purchase_terms_id)');
    expect(sql()).toContain('unique (application_id, version)');
    expect(sql()).toContain('PURCHASE_TERMS_IMMUTABLE');
  });
  it('constructs historical document fields explicitly rather than copying objects', () => {
    expect(sql()).toContain('private.build_purchase_document_fields');
    expect(sql()).toContain('jsonb_build_object(');
    expect(sql()).not.toMatch(/to_jsonb\s*\(\s*(?:v_\w+|new|old)\s*\)/i);
    expect(sql()).toContain('purchase_document_fields_valid');
    expect(sql()).toContain('PURCHASE_DOCUMENT_IMMUTABLE');
  });
  it('revokes document mutation and function access from browsers and service callers', () => {
    expect(sql()).toContain(
      'revoke all on private.purchase_document_evidence from public, anon, authenticated, service_role',
    );
    expect(sql()).toContain('from public, anon, authenticated, service_role');
    expect(sql()).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on.*to\s+(?:anon|authenticated)/i,
    );
  });
});
