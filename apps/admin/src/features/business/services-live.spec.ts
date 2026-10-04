/**
 * Filter/sort/search integration and submit normalization at the service
 * layer: one request carries every active dimension, and person text leaves
 * normalized while technical fields pass through untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setApiAccessTokenForTests } from '../../lib/api/client';
import { createCustomer, getCustomers } from './services';

const calls: { url: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  setApiAccessTokenForTests('test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let body: unknown = null;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ url, body });
      if (init?.method === 'POST' && url.includes('/customers')) {
        return new Response(
          JSON.stringify({
            id: 'aaaaaaaa-0000-4000-8000-000000000001',
            customerNumber: 'CUS-000001',
            fullName: 'CLAUD DELA CRUZ',
            email: 'claud@example.com',
            phone: '+639185550101',
            dateOfBirth: '1990-05-04',
            gender: null,
            address: null,
            governmentIdType: null,
            governmentIdMasked: null,
            status: 'prospect',
            createdBy: null,
            createdAt: '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: [], meta: { total: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('customer service integration', () => {
  it('combines search, filters and sort in a single request', async () => {
    await getCustomers({
      search: 'claud',
      category: 'ACTIVE_VIP',
      tier: 'GOLD',
      seller: 'seller-id',
      from: '2026-01-01',
      to: '2026-10-01',
      sort: 'tier',
    });
    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    for (const part of [
      'search=claud',
      'category=ACTIVE_VIP',
      'tier=GOLD',
      'seller=seller-id',
      'from=2026-01-01',
      'to=2026-10-01',
      'sort=tier',
    ]) {
      expect(url).toContain(part);
    }
  });

  it('sends normalized person text with notes and IDs untouched', async () => {
    await createCustomer({
      firstName: 'claud',
      lastName: 'dela cruz',
      dateOfBirth: '1990-05-04',
      email: 'Claud@Example.COM',
      phone: '09185550101',
      address: {
        line1: '77 katipunan',
        city: 'quezon city',
        province: 'metro manila',
        countryCode: 'PH',
      },
      notes: 'Keep this Note as Typed!',
    });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      firstName: 'claud',
      lastName: 'dela cruz',
      email: 'claud@example.com',
      phone: '+639185550101',
      notes: 'Keep this Note as Typed!',
    });
    expect((body.address as Record<string, string>).city).toBe('QUEZON CITY');
  });
});
