import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { MonthEndClosePage } from './MonthEndClosePage';
import { PaymentAdjustmentsList, RESOLVE_STATEMENT } from './PaymentFinanceParts';

const PAY = 'cccccccc-0000-4000-8000-000000009800';
const ADJ = 'dddddddd-0000-4000-8000-000000000001';
const ADJ2 = 'dddddddd-0000-4000-8000-000000000002';
const USER = '22222222-2222-4222-8222-222222222222';
const ADJ_PATH = `/sales/payments/${PAY}/adjustments`;
const GATE_PATH = '/sales/payments/adjustment-resolution-gate';

const FINANCE = {
  id: USER,
  email: 'f@example.test',
  fullName: 'Fae',
  afHomesRole: 'finance',
  afHomesPermissions: [],
} as unknown as SessionUser;

const row = (over: Record<string, unknown>) => ({
  id: ADJ,
  paymentId: PAY,
  kind: 'reversal',
  amount: '4000.00',
  reason: 'Bank reversed the transfer',
  effectiveDate: '2026-10-05',
  status: 'proposed',
  requestedBy: USER,
  requestedByName: 'Fae',
  requestedAt: '2026-10-05T00:00:00.000Z',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  postingPeriod: null,
  ...over,
});

let adjustments: Record<string, unknown>[];
let gate: Record<string, unknown>;
let resolveResponse: { status: number; body: unknown };
const calls: { url: string; method: string; body: unknown }[] = [];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const posts = () => calls.filter((c) => c.method === 'POST');
const adjustmentGets = () =>
  calls.filter((c) => c.method === 'GET' && c.url.endsWith(ADJ_PATH)).length;

beforeEach(() => {
  calls.length = 0;
  adjustments = [row({})];
  gate = { q13Status: 'pending', canDecide: true, authorized: false };
  resolveResponse = { status: 200, body: { id: ADJ, status: 'approved' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'POST') return json(resolveResponse.status, resolveResponse.body);
      if (url.endsWith(GATE_PATH)) return json(200, gate);
      if (url.endsWith(ADJ_PATH)) return json(200, { data: adjustments, meta: { total: 1 } });
      return json(200, { data: [], meta: { total: 0 } });
    }),
  );
});

describe('payment adjustment resolution', () => {
  it('disables all three buttons with the Q13 reason while authority is pending', async () => {
    renderWithProviders(<PaymentAdjustmentsList paymentId={PAY} />, { user: FINANCE });
    expect(
      await screen.findByText('Resolution authority awaits Presidential approval (Q13)'),
    ).toBeInTheDocument();
    for (const name of ['Approve', 'Reject', 'Withdraw']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByText(/Bank reversed the transfer/)).toBeInTheDocument();
  });

  it('shows the permission reason when Q13 is approved but the caller cannot decide', async () => {
    gate = { q13Status: 'approved', canDecide: false, authorized: false };
    renderWithProviders(<PaymentAdjustmentsList paymentId={PAY} />, { user: FINANCE });
    expect(
      await screen.findByText('Requires Payment Adjustment Decisions permission'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('enables the buttons when the gate authorizes', async () => {
    gate = { q13Status: 'approved', canDecide: true, authorized: true };
    renderWithProviders(<PaymentAdjustmentsList paymentId={PAY} />, { user: FINANCE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled();
  });

  it('requires a note of at least 5 characters and states what a decision does', async () => {
    gate = { q13Status: 'approved', canDecide: true, authorized: true };
    const user = userEvent.setup();
    renderWithProviders(<PaymentAdjustmentsList paymentId={PAY} />, { user: FINANCE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Reject adjustment' }));
    expect(dialog.getByText(RESOLVE_STATEMENT)).toBeInTheDocument();
    const confirm = dialog.getByRole('button', { name: 'Confirm reject' });
    expect(confirm).toBeDisabled();
    await user.type(dialog.getByLabelText('Decision note'), 'abcd');
    expect(confirm).toBeDisabled();
    expect(dialog.getByText('Enter at least 5 characters.')).toBeInTheDocument();
    await user.type(dialog.getByLabelText('Decision note'), 'e');
    expect(confirm).toBeEnabled();
  });

  it('posts the decision to the resolve URL and refreshes the list', async () => {
    gate = { q13Status: 'approved', canDecide: true, authorized: true };
    const user = userEvent.setup();
    renderWithProviders(<PaymentAdjustmentsList paymentId={PAY} />, { user: FINANCE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
    const before = adjustmentGets();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Approve adjustment' }));
    await user.type(dialog.getByLabelText('Decision note'), '  Verified with bank  ');
    adjustments = [
      row({
        status: 'approved',
        decidedByName: 'Super Admin',
        decidedAt: '2026-11-02T00:00:00.000Z',
        decisionNote: 'Verified with bank',
        postingPeriod: '2026-11',
      }),
    ];
    await user.click(dialog.getByRole('button', { name: 'Confirm approve' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.url.endsWith(`${ADJ_PATH}/${ADJ}/resolve`)).toBe(true);
    expect(posts()[0]?.body).toEqual({ decision: 'approved', note: 'Verified with bank' });
    await waitFor(() => expect(adjustmentGets()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('surfaces the server error message and keeps the dialog open', async () => {
    gate = { q13Status: 'approved', canDecide: true, authorized: true };
    resolveResponse = {
      status: 409,
      body: {
        error: {
          code: 'PAYMENT_ADJUSTMENT_AUTHORITY_PENDING',
          message: 'Adjustment decisions are not yet authorized.',
        },
      },
    };
    const user = userEvent.setup();
    renderWithProviders(<PaymentAdjustmentsList paymentId={PAY} />, { user: FINANCE });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Withdraw adjustment' }));
    await user.type(dialog.getByLabelText('Decision note'), 'Entered in error');
    await user.click(dialog.getByRole('button', { name: 'Confirm withdraw' }));
    expect(
      await dialog.findByText('Adjustment decisions are not yet authorized.'),
    ).toBeInTheDocument();
  });

  it('renders resolved rows with chip, decider, date, note and posting period', async () => {
    adjustments = [
      row({
        id: ADJ,
        status: 'approved',
        decidedByName: 'Super Admin',
        decidedAt: '2026-11-02T00:00:00.000Z',
        decisionNote: 'Verified with bank',
        postingPeriod: '2026-11',
      }),
      row({
        id: ADJ2,
        status: 'rejected',
        decidedByName: 'Super Admin',
        decidedAt: '2026-11-03T00:00:00.000Z',
        decisionNote: 'Duplicate request',
        postingPeriod: null,
      }),
    ];
    renderWithProviders(<PaymentAdjustmentsList paymentId={PAY} />, { user: FINANCE });
    const list = await screen.findByRole('list', { name: 'Adjustment proposals' });
    const [approved, rejected] = within(list).getAllByRole('listitem');
    expect(within(approved!).getByText('Approved')).toBeInTheDocument();
    expect(approved!.textContent).toContain('Decided by Super Admin');
    expect(approved!.textContent).toContain('Period 2026-11');
    expect(approved!.textContent).toContain('Note: Verified with bank');
    expect(within(rejected!).getByText('Rejected')).toBeInTheDocument();
    expect(rejected!.textContent).toContain('Note: Duplicate request');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    // No proposed row: the gate is not even requested, and history stays visible.
    expect(calls.some((c) => c.url.endsWith(GATE_PATH))).toBe(false);
  });
});

describe('month-end blocker link', () => {
  it('links the PAYMENT_ADJUSTMENTS_PENDING blocker to the payments page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/readiness'))
          return json(200, {
            period: '2026-10',
            ready: false,
            blockers: [
              { code: 'PAYMENT_ADJUSTMENTS_PENDING', count: 1, message: 'Adjustments pending.' },
            ],
            warnings: [],
          });
        if (url.includes('/queues/finance-summary'))
          return json(200, {
            period: '2026-10',
            status: 'open',
            verifiedCount: 0,
            verifiedTotal: '0.00',
            latePostings: 0,
            pendingVerification: 0,
            heldForDuplicateReview: 0,
            proposedAdjustments: 1,
            earlierOpenPeriods: [],
          });
        return json(200, { data: [], meta: { total: 0 } });
      }),
    );
    renderWithProviders(<MonthEndClosePage />, { user: FINANCE });
    const link = await screen.findByRole('link', { name: 'Review proposed adjustments' });
    expect(link).toHaveAttribute('href', '/admin/finance/payments');
  });
});
