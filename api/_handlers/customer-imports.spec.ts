import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toXlsx } from '../_lib/report-export.js';
import { CUSTOMER_IMPORT_COLUMNS } from '@jad/contracts';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const holder = vi.hoisted(() => ({ db: null as unknown }));

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
    return denied(403, 'FORBIDDEN');
  },
}));

const imports = (await import('./customer-imports.js')).default;

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
    rpcs: options.rpcs ?? [],
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
      headers: { authorization: `Bearer ${opts.token ?? 'import-admin-token'}` },
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
  mobile: '+639171234567',
  source_status: 'Pending',
  ...overrides,
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

  it('serves stable XLSX and CSV templates', async () => {
    const xlsx = await call({ path: 'template/xlsx' });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as { mime: string }).mime).toContain('spreadsheetml');
    const csv = await call({ path: 'template/csv' });
    expect(csv.status).toBe(200);
    expect(
      Buffer.from((csv.body as { content: string }).content, 'base64').toString('utf8'),
    ).toContain('membership_number');
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
        'first_name,last_name,email,mobile,source_status,vip_tier\nMaría,DELA PEÑA,bad-email,12,Active,Diamond\n',
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
            'first_name,last_name,email,mobile,source_status\nSheet,User,sheet.user@example.com,0917000001,Pending\n',
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
            'first_name,last_name,email,mobile,source_status\nJuan,Cruz,j@example.com,0917000001,Pending\nBad,Row,not-an-email,1,Pending\n',
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
            'first_name,last_name,email,mobile,source_status\nJuan,Cruz,j@example.com,0917000001,Pending\n',
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
  const response = await call({ path: `jobs/${job}/confirm`, method: 'POST' });
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
