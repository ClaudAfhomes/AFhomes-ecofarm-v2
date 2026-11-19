import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { IstPayrollPage } from './IstPayrollPage';
import { PendingPayrollApprovalsCard } from '../afhomes/PendingPayrollApprovalsCard';

const ME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const BATCH = '44444444-4444-4444-8444-444444444444';
const LINE = '55555555-5555-4555-8555-555555555555';
const LINE2 = '66666666-6666-4666-8666-666666666666';

const perm = (moduleKey: string, canCreate: boolean, canUpdate: boolean) => ({
  moduleKey,
  canView: true,
  canCreate,
  canUpdate,
  canDelete: false,
});
const userWith = (...permissions: ReturnType<typeof perm>[]) =>
  ({
    id: ME,
    email: 'f@example.test',
    fullName: 'Fae',
    afHomesRole: 'finance',
    afHomesPermissions: permissions,
  }) as unknown as SessionUser;

const FINANCE = userWith(perm('finance.payroll', true, true));
const APPROVER = userWith(
  perm('finance.payroll', false, false),
  perm('finance.payroll_approval', false, true),
);

const OPEN_GATE = {
  q1Status: 'approved',
  liveAuthorized: true,
  note: null,
  q1Source: 'owner_reported',
  q1DecisionOption: 'C',
  q1EvidenceStatus: 'awaiting_evidence',
  q1EffectiveDate: null,
};
const POLICY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let gate: Record<string, unknown>;
let batches: Record<string, unknown>[];
let lines: Record<string, unknown>[];
let approvals: Record<string, unknown>[];
let postError: { status: number; body: unknown } | null;
let roster: Record<string, unknown>[];
let policies: Record<string, unknown>[];
const calls: { url: string; method: string; body: unknown; idempotencyKey?: string | null }[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const batch = (over: Record<string, unknown> = {}) => ({
  id: BATCH,
  period: '2026-11',
  mode: 'live',
  simulationBasis: null,
  simulationTotalNet: null,
  status: 'draft',
  totalBa: '0.00',
  totalPa: '0.00',
  totalPb: '0.00',
  totalAdjustments: '0.00',
  totalWithheld: '0.00',
  totalNet: '1000.00',
  lineCount: 2,
  computedLineCount: 2,
  blockedLineCount: 0,
  createdBy: OTHER,
  createdAt: '2026-11-01T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  decidedBy: null,
  decidedAt: null,
  returnReason: null,
  closedBy: null,
  closedAt: null,
  ...over,
});

const line = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  batchId: BATCH,
  staffId: OTHER,
  staffName: 'Ana IST',
  rank: 'SM',
  status: 'computed',
  blockedReason: null,
  policyId: null,
  ba: '500.00',
  pa: '300.00',
  pb: '200.00',
  adjustments: '0.00',
  withheld: '0.00',
  net: '1000.00',
  reviewRequired: false,
  reviewFlags: [],
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  disbursement: null,
  ...over,
});

const rosterEntry = (
  id: string,
  name: string,
  aaNumber: string | null,
  over: Record<string, unknown> = {},
) => ({
  id,
  name,
  aaNumber,
  rank: 'SM',
  roleName: 'Sales Manager',
  status: 'active',
  eligible: true,
  ...over,
});

const policy = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  rank: 'SSM',
  monthlyBa: '1000.00',
  baTarget: '2000.00',
  monthlyPa: '500.00',
  paTarget: '3000.00',
  pbTarget: '4000.00',
  pbRate: '0.01',
  collectionGate: '0.8',
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  status: 'draft',
  basisNote: 'Reference draft note',
  createdBy: OTHER,
  createdAt: '2026-01-01T00:00:00Z',
  approvedBy: null,
  approvedAt: null,
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  gate = { ...OPEN_GATE };
  batches = [];
  lines = [line(LINE), line(LINE2, { staffName: 'Ben IST' })];
  approvals = [];
  roster = [
    rosterEntry('77777777-7777-4777-8777-777777777777', 'Cora Lead', 'AA-001'),
    rosterEntry('88888888-8888-4888-8888-888888888888', 'Dan Inactive', 'AA-002', {
      eligible: false,
      status: 'suspended',
      ineligibleReason: 'Staff account is suspended',
    }),
    rosterEntry('99999999-9999-4999-8999-999999999999', 'Eve Second', null),
  ];
  policies = [];
  postError = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
      });
      if (method === 'POST' && url.endsWith('/payroll/simulations'))
        return json(200, { ...(batches[0] ?? batch({ mode: 'simulation' })), lines });
      if (method === 'PUT') return json(200, { policyId: POLICY_ID, status: 'draft' });
      if (method === 'POST' && postError) return json(postError.status, postError.body);
      if (method === 'POST') return json(200, { id: BATCH, status: 'ok' });
      if (url.includes('/calculation'))
        return json(200, {
          lineId: LINE,
          batchId: BATCH,
          period: '2026-10',
          mode: 'live',
          inputs: { contractStart: '2026-01-01' },
          result: { daysInMonth: 31, ep: { days: 31 }, net: '1000.00' },
        });
      if (url.includes('/payroll/gate')) return json(200, gate);
      if (url.includes('/payroll/roster')) {
        const q = (new URL(url, 'http://x').searchParams.get('q') ?? '').toLowerCase();
        const data = roster.filter(
          (r) => !q || String(r.name).toLowerCase().includes(q) || String(r.aaNumber).includes(q),
        );
        return json(200, { data, meta: { total: data.length } });
      }
      if (url.includes('/payroll/policies'))
        return json(200, { data: policies, meta: { total: policies.length }, gate });
      if (url.includes('/payroll/approvals'))
        return json(200, { data: approvals, meta: { total: approvals.length } });
      if (url.includes(`/payroll/batches/${BATCH}`))
        return json(200, { ...(batches[0] ?? batch()), lines });
      if (url.includes('/payroll/batches'))
        return json(200, { data: batches, meta: { total: batches.length } });
      return json(200, { data: [], meta: { total: 0 } });
    }),
  );
});

const LOCKED = /Live payroll is not authorized by the server/;

describe('IST Payroll page', () => {
  it('locks live actions with the banner when the gate is closed', async () => {
    gate = { ...OPEN_GATE, q1Status: 'pending', liveAuthorized: false };
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(await screen.findByText(LOCKED, { selector: 'div' })).toBeTruthy();
    const button = await screen.findByRole('button', { name: 'Generate draft' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes Finance from an empty batch to compensation setup without approving values', async () => {
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Review compensation policies' }),
    );
    expect(
      await screen.findByText('No approved compensation policy exists yet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Policies' })).toHaveAttribute('aria-selected', 'true');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('takes a blocked draft to engagement and rule setup without submitting payroll', async () => {
    batches = [batch({ blockedLineCount: 1, lineCount: 1 })];
    lines = [
      line(LINE, {
        status: 'blocked',
        blockedReason: 'CONFIGURATION_REQUIRED: no approved engagement',
      }),
    ];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Review engagements and rules' }),
    );
    expect(screen.getByRole('tab', { name: 'Engagements & rules' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/payroll/performance-rules'))).toBe(true),
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('offers Generate draft when there is no batch and sends the period', async () => {
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    const button = await screen.findByRole('button', { name: 'Generate draft' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(button);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/payroll/batches'))).toBe(
        true,
      ),
    );
    const post = calls.find((c) => c.method === 'POST')!;
    expect((post.body as { period: string }).period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('draft: Submit for approval, disabled with a count when lines are blocked', async () => {
    batches = [batch({ blockedLineCount: 3, computedLineCount: 0, lineCount: 3 })];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    const button = await screen.findByRole('button', { name: 'Submit for approval' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('3 lines need configuration')).toBeTruthy();
  });

  it('draft: Submit for approval posts submit when clean', async () => {
    batches = [batch()];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    const button = await screen.findByRole('button', { name: 'Submit for approval' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(button);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/submit`))).toBe(
        true,
      ),
    );
  });

  it('submitted: Finance sees waiting text and no Approve', async () => {
    batches = [batch({ status: 'submitted', submittedBy: ME })];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(await screen.findByText('Waiting for Super Admin approval')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('submitted: approver sees Approve and Return with an inline reason', async () => {
    batches = [batch({ status: 'submitted', submittedBy: OTHER })];
    renderWithProviders(<IstPayrollPage />, { user: APPROVER });
    await userEvent.click(await screen.findByRole('button', { name: 'Return' }));
    await userEvent.type(await screen.findByLabelText('Reason'), 'Wrong figures');
    await userEvent.click(screen.getByRole('button', { name: 'Return batch' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/return`));
      expect(post?.body).toEqual({ reason: 'Wrong figures' });
    });
  });

  it('returned: shows the reason and Regenerate draft', async () => {
    batches = [batch({ status: 'returned', returnReason: 'Wrong figures' })];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(await screen.findByText('Wrong figures')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Regenerate draft' })).toBeTruthy();
  });

  it('approved: disbursement amount is prefilled from net and read-only', async () => {
    batches = [batch({ status: 'approved' })];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    const buttons = await screen.findAllByRole('button', { name: 'Record disbursement' });
    await userEvent.click(buttons[0]!);
    const amount = (await screen.findByLabelText(/Amount/)) as HTMLInputElement;
    expect(amount.value).toBe('1000.00');
    expect(amount.readOnly).toBe(true);
    await userEvent.type(screen.getByLabelText('Bank reference'), 'REF-123');
    await userEvent.type(
      screen.getByLabelText('Payment proof reference'),
      'TEST ONLY payment evidence',
    );
    const dialogButtons = screen.getAllByRole('button', { name: 'Record disbursement' });
    await userEvent.click(dialogButtons[dialogButtons.length - 1]!);
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith(`/lines/${LINE}/disbursements`));
      expect(post?.body).toMatchObject({
        amount: '1000.00',
        method: 'Bank transfer',
        bankReference: 'REF-123',
      });
    });
  });

  it('blocked lines show a plain-words reason', async () => {
    batches = [batch({ blockedLineCount: 1, lineCount: 1 })];
    lines = [
      line(LINE, {
        status: 'blocked',
        blockedReason: 'CONFIGURATION_REQUIRED: no approved policy for this rank',
        net: null,
        ba: null,
        pa: null,
        pb: null,
        withheld: null,
      }),
    ];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(await screen.findByText('Needs configuration')).toBeTruthy();
    expect(
      screen
        .getAllByText('No approved policy for this rank')
        .some((element) => !element.closest('details')),
    ).toBe(true);
  });

  it('simulation tab is labelled and offers no workflow action before a run', async () => {
    batches = [batch({ status: 'approved' })];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    await userEvent.click(await screen.findByRole('tab', { name: 'Simulation' }));
    expect(await screen.findByText('SIMULATION — not payable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /submit simulation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /simulated payout/i })).toBeNull();
  });

  it('live approved batch: Close batch posts close and shows the server refusal', async () => {
    batches = [batch({ status: 'approved', submittedBy: OTHER })];
    postError = {
      status: 409,
      body: { error: { code: 'conflict', message: 'Live payroll is not authorized yet.' } },
    };
    const closer = userWith(
      perm('finance.payroll', true, true),
      perm('finance.payroll_close', false, true),
    );
    renderWithProviders(<IstPayrollPage />, { user: closer });
    await userEvent.click(await screen.findByRole('button', { name: 'Close batch' }));
    expect(await screen.findByText('Live payroll is not authorized yet.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/close`))).toBe(true);
  });

  it('live approved batch: no Close without the close permission', async () => {
    batches = [batch({ status: 'approved' })];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    await screen.findAllByRole('button', { name: 'Record disbursement' });
    expect(screen.queryByRole('button', { name: 'Close batch' })).toBeNull();
  });
});

describe('Simulation workflow', () => {
  const ALL = userWith(
    perm('finance.payroll', true, true),
    perm('finance.payroll_approval', false, true),
    perm('finance.payroll_close', false, true),
  );

  const runSim = async (user = ALL) => {
    batches = [batch({ mode: 'simulation', simulationTotalNet: '2000.00', ...simOver })];
    renderWithProviders(<IstPayrollPage />, { user });
    await userEvent.click(await screen.findByRole('tab', { name: 'Simulation' }));
    await userEvent.type(
      await screen.findByLabelText(/Simulation basis note/),
      'Reference sheet 2025',
    );
    await userEvent.type(
      screen.getByLabelText('Policy version / source', { selector: '#sim-SM-version' }),
      'v1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
  };
  let simOver: Record<string, unknown>;
  beforeEach(() => {
    simOver = {};
  });

  it('loads versioned reference templates into simulation only', async () => {
    renderWithProviders(<IstPayrollPage />, { user: ALL });
    await userEvent.click(await screen.findByRole('tab', { name: 'Simulation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load SM historical reference' }));
    expect(screen.getByLabelText('PB rate (%)', { selector: '#sim-SM-pbRate' })).toHaveValue(
      '1.00',
    );
    expect(
      screen.getByLabelText('Collection gate (%)', { selector: '#sim-SM-collectionGate' }),
    ).toHaveValue('40.00');
    await userEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    await waitFor(() =>
      expect(
        calls.find((call) => call.method === 'POST' && call.url.endsWith('/payroll/simulations'))
          ?.body,
      ).toMatchObject({
        policySnapshot: {
          SM: {
            version: 'afhomes-table-a-v1',
            monthlyBa: '15000.00',
            pbRate: '0.0100',
            collectionGate: '0.4000',
          },
        },
      }),
    );
    expect(
      calls.some((call) => call.method === 'POST' && call.url.endsWith('/payroll/policies')),
    ).toBe(false);
  });

  it('draft: shows labels, status and Submit simulation, which posts submit', async () => {
    await runSim();
    expect(await screen.findByText('Draft')).toBeTruthy();
    expect(screen.getByText(/No real money or records are affected/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Submit simulation' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/submit`))).toBe(
        true,
      ),
    );
  });

  it('submitted by me: Approve is disabled with a reason', async () => {
    simOver = { status: 'submitted', submittedBy: ME };
    await runSim();
    const approve = (await screen.findByRole('button', {
      name: 'Approve simulation',
    })) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByText('You submitted this batch.')).toBeTruthy();
  });

  it('submitted by someone else: Return needs a reason and posts it', async () => {
    simOver = { status: 'submitted', submittedBy: OTHER };
    await runSim();
    await userEvent.click(await screen.findByRole('button', { name: 'Return' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'Check figures');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm return' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/return`));
      expect(post?.body).toEqual({ reason: 'Check figures' });
    });
  });

  it('approved: simulated payout uses the simulation route, never the live one', async () => {
    simOver = { status: 'approved', submittedBy: OTHER };
    await runSim();
    const buttons = await screen.findAllByRole('button', { name: 'Record simulated payout' });
    await userEvent.click(buttons[0]!);
    const amount = (await screen.findByLabelText(/Amount/)) as HTMLInputElement;
    expect(amount.value).toBe('1000.00');
    await userEvent.type(screen.getByLabelText('Bank reference'), 'SIM-1');
    const all = screen.getAllByRole('button', { name: 'Record simulated payout' });
    await userEvent.click(all[all.length - 1]!);
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'POST' && c.url.endsWith(`/simulations/lines/${LINE}/disbursements`),
        ),
      ).toBe(true),
    );
    expect(
      calls.some(
        (c) =>
          c.method === 'POST' &&
          c.url.endsWith(`/lines/${LINE}/disbursements`) &&
          !c.url.includes('/simulations/'),
      ),
    ).toBe(false);
  });

  it('approved: Close simulation posts close', async () => {
    simOver = { status: 'approved', submittedBy: OTHER };
    await runSim();
    await userEvent.click(await screen.findByRole('button', { name: 'Close simulation' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/close`))).toBe(
        true,
      ),
    );
  });
});

describe('Simulation staff picker', () => {
  const openSim = async () => {
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    await userEvent.click(await screen.findByRole('tab', { name: 'Simulation' }));
    return screen.findByRole('combobox', { name: 'Add staff' });
  };

  it('searches by name with the debounced term in the request', async () => {
    const box = await openSim();
    await userEvent.type(box, 'cora');
    await waitFor(() => expect(calls.some((c) => c.url.includes('roster?q=cora'))).toBe(true));
    expect(await screen.findByText('Cora Lead')).toBeTruthy();
    expect(screen.queryByText('Eve Second')).toBeNull();
  });

  it('shows ineligible staff disabled with the reason and does not select them', async () => {
    await openSim();
    const row = (await screen.findByText('Dan Inactive')).closest('li')!;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Staff account is suspended')).toBeTruthy();
    await userEvent.click(row);
    expect(screen.queryByRole('button', { name: /Remove Dan/ })).toBeNull();
  });

  it('Enter picks the first eligible match, then blocks a duplicate', async () => {
    const box = await openSim();
    await screen.findByText('Cora Lead');
    await userEvent.type(box, '{Enter}');
    expect(await screen.findByRole('button', { name: 'Remove Cora Lead (SM)' })).toBeTruthy();
    const row = (await screen.findByText('Cora Lead', { selector: 'strong' })).closest('li')!;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Already added')).toBeTruthy();
    await userEvent.click(row);
    expect(screen.getAllByRole('button', { name: /^Remove Cora/ }).length).toBe(1);
  });

  it('removes a selected staff', async () => {
    const box = await openSim();
    await screen.findByText('Cora Lead');
    await userEvent.type(box, '{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Cora Lead (SM)' }));
    expect(screen.queryByRole('button', { name: /^Remove Cora/ })).toBeNull();
  });
});

describe('Q1 banner and line review', () => {
  it('shows the owner-reported Option C banner, never a signed approval', async () => {
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(
      await screen.findByText(
        'Compensation model: Option C (both models) — owner-reported, evidence awaited, no effective date.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Presidential approval/)).toBeNull();
  });

  it('collapses repeated setup reasons behind a short actionable warning', async () => {
    batches = [batch({ blockedLineCount: 6, computedLineCount: 0, totalNet: '0.00' })];
    lines = [
      line(LINE, {
        status: 'blocked',
        blockedReason:
          'CONFIGURATION_REQUIRED: no approved policy; MISSING_ENGAGEMENT (no approved engagement)',
      }),
    ];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    const toggle = await screen.findByText('View configuration issues');
    expect(toggle.closest('details')).not.toHaveAttribute('open');
    expect(await screen.findByText('Not calculated')).toBeInTheDocument();
    expect(
      screen.getByText('6 staff lines need setup before this batch can be submitted.'),
    ).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle.closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('explains blocked lines in plain language', async () => {
    batches = [batch({ blockedLineCount: 1, computedLineCount: 1 })];
    lines = [
      line(LINE, {
        status: 'blocked',
        blockedReason: 'CONFIGURATION_REQUIRED: no approved compensation policy for SM in 2026-11',
        ba: null,
        pa: null,
        pb: null,
        net: null,
        withheld: null,
      }),
    ];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(await screen.findByText('Some lines are blocked')).toBeTruthy();
    expect(
      (await screen.findAllByText(/No approved compensation policy for SM in 2026-11/)).length,
    ).toBeGreaterThan(0);
  });

  const flagged = () => {
    batches = [batch()];
    lines = [
      line(LINE, { reviewRequired: true, reviewFlags: ['NET_ABOVE_REVIEW_LIMIT'] }),
      line(LINE2, { staffName: 'Ben IST' }),
    ];
  };

  it('flags a line, blocks submit, and records the review note', async () => {
    flagged();
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(await screen.findByText('Needs review')).toBeTruthy();
    expect(screen.getByText('Net pay is above the review limit')).toBeTruthy();
    expect(screen.getByText(/1 flagged line needs a review note before submit/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Submit for approval' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }));
    const save = screen.getAllByRole('button', { name: 'Record review' }).pop()!;
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Review note/), 'Checked against sheet');
    await userEvent.click(save);
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/lines/${LINE}/review`),
      );
      expect(post?.body).toEqual({ note: 'Checked against sheet' });
    });
  });

  it('shows reviewer, date and note once reviewed and unblocks submit', async () => {
    batches = [batch()];
    lines = [
      line(LINE, {
        reviewRequired: true,
        reviewFlags: ['NET_ABOVE_REVIEW_LIMIT'],
        reviewedBy: OTHER,
        reviewedAt: '2026-11-05T00:00:00Z',
        reviewNote: 'Checked against sheet',
      }),
    ];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    expect(await screen.findByText(/Checked against sheet/)).toBeTruthy();
    expect(screen.queryByText('Needs review')).toBeNull();
    const button = screen.getByRole('button', { name: 'Submit for approval' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('hides Record review without finance.payroll update', async () => {
    flagged();
    renderWithProviders(<IstPayrollPage />, {
      user: userWith(perm('finance.payroll', false, false)),
    });
    expect(await screen.findByText('Needs review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record review' })).toBeNull();
  });
});

describe('Policies tab', () => {
  const DRAFTER = userWith(
    perm('finance.payroll', false, false),
    perm('finance.payroll_policy', true, true),
  );
  const DECIDER = userWith(
    perm('finance.payroll', false, false),
    perm('finance.payroll_policy_approval', false, true),
  );
  const open = async (user: SessionUser) => {
    renderWithProviders(<IstPayrollPage />, { user });
    await userEvent.click(await screen.findByRole('tab', { name: 'Policies' }));
  };
  const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

  it('empty state: no approved policy, notice, New draft enabled for a drafter', async () => {
    await open(DRAFTER);
    expect(await screen.findByText(/No approved compensation policy exists yet\./)).toBeTruthy();
    expect(screen.getByText(/Saving a draft does not approve it\./)).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'New draft' }))).toBe(false);
  });

  it('disables New draft with a reason without finance.payroll_policy', async () => {
    await open(FINANCE);
    expect(isDisabled(await screen.findByRole('button', { name: 'New draft' }))).toBe(true);
    expect(screen.getByText('You do not have permission to draft policies.')).toBeTruthy();
  });

  it('lists a draft with lifecycle chip, rank name and version', async () => {
    policies = [policy({ lifecycle: 'draft', policyVersion: 2 })];
    await open(DRAFTER);
    expect(await screen.findByText('Senior Sales Manager')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText('80.00%')).toBeTruthy();
  });

  it('renders a pending_approval policy', async () => {
    policies = [policy({ status: 'pending_approval', lifecycle: 'pending_approval' })];
    await open(FINANCE);
    expect(await screen.findByText('Pending approval')).toBeTruthy();
  });

  it('explains why a prior preparer cannot approve their own policy', async () => {
    policies = [
      policy({ status: 'pending_approval', lifecycle: 'pending_approval', approvalConflict: true }),
    ];
    await open(DECIDER);
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(
      screen.getByText('You prepared or submitted this policy. Another approver must decide.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('new draft: invalid input is refused locally, valid input posts exact-decimal strings', async () => {
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Check /)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const set = (label: RegExp | string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    set(/^Monthly BA/, '1000.50');
    set(/^BA target/, '2000');
    set(/^Monthly PA/, '500');
    set(/^PA target/, '3000');
    set(/^PB target/, '4000');
    set(/^PB rate/, '1');
    set(/^Collection gate/, '80');
    set(/^Effective from/, '2026-12-01');
    set(/^Basis note/, 'Reference draft for review');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/payroll/policies'));
      expect(post?.body).toMatchObject({
        rank: 'SM',
        monthlyBa: '1000.50',
        baTarget: '2000',
        pbRate: '0.0100',
        collectionGate: '0.8000',
        effectiveFrom: '2026-12-01',
        effectiveUntil: null,
        baReviewLimit: null,
      });
    });
  });

  it('edit draft prefills the policy and PUTs the full document', async () => {
    policies = [policy({ lifecycle: 'draft', policyVersion: 1 })];
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit draft' }));
    expect((screen.getByLabelText(/^Monthly BA/) as HTMLInputElement).value).toBe('1,000.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith(`/policies/${POLICY_ID}`));
      expect(put?.body).toMatchObject({ rank: 'SSM', monthlyBa: '1000.00' });
    });
  });

  it('loads each rank reference and restores edited values without saving or approval', async () => {
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    expect(screen.getByLabelText(/^Monthly BA/)).toHaveValue('15,000.00');
    expect(screen.getByLabelText(/^PB rate/)).toHaveValue('1.00');
    expect(screen.getByLabelText(/^Collection gate/)).toHaveValue('40.00');
    await userEvent.click(screen.getByRole('radio', { name: 'SSM Senior Sales Manager' }));
    expect(screen.getByLabelText(/^Monthly BA/)).toHaveValue('25,000.00');
    expect(screen.getByLabelText(/^PB rate/)).toHaveValue('3.00');
    await userEvent.click(screen.getByRole('radio', { name: 'SVD Sales Vice Director' }));
    expect(screen.getByLabelText(/^BA target/)).toHaveValue('1,800,000.00');
    expect(screen.getByLabelText(/^PB rate/)).toHaveValue('2.00');
    fireEvent.change(screen.getByLabelText(/^Monthly BA/), { target: { value: '70000' } });
    await userEvent.click(screen.getByRole('button', { name: 'Restore reference values' }));
    expect(screen.getByLabelText(/^Monthly BA/)).toHaveValue('50,000.00');
    expect(screen.getByLabelText(/^Effective from/)).toHaveValue('');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('preserves a saved draft when its rank changes', async () => {
    policies = [policy({ lifecycle: 'draft' })];
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit draft' }));
    await userEvent.click(screen.getByRole('radio', { name: 'SM Sales Manager' }));
    expect(screen.getByLabelText(/^Monthly BA/)).toHaveValue('1,000.00');
    expect(screen.getByLabelText(/^Collection gate/)).toHaveValue('80.00');
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('copies an approved policy to a new dated draft and preserves the original', async () => {
    const original = policy({ status: 'approved', lifecycle: 'active', policyVersion: 4 });
    policies = [original];
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'Create new version' }));
    expect(screen.getByLabelText(/^Monthly BA/)).toHaveValue('1,000.00');
    expect(screen.getByLabelText(/^Effective from/)).toHaveValue('');
    expect(screen.getByLabelText(/^Basis note/)).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'SM Sales Manager' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Monthly BA/), { target: { value: '18000' } });
    fireEvent.change(screen.getByLabelText(/^PB rate/), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: '2027-07-01' } });
    fireEvent.change(screen.getByLabelText(/^Basis note/), {
      target: { value: 'Synthetic future compensation revision' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(
        calls.find((call) => call.method === 'POST' && call.url.endsWith('/payroll/policies'))
          ?.body,
      ).toMatchObject({
        rank: 'SSM',
        monthlyBa: '18000',
        pbRate: '0.0150',
        effectiveFrom: '2027-07-01',
        effectiveUntil: null,
        basisNote: expect.stringContaining(`Previous policy: ${POLICY_ID}; version 4`),
      }),
    );
    expect(calls.some((call) => call.method === 'PUT' || call.url.endsWith('/approve'))).toBe(
      false,
    );
    expect(original.monthlyBa).toBe('1000.00');
    expect(original.effectiveFrom).toBe('2026-01-01');
  });

  it('rejects bad percentages and reversed dates before posting a policy', async () => {
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: '2027-07-01' } });
    fireEvent.change(screen.getByLabelText(/^Basis note/), {
      target: { value: 'Synthetic validation fixture' },
    });
    for (const invalid of ['101', '-1', '1.234']) {
      fireEvent.change(screen.getByLabelText(/^PB rate/), { target: { value: invalid } });
      await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
    }
    fireEvent.change(screen.getByLabelText(/^PB rate/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^Effective until/), {
      target: { value: '2027-06-30' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('reuses the draft request key after an unchanged retry', async () => {
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: '2027-01-01' } });
    fireEvent.change(screen.getByLabelText(/^Basis note/), {
      target: { value: 'Synthetic retry evidence' },
    });
    postError = { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'Try again' } } };
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Not saved');
    postError = null;
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.method === 'POST' && call.url.endsWith('/payroll/policies')),
      ).toHaveLength(2),
    );
    const attempts = calls.filter(
      (call) => call.method === 'POST' && call.url.endsWith('/payroll/policies'),
    );
    expect(attempts[0]?.idempotencyKey).toBeTruthy();
    expect(attempts[1]?.idempotencyKey).toBe(attempts[0]?.idempotencyKey);
    expect(attempts[1]?.body).toMatchObject({
      monthlyBa: '15000.00',
      pbRate: '0.0100',
      collectionGate: '0.4000',
      basisNote: expect.stringContaining('[Reference SM afhomes-table-a-v1]'),
    });
  });

  it('keeps ended history separate from the current rank policy', async () => {
    policies = [
      policy({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'approved',
        lifecycle: 'expired',
        policyVersion: 1,
        effectiveUntil: '2026-06-30',
      }),
      policy({ status: 'approved', lifecycle: 'active', policyVersion: 2 }),
    ];
    await open(DRAFTER);
    expect(await screen.findByText('v2')).toBeInTheDocument();
    expect(screen.queryByText('v1')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'View history' }));
    expect(await screen.findByText('v1')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST' || call.method === 'PUT')).toBe(false);
  });

  it('submits a draft for approval', async () => {
    policies = [policy({ lifecycle: 'draft', policyVersion: 1 })];
    await open(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith(`/policies/${POLICY_ID}/submit`)),
      ).toBe(true),
    );
  });

  it('draft actions are disabled with a reason without the draft permission', async () => {
    policies = [policy({ lifecycle: 'draft' })];
    await open(DECIDER);
    expect(isDisabled(await screen.findByRole('button', { name: 'Edit draft' }))).toBe(true);
    expect(screen.getByText('No permission to edit or submit drafts.')).toBeTruthy();
  });

  it('approver approves with evidence reference and note, and shows a server refusal', async () => {
    policies = [policy({ status: 'pending_approval', lifecycle: 'pending_approval' })];
    await open(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('button', { name: 'Approve policy' });
    expect(isDisabled(confirm)).toBe(true);
    await userEvent.type(screen.getByLabelText(/^Evidence reference/), 'Board resolution 2026-11');
    await userEvent.type(screen.getByLabelText(/^Note/), 'Reviewed and approved');
    postError = {
      status: 409,
      body: { error: { code: 'conflict', message: 'The drafter cannot approve this policy.' } },
    };
    await userEvent.click(confirm);
    expect(await screen.findByText('The drafter cannot approve this policy.')).toBeTruthy();
    postError = null;
    await userEvent.click(screen.getByRole('button', { name: 'Approve policy' }));
    await waitFor(() => {
      const post = calls
        .filter((c) => c.method === 'POST' && c.url.endsWith(`/policies/${POLICY_ID}/approve`))
        .pop();
      expect(post?.body).toEqual({
        evidenceReference: 'Board resolution 2026-11',
        note: 'Reviewed and approved',
      });
    });
  });

  it('non-approvers see Approve disabled with a reason', async () => {
    policies = [policy({ status: 'pending_approval', lifecycle: 'pending_approval' })];
    await open(DRAFTER);
    expect(isDisabled(await screen.findByRole('button', { name: 'Approve' }))).toBe(true);
    expect(screen.getByText('Waiting for Super Admin approval.')).toBeTruthy();
  });

  it('returns a pending policy with a reason', async () => {
    policies = [policy({ status: 'pending_approval', lifecycle: 'pending_approval' })];
    await open(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'Return' }));
    await userEvent.type(screen.getByLabelText(/^Reason/), 'Figures need a source');
    await userEvent.click(screen.getByRole('button', { name: 'Return policy' }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/policies/${POLICY_ID}/return`),
      );
      expect(post?.body).toEqual({ reason: 'Figures need a source' });
    });
  });

  it('ends an active policy with a date and note', async () => {
    policies = [policy({ status: 'approved', lifecycle: 'active' })];
    await open(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'End' }));
    fireEvent.change(screen.getByLabelText(/^Effective until/), {
      target: { value: '2026-12-31' },
    });
    await userEvent.type(screen.getByLabelText(/^Note/), 'Superseded by v2');
    await userEvent.click(screen.getByRole('button', { name: 'End policy' }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/policies/${POLICY_ID}/end`),
      );
      expect(post?.body).toEqual({ effectiveUntil: '2026-12-31', note: 'Superseded by v2' });
    });
  });
});

describe('Pending payroll approvals card', () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    batchId: BATCH,
    period: '2026-11',
    lineCount: 4,
    computedLineCount: 4,
    totalNet: '5000.00',
    submittedBy: OTHER,
    submittedAt: '2026-11-10T00:00:00Z',
    mode: 'live',
    simulationBasis: null,
    ...over,
  });

  it('renders nothing without the approval permission', async () => {
    const { container } = renderWithProviders(<PendingPayrollApprovalsCard />, { user: FINANCE });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
    expect(calls.length).toBe(0);
  });

  it('shows an empty state', async () => {
    renderWithProviders(<PendingPayrollApprovalsCard />, { user: APPROVER });
    expect(await screen.findByText('Nothing waiting')).toBeTruthy();
  });

  it('labels simulation rows as SIMULATION, not real money', async () => {
    approvals = [pending({ mode: 'simulation', simulationBasis: 'Reference sheet' })];
    renderWithProviders(<PendingPayrollApprovalsCard />, { user: APPROVER });
    expect(await screen.findByText('SIMULATION')).toBeTruthy();
    expect(screen.getByText(/not real money/)).toBeTruthy();
  });

  it('approves after an inline confirmation naming the batch', async () => {
    approvals = [pending()];
    renderWithProviders(<PendingPayrollApprovalsCard />, { user: APPROVER });
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    // Nothing is sent until the approver confirms the month, lines and total.
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    const confirm = within(screen.getByRole('group', { name: 'Confirm approval' }));
    expect(confirm.getByText(/4 lines/)).toBeInTheDocument();
    await userEvent.click(confirm.getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/approve`))).toBe(
        true,
      ),
    );
  });

  it('returns with an inline reason', async () => {
    approvals = [pending()];
    renderWithProviders(<PendingPayrollApprovalsCard />, { user: APPROVER });
    await userEvent.click(await screen.findByRole('button', { name: 'Return' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'Totals look off');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm return' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith(`/${BATCH}/return`));
      expect(post?.body).toEqual({ reason: 'Totals look off' });
    });
  });
});

it('explains why a read-only approver has no generate action on an empty month', async () => {
  renderWithProviders(<IstPayrollPage />, { user: APPROVER });
  expect(await screen.findByText(/Your role cannot generate payroll drafts/)).toBeInTheDocument();
  expect(screen.getByText(/Set the company rates in Policies/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Generate draft' })).toBeNull();
});
it('fails closed when the governing gate cannot be loaded', async () => {
  const base = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/payroll/gate'))
        return json(503, { error: { code: 'INTERNAL', message: 'Gate unavailable' } });
      return base(input, init);
    }),
  );
  renderWithProviders(<IstPayrollPage />, { user: FINANCE });
  expect(await screen.findByRole('button', { name: 'Generate draft' })).toBeDisabled();
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
});

describe('payroll employee workspace', () => {
  it('filters employees, clears filters and opens the saved calculation', async () => {
    batches = [batch()];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    const search = await screen.findByRole('searchbox', { name: 'Search payroll employees' });
    await userEvent.type(search, 'Ana');
    expect(screen.queryByRole('button', { name: 'View payroll for Ben IST' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Payroll summary' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear employee filters' }));
    expect(screen.getByRole('button', { name: 'View payroll for Ben IST' })).toBeTruthy();
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Payroll position' })).getByRole('radio', {
        name: 'SVD',
      }),
    );
    expect(screen.getByText('No employees match these filters.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear employee filters' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Payroll line status' }),
      'paid',
    );
    expect(screen.getByText('No employees match these filters.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear employee filters' }));
    await userEvent.click(screen.getByRole('button', { name: 'View payroll for Ana IST' }));
    expect(await screen.findByText('2026-01-01')).toBeTruthy();
    expect(screen.getByText('No payment-level snapshot was captured for this line.')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith(`/payroll/lines/${LINE}/calculation`))).toBe(true);
  });
  it('refreshes draft calculations through the existing generate action', async () => {
    batches = [batch()];
    renderWithProviders(<IstPayrollPage />, { user: FINANCE });
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh calculations' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/payroll/batches'))).toBe(
        true,
      ),
    );
  });
});
