/**
 * Server-side input normalization: an API caller that bypasses the UI still
 * gets validated and normalized, because every writer parses the shared
 * contracts. Lowercase names are stored UPPERCASE, Philippine mobile forms
 * canonicalize to +63, and invalid names/phones/dates are refused with 400.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitOstApplicationSchema } from '@afhomes/contracts';

import { phase2World, phase2WorldTokens } from '../_lib/testing/phase2-fixtures.js';
import { TOKEN, UUID } from '../_lib/testing/fixtures.js';
import { FakeSupabase, makeRes } from '../_lib/testing/supabase-fake.js';
import { validateImportRow } from '../_lib/customer-import.js';
import type { ImportContext } from '../_lib/customer-import.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
}));
const { default: customersHandler } = await import('./customers.js');

const ADDRESS = {
  line1: '77 katipunan',
  line2: 'unit 2, 123 rizal st.',
  city: 'quezon city',
  province: 'metro manila',
};

function install() {
  holder.db = new FakeSupabase({
    tables: phase2World({}),
    tokens: phase2WorldTokens(),
    rpcs: [{ fn: 'next_customer_number', result: [{ customer_number: 'CUS-000099' }] }],
  });
  return holder.db as FakeSupabase;
}

async function post(body: Record<string, unknown>) {
  const { res, state } = makeRes();
  await customersHandler(
    {
      method: 'POST',
      query: { familyPath: '' },
      headers: { authorization: `Bearer ${TOKEN.admin}` },
      body,
    } as never,
    res as never,
  );
  return state;
}

const validBody = () => ({
  firstName: '  claud   mars  ',
  middleName: 'jimenez',
  lastName: 'dela cruz',
  dateOfBirth: '1990-05-04',
  email: 'Claud@Example.COM',
  phone: '0918-555-0101',
  address: ADDRESS,
});

beforeEach(() => install());

describe('customer writes normalize server-side', () => {
  it('uppercases names/addresses, lowercases email, canonicalizes the phone', async () => {
    const state = await post(validBody());
    expect(state.status).toBe(201);
    const db = holder.db as FakeSupabase;
    const row = db.rows('customers').find((r) => r.email === 'claud@example.com')!;
    expect(row.first_name).toBe('claud mars');
    expect(row.middle_name).toBe('jimenez');
    expect(row.last_name).toBe('dela cruz');
    expect(row.email).toBe('claud@example.com');
    expect(row.phone).toBe('+639185550101');
    const address = row.address as Record<string, string>;
    expect(address.city).toBe('QUEZON CITY');
    expect(address.line2).toBe('UNIT 2, 123 RIZAL ST.');
    expect(address.province).toBe('METRO MANILA');
  });

  it('refuses numeric names, alphabetic phones and impossible dates with 400', async () => {
    expect((await post({ ...validBody(), firstName: 'Claud2' })).status).toBe(400);
    expect((await post({ ...validBody(), lastName: 'Jimenez Jr 3rd' })).status).toBe(400);
    expect((await post({ ...validBody(), phone: '0918ABC0101' })).status).toBe(400);
    expect((await post({ ...validBody(), dateOfBirth: '1990-02-30' })).status).toBe(400);
    expect((await post({ ...validBody(), dateOfBirth: '2099-01-01' })).status).toBe(400);
    expect((await post({ ...validBody(), email: 'not-an-email' })).status).toBe(400);
  });
});

describe('other writers normalize through the same contracts', () => {
  it('OST applications normalize names and canonicalize phones', () => {
    const parsed = submitOstApplicationSchema.parse({
      referralCode: 'OST-ABCDEF-123456',
      firstName: 'oscar',
      lastName: 'santos',
      email: 'Oscar@Example.COM',
      phone: '09171234567',
      birthDate: '1992-08-19',
      address: ADDRESS,
    });
    expect(parsed.firstName).toBe('oscar');
    expect(parsed.lastName).toBe('santos');
    expect(parsed.email).toBe('oscar@example.com');
    expect(parsed.phone).toBe('+639171234567');
    expect(parsed.address.city).toBe('QUEZON CITY');
    expect(submitOstApplicationSchema.safeParse({ ...parsed, firstName: 'Osc4r' }).success).toBe(
      false,
    );
  });

  it('official-form saves normalize optional holder text before the RPC', async () => {
    const db = holder.db as FakeSupabase;
    db.rpcs.push({
      fn: 'create_customer_application_once',
      result: 'aaaaaaaa-0000-4000-8000-0000000000a1',
    });
    const { default: formsHandler } = await import('./official-forms.js');
    const { res, state } = makeRes();
    await formsHandler(
      {
        method: 'POST',
        query: { familyPath: 'customer-applications' },
        headers: { authorization: `Bearer ${TOKEN.admin}` },
        body: {
          requestId: UUID.viewerStaff,
          customerId: UUID.viewerStaff,
          planId: UUID.viewerStaff,
          tier: 'GOLD',
          paymentScheme: 'spot_cash',
          primary: {
            holderType: 'PRIMARY',
            lastName: 'jimenez',
            firstName: 'claud',
            middleName: 'mars',
            suffix: 'jr',
            birthDate: '1990-05-04',
            permanentAddressLine1: '123 main st',
            permanentAddressLine2: 'unit 2, 123 rizal st.',
            officeBusinessAddress: 'office at rizal st.',
            cityMunicipality: 'quezon city',
            province: 'metro manila',
            postalCode: '1103',
            mobile: '09171234567',
            email: 'Claud@Example.COM',
            printedName: 'claud jimenez',
            occupationBusinessName: 'sari-sari store owner',
            employedPosition: 'store keeper',
          },
          consentAcknowledged: true,
          acknowledgedAt: '2026-01-01',
          primarySignatureStatus: 'pending',
          validIdReceived: true,
          reservationPaymentProofReceived: true,
        },
      } as never,
      res as never,
    );
    expect(state.status).toBe(201);
    const call = db.calls.find(
      (c) => c.op === 'rpc' && c.table === 'create_customer_application_once',
    );
    const primary = (call?.arg as Record<string, Record<string, unknown>>).p_primary;
    expect(primary).toMatchObject({
      lastName: 'jimenez',
      firstName: 'claud',
      middleName: 'mars',
      suffix: 'jr',
      cityMunicipality: 'QUEZON CITY',
      permanentAddressLine2: 'UNIT 2, 123 RIZAL ST.',
      officeBusinessAddress: 'OFFICE AT RIZAL ST.',
      occupationBusinessName: 'SARI-SARI STORE OWNER',
      employedPosition: 'STORE KEEPER',
      printedName: 'claud jimenez',
      mobile: '+639171234567',
      email: 'claud@example.com',
    });
  });

  it('import rows uppercase names and canonicalize phones', () => {
    const ctx = {
      membershipByNumber: new Map(),
      customerByNumber: new Map(),
      customerByEmail: new Map(),
      seenMembershipNumbers: new Map(),
    } as unknown as ImportContext;
    const v = validateImportRow(
      2,
      {
        source_status: 'Pending',
        first_name: 'juan',
        last_name: 'dela cruz',
        email: 'Juan@Example.COM',
        mobile: '09185550101',
      },
      ctx,
      '2026-10-02',
    );
    expect(v.errors).toEqual([]);
    expect(v.normalized?.person.firstName).toBe('juan');
    expect(v.normalized?.person.lastName).toBe('dela cruz');
    expect(v.normalized?.person.email).toBe('juan@example.com');
    expect(v.normalized?.person.phone).toBe('+639185550101');
    const bad = validateImportRow(
      3,
      {
        source_status: 'Pending',
        first_name: 'Juan2',
        last_name: 'Cruz',
        email: 'j2@example.com',
        mobile: '09185550101',
      },
      ctx,
      '2026-10-02',
    );
    expect(bad.errors).toContainEqual({
      field: 'first_name',
      message: 'Use letters, spaces, apostrophes and hyphens only',
    });
  });
});
