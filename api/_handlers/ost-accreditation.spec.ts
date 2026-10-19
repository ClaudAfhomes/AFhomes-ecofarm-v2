import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  phase2World,
  phase2WorldTokens,
  TOKEN,
  TOKEN2,
  UUID,
  STAFF2,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { ostFileSchema } from '@afhomes/contracts';
import { OST_IMPORT_COLUMNS } from '../_lib/ost-import.js';
import { toCsv } from '../_lib/report-export.js';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
const provider = vi.hoisted(() => ({
  provinces: vi.fn(),
  provincesInRegion: vi.fn(),
  localities: vi.fn(),
  barangays: vi.fn(),
}));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
vi.mock('../_lib/address-source.js', () => ({ addressProvider: () => provider }));
const handler = (await import('./ost-accreditation.js')).default;
const form = {
  dateApplied: '2026-01-01',
  programCategory: 'non_vip',
  sex: 'male',
  civilStatus: 'single',
  governmentIdType: 'philippine_id',
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
  const tables = phase2World({});
  tables.modules = [
    ...(tables.modules ?? []),
    { id: 'fafafafa-0000-4000-8000-000000000001', key: 'network.members', is_active: true },
  ];
  holder.db = new FakeSupabase({
    tables: { ...tables, referral_codes: [] },
    tokens: phase2WorldTokens(),
    rpcs: [
      { fn: 'submit_ost_accreditation', result: UUID.viewerStaff },
      { fn: 'update_ost_applicant', result: UUID.viewerStaff },
    ],
  });
  provider.provinces.mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]);
  provider.provincesInRegion.mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]);
  provider.localities.mockResolvedValue([
    {
      code: '0403406000',
      name: 'Calauan',
      type: 'municipality',
      provinceCode: '0403400000',
      postalCode: '4000',
    },
  ]);
  provider.barangays.mockResolvedValue([
    { code: '0403406003', name: 'Dayap', localityCode: '0403406000' },
  ]);
});
async function call(path: string, body: unknown, token?: string) {
  const { res, state } = makeRes();
  await handler(makeReq({ method: 'POST', familyPath: path, body, token }), res);
  return state;
}
describe('official OST handler boundary', () => {
  it.each([false, true])(
    'keeps OST password setup safe when activation fails=%s',
    async (activationFails) => {
      const db = holder.db!;
      db.rows('ost_applications').push({
        id: UUID.viewerStaff,
        email: identity.email,
        first_name: 'QA',
        last_name: 'OST',
        status: 'submitted',
      });
      db.rpcs.push(
        {
          fn: 'ost_accreditation_records',
          result: {
            registration: {
              endorsed_at: '2026-01-01',
              applicant_signature_status: 'received',
              referrer_signature_status: 'received',
            },
          },
        },
        {
          fn: 'install_ost_accreditation_identity',
          result: (args: Record<string, unknown>) => {
            db.rows('staff_users').push({ id: args.p_auth_id, status: 'invited' });
            if (activationFails)
              db.writeErrors.staff_users = { message: 'Synthetic activation failure' };
            return args.p_auth_id;
          },
        },
      );
      const path = `applications/${UUID.viewerStaff}/approve`;
      expect(
        (await call(path, { startsOn: '2026-01-01', expiresOn: '2027-01-01' }, TOKEN.superAdmin))
          .status,
      ).toBe(400);
      expect(db.createdAuthUsers).toHaveLength(0);
      const result = await call(
        path,
        { startsOn: '2026-01-01', expiresOn: '2027-01-01', temporaryPassword: 'TempPass123' },
        TOKEN.superAdmin,
      );
      expect(result.status).toBe(activationFails ? 500 : 201);
      const created = db.createdAuthUsers[0]!;
      expect(db.rows('staff_users').find((r) => r.id === created.id)).toMatchObject({
        status: activationFails ? 'invited' : 'active',
      });
      if (!activationFails)
        expect(db.rows('staff_users').find((r) => r.id === created.id)?.must_change_password).toBe(
          true,
        );
      else expect(JSON.stringify(result.body)).toContain('reconciliation');
      expect(db.passwordsSeen).toEqual(['TempPass123']);
      expect(db.calls.some((c) => c.op === 'inviteUserByEmail')).toBe(false);
      expect(JSON.stringify(db.rows('audit_events'))).not.toContain('TempPass123');
    },
  );
  it.each(['sponsors', 'imports/parse'])(
    'uses the member role relationship and accepts its one-to-one shape: %s',
    async (path) => {
      const tables = phase2World({});
      for (const assignment of tables.staff_role_assignments ?? [])
        assignment.roles = tables.roles?.find((role) => role.id === assignment.role_id);
      const db = new FakeSupabase({
        tables,
        tokens: phase2WorldTokens(),
        errors: {
          'staff_users.id,full_name,status,staff_role_assignments(roles(slug,is_active))': {
            code: 'PGRST201',
            message: 'Ambiguous sponsor relationship',
          },
          'staff_users.id,status,staff_role_assignments(roles(slug,is_active))': {
            code: 'PGRST201',
            message: 'Ambiguous sponsor relationship',
          },
        },
        links: [
          { child: 'staff_role_assignments', parent: 'staff_users', fk: 'assigned_by' },
          { child: 'staff_role_assignments', parent: 'staff_users', fk: 'staff_id' },
        ],
        rpcs: [
          {
            fn: 'list_ost_manual_sponsors',
            result: [{ id: STAFF2.salesManager, name: 'Sales Manager' }],
          },
          { fn: 'stage_ost_import', result: UUID.viewerStaff },
          { fn: 'ost_import_preview', result: { id: UUID.viewerStaff } },
        ],
      });
      holder.db = db;
      const fields: Record<string, string> = {
        first_name: 'QA',
        last_name: 'TESTER',
        email: 'new-sponsor-check@example.invalid',
        mobile: '09171234567',
        birth_date: '1990-01-01',
        address: 'QA STREET',
        city: 'QA CITY',
        province: 'QA PROVINCE',
        sponsor_staff_id: STAFF2.salesManager,
        date_applied: '2026-01-01',
        program_category: 'non_vip',
        sex: 'male',
        civil_status: 'single',
        government_id_type: 'philippine_id',
        government_id_number: 'SYNTHETIC',
      };
      const { res, state } = makeRes();
      await handler(
        makeReq({
          familyPath: path,
          token: TOKEN.superAdmin,
          method: path === 'sponsors' ? 'GET' : 'POST',
          body: {
            source: 'csv',
            sourceName: 'qa.csv',
            mime: 'text/csv',
            contentBase64: Buffer.from(
              toCsv(
                [...OST_IMPORT_COLUMNS],
                [OST_IMPORT_COLUMNS.map((column) => fields[column] ?? '')],
              ),
            ).toString('base64'),
          },
        }),
        res,
      );
      expect(state.status).toBe(path === 'sponsors' ? 200 : 201);
      if (path === 'sponsors')
        expect(state.body).toMatchObject({
          data: expect.arrayContaining([expect.objectContaining({ id: STAFF2.salesManager })]),
        });
      else
        expect(db.calls.find((call) => call.table === 'stage_ost_import')?.arg).toMatchObject({
          p_rows: [expect.objectContaining({ status: 'valid', errors: [] })],
        });
      expect(db.calls.some((call) => call.op === 'insert' || call.op === 'update')).toBe(false);
      if (path === 'sponsors')
        expect(db.calls.find((c) => c.table === 'list_ost_manual_sponsors')?.arg).toEqual({
          p_actor: UUID.superAdminStaff,
        });
    },
  );
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
  it('rejects SSM as the sponsor of manual registration before mutation', async () => {
    expect(
      (
        await call(
          'manual',
          {
            requestId: UUID.viewerStaff,
            sponsorStaffId: STAFF2.seniorSalesManager,
            identity,
            form,
          },
          TOKEN.superAdmin,
        )
      ).status,
    ).toBe(409);
    expect(holder.db?.calls.some((c) => c.table === 'submit_ost_accreditation')).toBe(false);
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
    expect(
      holder.db?.calls.some((c) => c.op === 'rpc' && c.table !== 'afhomes_admin_mfa_required'),
    ).toBe(false);
  });
  it('uses the pending atomic registration RPC for authorized manual entry', async () => {
    expect(
      (
        await call(
          'manual',
          { requestId: UUID.viewerStaff, sponsorStaffId: STAFF2.salesManager, identity, form },
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

describe('controlled applicant corrections', () => {
  const correction = {
    requestId: 'f0a0a0a0-1111-4111-8111-000000000001',
    fullName: 'Maria Santos-Reyes',
    birthDate: '1990-01-01',
    phone: '09171234567',
    sex: 'female',
    civilStatus: 'married',
    messenger: '',
    employerName: '',
    jobPosition: '',
    reason: 'MARRIAGE CERTIFICATE VERIFIED',
  };
  const path = `members/${STAFF2.ost}/applicant`;
  it('records a verified correction through the ledger RPC for management', async () => {
    const state = await call(path, correction, TOKEN.superAdmin);
    expect(state.status).toBe(200);
    expect(state.body).toEqual({ id: UUID.viewerStaff });
    const rpc = holder.db?.calls.find((c) => c.table === 'update_ost_applicant');
    const args = rpc?.arg as
      { p_actor_id?: string; p_ost_id?: string; p_input?: { address?: unknown } } | undefined;
    expect(args).toMatchObject({ p_actor_id: UUID.superAdminStaff, p_ost_id: STAFF2.ost });
    expect(args?.p_input).toMatchObject({
      phone: '+639171234567',
      civilStatus: 'married',
      reason: 'MARRIAGE CERTIFICATE VERIFIED',
    });
    expect(args?.p_input?.address).toBeUndefined();
  });
  it('stores the reference spelling and codes when the address is re-verified', async () => {
    const state = await call(
      path,
      {
        ...correction,
        address: {
          line1: 'QA STREET',
          city: 'submitted',
          province: 'submitted',
          countryCode: 'PH',
        },
        addressHierarchy: {
          regionCode: '0400000000',
          provinceCode: '0403400000',
          localityCode: '0403406000',
          barangayCode: '0403406003',
        },
      },
      TOKEN.superAdmin,
    );
    expect(state.status).toBe(200);
    const rpc = holder.db?.calls.find((c) => c.table === 'update_ost_applicant');
    const args = rpc?.arg as { p_input?: Record<string, unknown> } | undefined;
    expect(args?.p_input).toMatchObject({
      address: {
        line1: 'QA STREET',
        city: 'Calauan',
        province: 'Laguna',
        barangay: 'Dayap',
        postalCode: '4000',
        regionCode: '0400000000',
        provinceCode: '0403400000',
        localityCode: '0403406000',
        barangayCode: '0403406003',
      },
    });
  });
  it('refuses the update when the reference rejects the address', async () => {
    provider.barangays.mockResolvedValueOnce([]);
    const state = await call(
      path,
      {
        ...correction,
        address: { line1: 'QA STREET', city: 'Calauan', province: 'Laguna', countryCode: 'PH' },
        addressHierarchy: {
          regionCode: '0400000000',
          provinceCode: '0403400000',
          localityCode: '0403406000',
          barangayCode: '0403406003',
        },
      },
      TOKEN.superAdmin,
    );
    expect(state.status).toBe(400);
    expect(holder.db?.calls.some((c) => c.table === 'update_ost_applicant')).toBe(false);
  });
  it('never lets the OST member or a reviewing role edit the registered values', async () => {
    expect((await call(path, correction, TOKEN2.ost)).status).toBe(403);
    expect((await call(path, correction, TOKEN2.seniorSalesManager)).status).toBe(403);
    expect(holder.db?.calls.some((c) => c.table === 'update_ost_applicant')).toBe(false);
  });
  it('rejects an incomplete correction before any RPC', async () => {
    expect((await call(path, { ...correction, fullName: '' }, TOKEN.superAdmin)).status).toBe(400);
    expect(holder.db?.calls.some((c) => c.table === 'update_ost_applicant')).toBe(false);
  });
});
