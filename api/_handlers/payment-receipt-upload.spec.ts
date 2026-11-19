/**
 * Payment receipt upload grants (POST /sales/:id/payments/receipt-upload).
 *
 * Recording a payment requires `receiptStoragePath` naming a real object in the
 * private `afhomes-payment-receipts` bucket, so Finance first asks for a signed
 * upload grant. The server picks the path; the client only declares type/size.
 */
import { paymentReceiptUploadGrantSchema } from '@afhomes/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  LINKS,
  SALE,
  TOKEN2,
  UNIQUE,
  phase2World,
  phase2WorldTokens,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown, grants: [] as [string, string][] }));

vi.mock('../_lib/storage.js', () => ({
  storageClient: () => ({}),
  createUploadGrant: async (_storage: unknown, bucket: string, path: string) => {
    holder.grants.push([bucket, path]);
    return { uploadUrl: `https://storage.example.invalid/${path}`, expiresAt: 'soon' };
  },
  createDownloadGrant: vi.fn(),
  downloadObject: vi.fn(),
}));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: (res: { status: (c: number) => { json: (b: unknown) => void } }, rows: unknown[]) =>
    res.status(200).json({ data: rows, meta: { total: rows.length } }),
  methodNotAllowed: () => {},
  readJsonBody: (req: { body?: unknown }) => ({ ok: true as const, body: req.body }),
}));

const sales = (await import('./sales.js')).default;

async function grant(token: string, saleId: string, body: unknown) {
  holder.db = new FakeSupabase({
    tables: phase2World(),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
  });
  holder.grants = [];
  const { res, state } = makeRes();
  await sales(
    makeReq({
      method: 'POST',
      familyPath: `${saleId}/payments/receipt-upload`,
      body,
      token,
    }) as never,
    res as never,
  );
  return state;
}

const PDF = { contentType: 'application/pdf', byteSize: 120_000 };

describe('payment receipt upload grant', () => {
  it('gives Finance a server-chosen, sale-scoped path in the private receipts bucket', async () => {
    const state = await grant(TOKEN2.finance, SALE.unpaid, PDF);
    expect(state.status).toBe(201);
    const body = paymentReceiptUploadGrantSchema.parse(state.body);
    expect(body.receiptStoragePath).toMatch(
      new RegExp(`^sale/${SALE.unpaid}/[0-9a-f-]{36}\\.pdf$`),
    );
    expect(holder.grants).toEqual([['afhomes-payment-receipts', body.receiptStoragePath]]);
  });

  it('refuses a caller without finance.payment_verification update', async () => {
    const state = await grant(TOKEN2.hr, SALE.unpaid, PDF);
    expect(state.status).toBe(403);
    expect(holder.grants).toHaveLength(0);
  });

  it('refuses an unknown sale without issuing a grant', async () => {
    const state = await grant(TOKEN2.finance, 'bbbbbbbb-0000-4000-8000-0000000000ff', PDF);
    expect(state.status).toBe(404);
    expect(holder.grants).toHaveLength(0);
  });

  it('refuses a disallowed type or an oversized file', async () => {
    for (const body of [
      { contentType: 'text/html', byteSize: 10 },
      { contentType: 'image/png', byteSize: 10_485_761 },
      { contentType: 'image/png' },
    ]) {
      const state = await grant(TOKEN2.finance, SALE.unpaid, body);
      expect(state.status).toBe(400);
    }
    expect(holder.grants).toHaveLength(0);
  });
});
