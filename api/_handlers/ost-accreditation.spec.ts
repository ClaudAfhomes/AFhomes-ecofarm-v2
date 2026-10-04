import { beforeEach, describe, expect, it, vi } from 'vitest';
import { phase2World, phase2WorldTokens, TOKEN, UUID } from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { ostFileSchema } from '@jad/contracts';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const handler = (await import('./ost-accreditation.js')).default;
const form = {
  dateApplied: '2026-01-01',
  programCategory: 'non_vip',
  sex: 'male',
  civilStatus: 'single',
  governmentIdType: 'QA TEST',
  governmentIdNumber: 'SYNTHETIC-PRIVATE',
  applicantSignatureStatus: 'received',
  applicantSignedOn: '2026-01-01',
  referrerSignatureStatus: 'pending',
};
const identity = {
  firstName: 'QA',
  lastName: 'TEST',
  email: 'qa@example.invalid',
  phone: '09171234567',
  birthDate: '1990-01-01',
  address: { line1: 'QA STREET', city: 'QA CITY', province: 'QA PROVINCE', countryCode: 'PH' },
};
beforeEach(() => {
  holder.db = new FakeSupabase({
    tables: { ...phase2World({}), referral_codes: [] },
    tokens: phase2WorldTokens(),
    rpcs: [{ fn: 'submit_ost_accreditation', result: UUID.viewerStaff }],
  });
});
async function call(path: string, body: unknown, token?: string) {
  const { res, state } = makeRes();
  await handler(makeReq({ method: 'POST', familyPath: path, body, token }), res);
  return state;
}
describe('official OST handler boundary', () => {
  it.each([
    ['template', 'csv', 'text/csv;charset=utf-8', '.csv'],
    [
      'template',
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xlsx',
    ],
    ['official-template', 'csv', 'application/pdf', '.pdf'],
  ])(
    'downloads a nonblank %s %s file with the correct name and MIME',
    async (path, format, mime, extension) => {
      const { res, state } = makeRes();
      await handler(makeReq({ familyPath: path, token: TOKEN.superAdmin, query: { format } }), res);
      expect(state.status).toBe(200);
      const file = ostFileSchema.parse(state.body);
      expect(file.filename).toMatch(new RegExp(`\\${extension}$`));
      expect(file.mime).toBe(mime);
      const bytes = Buffer.from(file.content, 'base64');
      expect(bytes.length).toBeGreaterThan(100);
      if (extension === '.csv') expect(bytes.toString()).toContain('sponsor_staff_id');
      if (extension === '.xlsx') expect(bytes.subarray(0, 2).toString()).toBe('PK');
      if (extension === '.pdf') expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    },
  );
  it('requires staff authentication for manual registration', async () => {
    expect((await call('manual', {})).status).toBe(401);
  });
  it('rejects malformed manual sponsor before any RPC', async () => {
    expect(
      (
        await call(
          'manual',
          { requestId: UUID.viewerStaff, sponsorStaffId: '', identity, form },
          TOKEN.superAdmin,
        )
      ).status,
    ).toBe(400);
    expect(holder.db?.calls.some((c) => c.op === 'rpc')).toBe(false);
  });
  it('uses the pending atomic registration RPC for authorized manual entry', async () => {
    expect(
      (
        await call(
          'manual',
          { requestId: UUID.viewerStaff, sponsorStaffId: UUID.viewerStaff, identity, form },
          TOKEN.superAdmin,
        )
      ).status,
    ).toBe(201);
    const rpc = holder.db?.calls.find((c) => c.table === 'submit_ost_accreditation');
    expect(rpc?.arg).toMatchObject({
      p_actor_id: UUID.superAdminStaff,
      p_source: 'manual',
      p_code_id: null,
    });
  });
  it('rejects a public sponsor override before referral resolution', async () => {
    expect(
      (
        await call('public', {
          requestId: UUID.viewerStaff,
          referralCode: 'OST-ABCDEF-123456',
          sponsorStaffId: UUID.viewerStaff,
          identity,
          form,
        })
      ).status,
    ).toBe(400);
    expect(holder.db?.calls.some((c) => c.op === 'rpc')).toBe(false);
  });
  it('does not create an application for an unknown public referral code', async () => {
    expect(
      (
        await call('public', {
          requestId: UUID.viewerStaff,
          referralCode: 'OST-ABCDEF-123456',
          identity,
          form,
        })
      ).status,
    ).toBe(400);
    expect(holder.db?.calls.some((c) => c.op === 'rpc')).toBe(false);
  });
});
