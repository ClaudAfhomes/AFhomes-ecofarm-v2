import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toXlsx } from '../_lib/report-export.js';
import { companyWorkbook } from '../_lib/customer-workbook-export.js';
import { CUSTOMER_IMPORT_COLUMNS } from '@afhomes/contracts';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown, proofBytes: new Uint8Array() }));
vi.mock('../_lib/storage.js', () => ({
  storageClient: () => ({}),
  createUploadGrant: vi.fn(),
  createDownloadGrant: vi.fn(),
  downloadObject: async () => ({ bytes: holder.proofBytes }),
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

vi.mock('../_lib/afhomes-access.js', () => ({
  authorizeAfHomes: async (
    req: { headers?: Record<string, string> },
    moduleKey?: string,
    _action?: string,
  ) => {
    const token = req.headers?.authorization ?? '';
    const denied = (status: number, code: string) => ({
      error: { error: { code, message: 'Denied' }, status },
    });
    if (!token.replace(/^Bearer\s*/, '').trim()) return denied(401, 'UNAUTHORIZED');
    if (moduleKey === 'governance.customer_import')
      return token.includes('import-admin')
        ? { userId: 'aaaaaaaa-0000-4000-8000-000000000001', roleSlug: 'admin' }
        : denied(403, 'FORBIDDEN');
    if (moduleKey === 'sales.customers' && token.includes('customer-view'))
      return { userId: 'aaaaaaaa-0000-4000-8000-000000000001', roleSlug: 'admin' };
    if (moduleKey === 'finance.payment_verification' && token.includes('finance'))
      return { userId: 'aaaaaaaa-0000-4000-8000-000000000001', roleSlug: 'admin' };
    return denied(403, 'FORBIDDEN');
  },
}));

const imports = (await import('./customer-imports.js')).default;

it('does not authorize populated PII export with import permission alone', async () => {
  install({}, { rpcs: [{ fn: 'customer_directory', result: [] }] });
  expect((await call({ path: 'export/csv', token: 'import-admin-token' })).status).toBe(403);
});

it('keeps raw TIN out of persisted-row and initial preview responses', async () => {
  install();
  const parsed = await call({
    path: 'parse',
    method: 'POST',
    body: {
      source: 'excel',
      contentBase64: Buffer.from(
        companyWorkbook([
          {
            first_name: 'Synthetic',
            last_name: 'Customer',
            email: 'synthetic-private@example.invalid',
            mobile: '09123456789',
            tin: '123-456-789',
          },
        ]),
      ).toString('base64'),
    },
  });
  expect(parsed.status).toBe(201);
  expect(JSON.stringify(parsed.body)).not.toContain('123-456-789');
  const job = (parsed.body as { job: { id: string } }).job.id;
  const fetched = await call({ path: `jobs/${job}/rows` });
  expect(JSON.stringify(fetched.body)).not.toContain('123-456-789');
});

it('rejects a client-supplied actor on recovery confirmation', async () => {
  install();
  const result = await call({
    path: 'rows/11111111-1111-4111-8111-111111111111/continuation',
    method: 'POST',
    body: {
      requestId: '22222222-2222-4222-8222-222222222222',
      expectedSourceHash: 'a'.repeat(64),
      expectedTargetVersion: 'b'.repeat(64),
      actorId: '33333333-3333-4333-8333-333333333333',
    },
  });
  expect(result.status).toBe(400);
});

it('returns a review conflict when current customer data changed after preview', async () => {
  const db = install();
  db.rpcErrors.continue_customer_import_once = { code: 'P0001', message: 'IMPORT_TARGET_CHANGED' };
  const result = await call({
    path: 'rows/11111111-1111-4111-8111-111111111111/continuation',
    method: 'POST',
    body: {
      requestId: '22222222-2222-4222-8222-222222222222',
      expectedSourceHash: 'a'.repeat(64),
      expectedTargetVersion: 'b'.repeat(64),
    },
  });
  expect(result.status).toBe(409);
  expect(db.calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op))).toEqual([]);
});

it('lists scoped continuation actions using only the verified server actor', async () => {
  const db = install({}, { rpcs: [{ fn: 'customer_import_continuations', result: [] }] });
  const result = await call({
    path: 'continuations',
    query: { customerId: '11111111-1111-4111-8111-111111111111' },
  });
  expect(result.status).toBe(200);
  expect(
    db.calls.find((c) => c.op === 'rpc' && c.table === 'customer_import_continuations')?.arg,
  ).toMatchObject({
    p_actor_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    p_customer_id: '11111111-1111-4111-8111-111111111111',
  });
});

it('requires Finance permission to reconcile imported claims', async () => {
  const db = install();
  const result = await call({
    path: 'payment-claims/11111111-1111-4111-8111-111111111111/reconcile',
    method: 'POST',
    body: {},
  });
  expect(result.status).toBe(403);
  expect(db.calls.filter((c) => c.op === 'rpc')).toEqual([]);
});

it('rejects receipt bytes with the wrong MIME signature before marking proof uploaded', async () => {
  const proofId = '22222222-2222-4222-8222-222222222222';
  const db = install(
    {},
    {
      rpcs: [
        {
          fn: 'import_claim_proof',
          result: {
            proofDocumentId: proofId,
            bucket: 'afhomes-payment-receipts',
            path: 'synthetic/receipt.png',
            mime: 'image/png',
            uploaded: false,
          },
        },
        { fn: 'complete_import_claim_proof', result: null },
      ],
    },
  );
  holder.proofBytes = new TextEncoder().encode('not actually an image');
  const result = await call({
    path: 'payment-claims/11111111-1111-4111-8111-111111111111/proof/complete',
    method: 'POST',
    token: 'import-admin-customer-view-finance-token',
    body: { proofDocumentId: proofId },
  });
  expect(result.status).toBe(400);
  expect(db.calls.filter((c) => c.table === 'complete_import_claim_proof')).toEqual([]);
});
it('rejects a replaced receipt proof and hashes verified bytes using only the server actor', async () => {
  const proofId = '22222222-2222-4222-8222-222222222222';
  const db = install(
    {},
    {
      rpcs: [
        {
          fn: 'import_claim_proof',
          result: {
            proofDocumentId: proofId,
            bucket: 'afhomes-payment-receipts',
            path: 'synthetic/receipt.png',
            mime: 'image/png',
            uploaded: false,
          },
        },
        { fn: 'complete_import_claim_proof', result: null },
      ],
    },
  );
  holder.proofBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const path = 'payment-claims/11111111-1111-4111-8111-111111111111/proof/complete',
    token = 'import-admin-customer-view-finance-token';
  expect(
    (
      await call({
        path,
        method: 'POST',
        token,
        body: { proofDocumentId: '33333333-3333-4333-8333-333333333333' },
      })
    ).status,
  ).toBe(409);
  expect(db.calls.filter((c) => c.table === 'complete_import_claim_proof')).toEqual([]);
  expect(
    (await call({ path, method: 'POST', token, body: { proofDocumentId: proofId } })).status,
  ).toBe(200);
  expect(db.calls.find((c) => c.table === 'complete_import_claim_proof')?.arg).toMatchObject({
    p_actor_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    p_proof_id: proofId,
    p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});

function install(
  tables: Record<string, unknown[]> = {},
  options: { rpcs?: { fn: string; result: unknown }[] } = {},
) {
  holder.db = new FakeSupabase({
    tables: {
      card_plans: [],
      customers: [],
      memberships: [],
      card_sales: [],
      payments: [],
      staff_users: [],
      referral_codes: [],
      customer_import_jobs: [],
      customer_import_rows: [],
      audit_events: [],
      ...tables,
    } as never,
    rpcs: [
      ...(options.rpcs ?? []),
      {
        fn: 'prepare_customer_import_batch',
        result: (args: Record<string, unknown>) =>
          (args.p_row_ids as string[]).map((rowId) => {
            const preview = {
              rowId,
              sourceId: null,
              customerId: null,
              applicationId: null,
              reservationId: null,
              saleId: null,
              stage: 'application',
              missingRequirements: ['Application review'],
              conflicts: [],
              proposedFields: [],
              nextAction: {
                label: 'Complete imported application',
                path: '/admin/customers/applications/new',
              },
              expectedSourceHash: 'a'.repeat(64),
              expectedTargetVersion: 'b'.repeat(64),
              claimCount: 0,
            };
            const row = (holder.db as FakeSupabase)
              .rows('customer_import_rows')
              .find((r) => r.id === rowId);
            if (row) (row.normalized_data as Record<string, unknown>).continuationPreview = preview;
            return preview;
          }),
      },
    ],
  });
  return holder.db as FakeSupabase;
}

async function call(opts: {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string>;
}) {
  const { res, state } = makeRes();
  await (imports as (req: unknown, res: unknown) => Promise<void>)(
    makeReq({
      method: opts.method ?? 'GET',
      familyPath: opts.path,
      body: opts.body,
      query: opts.query,
      headers: { authorization: `Bearer ${opts.token ?? 'import-admin-customer-view-token'}` },
    }) as never,
    res as never,
  );
  return state as { status: number; body: unknown };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const xlsxOf = (rows: Record<string, string>[]) =>
  b64(
    toXlsx(
      'Customer Import',
      CUSTOMER_IMPORT_COLUMNS.map((label) => ({ label, type: 'text' as const })),
      rows.map((r) => CUSTOMER_IMPORT_COLUMNS.map((h) => r[h] ?? '')),
    ),
  );

const pendingRow = (overrides: Record<string, string> = {}) => ({
  first_name: 'Juan',
  last_name: 'Cruz',
  email: 'juan.cruz@example.com',
  mobile: '09171234567',
  source_status: 'Pending',
  ...overrides,
});

describe('company XLSX/XLSM preview', () => {
  it('marks a failed preview persistence job as failed without writing customers', async () => {
    const db = install();
    db.writeErrors.customer_import_rows = { message: 'synthetic row storage failure' };
    const response = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(
          Buffer.from(
            'first_name,last_name,email,mobile,source_status\nSynthetic,Customer,synthetic@example.invalid,09123456789,Pending\n',
          ),
        ),
      },
    });
    expect(response.status).toBe(500);
    expect(db.tables.customer_import_jobs[0]).toMatchObject({ status: 'failed' });
    expect(db.tables.customers).toHaveLength(0);
  });
  it('persists 5,000 rows in batches and serves bounded preview pages', async () => {
    const db = install();
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      first_name: 'Synthetic',
      last_name: 'Customer',
      email: `synthetic${i}@example.invalid`,
      mobile: '09123456789',
      stated_status: 'Pending',
    }));
    const response = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'excel', contentBase64: b64(companyWorkbook(rows)) },
    });
    expect(response.status).toBe(201);
    const body = response.body as { job: { id: string; totalRows: number }; rows: unknown[] };
    expect(body.job.totalRows).toBe(5000);
    expect(body.rows).toHaveLength(10);
    expect(db.tables.customer_import_rows).toHaveLength(5000);
    const page = await call({
      path: 'jobs/' + body.job.id,
      query: { offset: '4990', limit: '10' },
    });
    expect(page.status).toBe(200);
    expect((page.body as { rows: { rowNumber: number }[] }).rows.at(-1)?.rowNumber).toBe(5001);
  }, 30000);
  it.each(['xlsx', 'xlsm'])(
    'previews an aligned %s company workbook with no financial instructions',
    async (extension) => {
      const db = install();
      const response = await call({
        path: 'parse',
        method: 'POST',
        body: {
          source: 'excel',
          sourceName: 'synthetic.' + extension,
          contentBase64: b64(
            companyWorkbook([
              {
                ...pendingRow({ mobile: '09123456789' }),
                stated_status: 'Fully Paid',
                stated_total: '60000.00',
                stated_rf: '5000.00',
                stated_payment_method: 'Gcash',
                suffix: 'N/A',
              },
            ]),
          ),
        },
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        job: { totalRows: 1, validRows: 1 },
        rows: [
          {
            rowNumber: 2,
            action: 'CREATE',
            normalized: {
              payment: null,
              requireMember: false,
              customerStatus: 'prospect',
              person: { phone: '09123456789', suffix: null },
            },
          },
        ],
      });
      expect(db.tables.customers).toHaveLength(0);
      expect(db.tables.payments).toHaveLength(0);
    },
  );
  it('previews two existing OSTs with different direct uplines in one tree, without provisioning accounts', async () => {
    const registered = [
      {
        staff_id: 'vd',
        full_name: 'Registered VD',
        role_slug: 'vice_director',
        ancestor_ids: [],
        match_count: 1,
      },
      {
        staff_id: 'ssm',
        full_name: 'Registered SSM',
        role_slug: 'senior_sales_manager',
        ancestor_ids: ['vd'],
        match_count: 1,
      },
      {
        staff_id: 'sm',
        full_name: 'Registered SM',
        role_slug: 'sales_manager',
        ancestor_ids: ['ssm', 'vd'],
        match_count: 1,
      },
      {
        staff_id: 'ref',
        full_name: 'Registered Referrer',
        role_slug: 'ost',
        ancestor_ids: ['sm', 'ssm', 'vd'],
        match_count: 1,
      },
      {
        staff_id: 'vip',
        full_name: 'Registered VIP',
        role_slug: 'ost',
        ancestor_ids: ['vd'],
        match_count: 1,
      },
    ];
    const staff = registered.map((m) => ({
      id: m.staff_id,
      full_name: m.full_name,
      status: 'active',
    }));
    const db = install(
      { staff_users: structuredClone(staff) },
      {
        rpcs: [
          { fn: 'match_company_import_staff', result: registered },
          { fn: 'get_sale_team_accreditation', result: null },
        ],
      },
    );
    const input = {
      ...pendingRow({ mobile: '09123456789' }),
      vd_name: 'Registered VD',
      ssm_name: 'Registered SSM',
      sm_name: 'Registered SM',
      referrer_name: 'Registered Referrer',
      recommender_name: 'Registered VIP',
      citizenship: 'Filipino',
      tin: '123-456-789',
    };
    const result = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'excel', contentBase64: b64(companyWorkbook([input])) },
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      job: { totalRows: 1, validRows: 1, invalidRows: 0 },
      rows: [
        {
          fields: {
            referrer_staff_id: 'ref',
            recommender_staff_id: 'vip',
            referrer_sm_staff_id: 'sm',
            recommender_vd_staff_id: 'vd',
          },
          errors: [],
        },
      ],
    });
    expect(db.tables.staff_users).toEqual(staff);
    expect(db.tables.customers).toEqual([]);
    expect(db.tables.memberships).toEqual([]);
    expect(db.tables.payments).toEqual([]);
    expect(db.calls.some((c) => ['createUser', 'inviteUserByEmail'].includes(c.op))).toBe(false);
    // A saved preview cannot authorize a changed VIP genealogy at confirmation.
    registered.push({
      staff_id: 'vd2',
      full_name: 'Other VD',
      role_slug: 'vice_director',
      ancestor_ids: [],
      match_count: 1,
    });
    registered.find((m) => m.staff_id === 'vip')!.ancestor_ids = ['vd2'];
    const jobId = (result.body as { job: { id: string } }).job.id;
    const confirmed = await call({ path: `jobs/${jobId}/confirm`, method: 'POST', body: {} });
    expect(confirmed.body).toMatchObject({ committed: 0, failed: 1 });
    expect(db.calls.some((c) => c.table === 'commit_customer_import_row')).toBe(false);
    expect(db.tables.customers).toEqual([]);
  });
  it('locates the independent incomplete TIN error at the workbook field while accepting Filipino', async () => {
    install();
    const result = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'excel',
        contentBase64: b64(
          companyWorkbook([
            { ...pendingRow({ mobile: '09123456789' }), citizenship: 'Filipino', tin: '123456' },
          ]),
        ),
      },
    });
    expect(result.status).toBe(201);
    const row = (result.body as { rows: { errors: { field: string; message: string }[] }[] })
      .rows[0]!;
    expect(row.errors).toEqual([
      { field: 'tin', message: expect.stringMatching(/6 digits.*complete 9-digit/) },
    ]);
  });
  it('marks both rows conflicting when one file repeats a strong customer identity', async () => {
    install();
    const row = { ...pendingRow({ mobile: '09123456789' }), stated_status: 'Pending' };
    const response = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'excel', contentBase64: b64(companyWorkbook([row, row])) },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      job: { totalRows: 2, validRows: 0, invalidRows: 2 },
      rows: [{ action: 'CONFLICT' }, { action: 'CONFLICT' }],
    });
  });
});

it('confirms at most 100 pending rows per request and safely resumes without replaying committed work', async () => {
  const job = 'aaaaaaaa-0000-4000-8000-000000000099';
  const customerId = 'cccccccc-0000-4000-8000-000000000001';
  const db = install({
    customer_import_jobs: [
      {
        id: job,
        source_type: 'excel',
        source_name: 'synthetic.xlsm',
        status: 'ready',
        total_rows: 101,
        valid_rows: 101,
        created_at: '2026-10-16',
        validated_at: '2026-10-16',
      },
    ],
    customer_import_rows: Array.from({ length: 101 }, (_, i) => ({
      id: 'bbbbbbbb-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      import_job_id: job,
      row_number: i + 2,
      action: 'CREATE',
      validation_status: 'valid',
      raw_data: {},
      normalized_data: {},
    })),
  });
  let calls = 0;
  db.rpcs.push({
    fn: 'commit_customer_import_row',
    result: (args: Record<string, unknown>) => {
      calls++;
      const row = db.tables.customer_import_rows!.find((r) => r.id === args.p_row_id)!;
      row.committed_at = '2026-10-16T00:00:00Z';
      row.customer_id = customerId;
      return { customerId, membershipId: null, saleId: null };
    },
  });
  const first = await call({ path: 'jobs/' + job + '/confirm', method: 'POST' });
  expect(first.body).toMatchObject({
    job: { status: 'committing', insertedRows: 100, committedAt: null },
  });
  expect(calls).toBe(100);
  const second = await call({ path: 'jobs/' + job + '/confirm', method: 'POST' });
  expect(second.body).toMatchObject({ job: { status: 'completed', insertedRows: 101 } });
  expect(calls).toBe(101);
  await call({ path: 'jobs/' + job + '/confirm', method: 'POST' });
  expect(calls).toBe(101);
});

describe('every import transport uses the canonical row validator', () => {
  it.each(['csv', 'excel', 'google_sheets'] as const)(
    '%s rejects DOB/secondary phone and normalizes preview',
    async (source) => {
      install();
      const rows = [
        pendingRow({
          first_name: 'claud',
          email: 'CLAUD@Example.COM',
          vip_tier: 'GOLD',
          secondary_mobile: '09171234567',
        }),
        pendingRow({ birth_date: '2099-01-01', email: 'future@example.com' }),
        pendingRow({
          birth_date: `${new Date().getUTCFullYear() - 121}-01-01`,
          email: 'old@example.com',
        }),
        pendingRow({ birth_date: '1990-02-30', email: 'calendar@example.com' }),
        pendingRow({ vip_tier: 'GOLD', secondary_mobile: 'PHONE123', email: 'phone@example.com' }),
      ];
      const csv = [
        CUSTOMER_IMPORT_COLUMNS.join(','),
        ...rows.map((row) =>
          CUSTOMER_IMPORT_COLUMNS.map((key) => row[key as keyof typeof row] ?? '').join(','),
        ),
      ].join('\n');
      if (source === 'google_sheets')
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response(csv, { headers: { 'Content-Type': 'text/csv' } })),
        );
      const result = await call({
        path: 'parse',
        method: 'POST',
        body:
          source === 'google_sheets'
            ? {
                source,
                sheetUrl: 'https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit#gid=0',
              }
            : { source, contentBase64: source === 'excel' ? xlsxOf(rows) : b64(Buffer.from(csv)) },
      });
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({
        job: { validRows: 1, invalidRows: 4 },
        rows: [
          expect.objectContaining({
            fields: expect.objectContaining({
              first_name: 'Claud',
              email: 'claud@example.com',
              secondary_mobile: '09171234567',
            }),
            validation: 'valid',
          }),
          ...Array.from({ length: 4 }, () => expect.objectContaining({ validation: 'error' })),
        ],
      });
      vi.unstubAllGlobals();
    },
  );
});

describe('customer import/export handler', () => {
  beforeEach(() => {
    install({
      card_plans: [{ id: 'plan-gold', code: 'GOLD', is_active: true }],
    });
    vi.unstubAllGlobals();
  });

  it('refuses anonymous and unauthorized callers before reading anything', async () => {
    expect((await call({ path: 'template/xlsx', token: '' })).status).toBe(401);
    expect((await call({ path: 'template/xlsx', token: 'seller-token' })).status).toBe(403);
    expect(
      (
        await call({
          path: 'parse',
          method: 'POST',
          token: 'seller-token',
          body: { source: 'csv' },
        })
      ).status,
    ).toBe(403);
  });

  it('serves the sectioned membership template as XLSX and banded CSV', async () => {
    const xlsx = await call({ path: 'template/xlsx' });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as { mime: string }).mime).toContain('spreadsheetml');
    expect((xlsx.body as { filename: string }).filename).toBe('customer-workflow-template.xlsx');
    const csv = await call({ path: 'template/csv' });
    expect(csv.status).toBe(200);
    expect((csv.body as { mime: string }).mime).toBe('text/csv');
    expect((csv.body as { filename: string }).filename).toBe('membership-template.csv');
    const lines = Buffer.from((csv.body as { content: string }).content, 'base64')
      .toString('utf8')
      .replace(/^\ufeff/, '')
      .split('\r\n');
    expect(lines[0]).toContain('Primary');
    expect(lines[0]).toContain('Package');
    expect(lines[1]).toContain('FIRST NAME');
    expect(lines[1]).toContain('BARANGGAY');
    expect(lines[1]).toContain('SVD (NAME)');
  });

  it('parses a valid XLSX into a committable preview without writing customers', async () => {
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'excel', contentBase64: xlsxOf([pendingRow()]), sourceName: 'members.xlsx' },
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      job: { status: string; validRows: number };
      rows: { action: string }[];
    };
    expect(body.job.status).toBe('ready');
    expect(body.job.validRows).toBe(1);
    expect(body.rows[0]!.action).toBe('CREATE');
    expect((holder.db as FakeSupabase).tables['customers']).toHaveLength(0);
  });

  it('parses CSV with UTF-8 names and surfaces per-field errors', async () => {
    const csv = b64(
      Buffer.from(
        'first_name,last_name,email,mobile,source_status,vip_tier\nMarÃ­a,DELA PEÃ‘A,bad-email,12,Active,Diamond\n',
        'utf8',
      ),
    );
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'csv', contentBase64: csv },
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      job: { status: string };
      rows: { errors: { field: string }[]; action: string }[];
    };
    expect(body.job.status).toBe('validated');
    const fields = body.rows[0]!.errors.map((e) => e.field);
    expect(fields).toContain('email');
    expect(fields).toContain('mobile');
    expect(fields).toContain('vip_tier');
    expect(body.rows[0]!.action).toBe('CONFLICT');
  });

  it('rejects oversized imports with a clear error', async () => {
    const header = 'first_name,last_name,email,mobile,source_status\n';
    const lines = Array.from(
      { length: 5001 },
      (_, i) => `A,B,a${i}@example.com,0917000000,Pending`,
    ).join('\n');
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'csv', contentBase64: b64(Buffer.from(header + lines, 'utf8')) },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid workbooks and non-sheet URLs', async () => {
    const bad = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'excel', contentBase64: b64(new Uint8Array([1, 2, 3])) },
    });
    expect(bad.status).toBe(400);
    const url = await call({
      path: 'parse',
      method: 'POST',
      body: { source: 'google_sheets', sheetUrl: 'https://evil.com/x' },
    });
    expect(url.status).toBe(400);
  });

  it('reads a link-readable Google Sheet through the export URL only', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        seen.push(String(input));
        return {
          ok: true,
          headers: { get: () => 'text/csv' },
          body: new Response(
            'first_name,last_name,email,mobile,source_status\nSheet,User,sheet.user@example.com,09170000001,Pending\n',
          ).body,
        };
      }),
    );
    const res = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'google_sheets',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit#gid=0',
      },
    });
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/export?format=csv');
    expect(seen[0]).not.toContain('evil.com');
  });

  it('confirms valid rows through the legacy RPC and counts the rest', async () => {
    install(
      { card_plans: [{ id: 'plan-gold', code: 'GOLD', is_active: true }] },
      {
        rpcs: [
          {
            fn: 'commit_customer_import_row',
            result: {
              customerId: '11111111-1111-4111-8111-111111111111',
              saleId: null,
              membershipId: null,
              membershipNumber: null,
            },
          },
        ],
      },
    );
    const parsed = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(
          Buffer.from(
            'first_name,last_name,email,mobile,source_status\nJuan,Cruz,j@example.com,09170000001,Pending\nBad,Row,not-an-email,1,Pending\n',
            'utf8',
          ),
        ),
      },
    });
    const jobId = (parsed.body as { job: { id: string } }).job.id;
    const done = await call({ path: `jobs/${jobId}/confirm`, method: 'POST', body: {} });
    expect(done.status).toBe(200);
    const body = done.body as { committed: number; failed: number; job: { status: string } };
    expect(body.committed).toBe(1);
    expect(body.job.status).toBe('completed_with_errors');
    expect(body.failed).toBe(1);
  });

  it('cancels a validated job and refuses to confirm it afterwards', async () => {
    const parsed = await call({
      path: 'parse',
      method: 'POST',
      body: {
        source: 'csv',
        contentBase64: b64(
          Buffer.from(
            'first_name,last_name,email,mobile,source_status\nJuan,Cruz,j@example.com,09170000001,Pending\n',
            'utf8',
          ),
        ),
      },
    });
    const jobId = (parsed.body as { job: { id: string } }).job.id;
    expect((await call({ path: `jobs/${jobId}/cancel`, method: 'POST', body: {} })).status).toBe(
      200,
    );
    expect((await call({ path: `jobs/${jobId}/confirm`, method: 'POST', body: {} })).status).toBe(
      409,
    );
  });

  it('lists jobs and exports filtered customers without secrets', async () => {
    install({
      card_plans: [{ id: 'plan-gold', code: 'GOLD', is_active: true }],
      customers: [
        {
          id: 'cus-1',
          customer_number: 'CUS-1',
          first_name: 'Juan',
          last_name: 'Cruz',
          email: 'j@example.com',
          phone: '0917',
          status: 'active',
          created_at: '2026-10-01T00:00:00.000Z',
        },
      ],
      memberships: [
        {
          id: 'mem-1',
          customer_id: 'cus-1',
          sale_id: 'sale-1',
          membership_number: 'MBS-000001',
          product_id: 'plan-gold',
          status: 'active',
          points_balance: 25000,
          activated_at: '2026-10-02T00:00:00.000Z',
          expires_at: '2048-10-02T00:00:00.000Z',
        },
      ],
      card_sales: [
        {
          id: 'sale-1',
          customer_id: 'cus-1',
          status: 'active',
          plan_id: 'plan-gold',
          cash_price_snapshot: '312000.00',
          reservation_fee_snapshot: '10000.00',
          required_initial_snapshot: '10000.00',
          seller_staff_id: 'staff-1',
        },
      ],
      payments: [{ sale_id: 'sale-1', amount: '312000.00', status: 'verified' }],
      staff_users: [{ id: 'staff-1', full_name: '=VD Evil' }],
      points_accounts: [{ membership_id: 'mem-1', balance: 25000 }],
    });
    const jobs = await call({ path: 'jobs' });
    expect(jobs.status).toBe(200);
    const exp = await call({ path: 'export/xlsx', query: { category: 'Active VIP' } });
    expect(exp.status).toBe(200);
    const csv = await call({ path: 'export/csv' });
    expect(csv.status).toBe(200);
    const text = Buffer.from((csv.body as { content: string }).content, 'base64').toString('utf8');
    expect(text).toContain('MBS-000001');
    // Formula-leading seller name is neutralized, never executable.
    expect(text).toContain("'=VD Evil");
    const both = await call({ path: 'export/csv', query: { tier: 'SILVER' } });
    expect(both.status).toBe(200);
  });
});

it('resumes a committing job and reports 495 successes plus 5 invalid rows consistently', async () => {
  const job = 'aaaaaaaa-0000-4000-8000-000000000090';
  const rows = Array.from({ length: 500 }, (_, i) => ({
    id: 'bbbbbbbb-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
    import_job_id: job,
    row_number: i + 1,
    action: i < 495 ? 'CREATE' : 'CONFLICT',
    validation_status: i < 495 ? 'valid' : 'error',
    normalized_data: {},
  }));
  const db = install(
    {
      customer_import_jobs: [
        {
          id: job,
          source_type: 'csv',
          source_name: 'resume.csv',
          status: 'committing',
          total_rows: 500,
          valid_rows: 495,
          invalid_rows: 5,
          created_at: '2026-10-01',
          validated_at: '2026-10-01',
        },
      ],
      customer_import_rows: rows,
    },
    {
      rpcs: [
        {
          fn: 'commit_customer_import_row',
          result: {
            customerId: 'cccccccc-0000-4000-8000-000000000001',
            membershipId: null,
            saleId: null,
          },
        },
      ],
    },
  );
  db.rpcs[0]!.result = (args: Record<string, unknown>) => {
    const row = db.tables.customer_import_rows!.find((entry) => entry.id === args.p_row_id)!;
    row.committed_at = '2026-10-16T00:00:00Z';
    row.customer_id = 'cccccccc-0000-4000-8000-000000000001';
    return { customerId: row.customer_id, membershipId: null, saleId: null };
  };
  let response = await call({ path: `jobs/${job}/confirm`, method: 'POST' });
  while ((response.body as { job: { status: string } }).job.status === 'committing')
    response = await call({ path: `jobs/${job}/confirm`, method: 'POST' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    committed: 495,
    failed: 5,
    job: {
      status: 'completed_with_errors',
      totalRows: 500,
      validRows: 495,
      invalidRows: 5,
      insertedRows: 495,
      updatedRows: 0,
      skippedRows: 0,
      failedRows: 5,
    },
  });
  expect(db.tables.customer_import_jobs[0]).toMatchObject({
    status: 'completed_with_errors',
    failed_rows: 5,
  });
  expect((await call({ path: `jobs/${job}/confirm`, method: 'POST' })).status).toBe(200);
});

it('loads every import row across server pages before completing a large job', async () => {
  const job = 'aaaaaaaa-0000-4000-8000-000000000091';
  install({
    customer_import_jobs: [
      {
        id: job,
        source_type: 'csv',
        source_name: 'large.csv',
        status: 'committing',
        total_rows: 1500,
        valid_rows: 1500,
        invalid_rows: 0,
        created_at: '2026-10-01',
        validated_at: '2026-10-01',
      },
    ],
    customer_import_rows: Array.from({ length: 1500 }, (_, i) => ({
      id: 'bbbbbbbb-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      import_job_id: job,
      row_number: i + 1,
      action: 'SKIP',
      validation_status: 'valid',
      normalized_data: {},
    })),
  });
  const response = await call({ path: 'jobs/' + job + '/confirm', method: 'POST' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    failed: 0,
    job: { status: 'completed', totalRows: 1500, skippedRows: 1500, validRows: 1500 },
  });
});
