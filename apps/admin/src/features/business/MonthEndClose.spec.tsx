import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { MonthEndClosePage } from './MonthEndClosePage';
import { FinanceSummaryCards } from './FinanceSummaryCards';

const ME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

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

const SUBMITTER = userWith(perm('finance.payroll', true, false));
const CLOSER = userWith(perm('finance.payroll_close', false, true));

let summary: Record<string, unknown>;
let periods: Record<string, unknown>[];
let summaryStatus = 200;
let actionResponse: { status: number; body: unknown };
const calls: { url: string; method: string; body: unknown }[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  calls.length = 0;
  summaryStatus = 200;
  summary = {
    period: '2026-10',
    status: 'open',
    verifiedCount: 7,
    verifiedTotal: '123456.00',
    latePostings: 1,
    pendingVerification: 2,
    heldForDuplicateReview: 3,
    proposedAdjustments: 4,
    earlierOpenPeriods: [],
  };
  periods = [];
  actionResponse = {
    status: 200,
    body: { period: '2026-10', status: 'ready_for_approval' },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/queues/finance-summary')) {
        return summaryStatus === 200
          ? json(200, summary)
          : json(summaryStatus, { error: { code: 'forbidden', message: 'Forbidden' } });
      }
      if (url.includes('/queues/periods/')) return json(actionResponse.status, actionResponse.body);
      if (url.includes('/queues/periods'))
        return json(200, { data: periods, meta: { total: periods.length } });
      return json(200, { data: [], meta: { total: 0 } });
    }),
  );
});

describe('Finance summary cards', () => {
  it('renders server figures', async () => {
    renderWithProviders(<FinanceSummaryCards />, { user: SUBMITTER });
    expect(await screen.findByText('Pending verification')).toBeTruthy();
    expect(screen.getByText('Held for duplicate review')).toBeTruthy();
    expect(screen.getByText('Late postings')).toBeTruthy();
    expect(screen.getByText(/123,456\.00/)).toBeTruthy();
    expect(screen.getByText('7 payments')).toBeTruthy();
  });

  it('is hidden when the summary is forbidden', async () => {
    summaryStatus = 403;
    renderWithProviders(<FinanceSummaryCards />, { user: SUBMITTER });
    await waitFor(() => expect(calls.some((c) => c.url.includes('finance-summary'))).toBe(true));
    await waitFor(() => expect(screen.queryByLabelText('Loading month summary')).toBeNull());
    expect(screen.queryByText('Pending verification')).toBeNull();
    expect(screen.queryByLabelText('Month summary')).toBeNull();
  });
});

describe('Month-End Close page', () => {
  it('shows the checklist values from the server', async () => {
    summary.earlierOpenPeriods = ['2026-09'];
    renderWithProviders(<MonthEndClosePage />, { user: SUBMITTER });
    const list = await screen.findByRole('list', { name: 'Pre-close checklist' });
    expect(list.textContent).toContain('123,456.00');
    expect(list.textContent).toContain('Pending verification2');
    expect(list.textContent).toContain('Held for duplicate review3');
    expect(list.textContent).toContain('Proposed adjustments4');
    expect(list.textContent).toContain('Late postings1');
    expect(list.textContent).toContain('September 2026');
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('offers Submit only with create permission, never close/return', async () => {
    renderWithProviders(<MonthEndClosePage />, { user: SUBMITTER });
    expect(await screen.findByRole('button', { name: 'Submit for closing' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close period' })).toBeNull();
  });

  it('offers no close/return to a submit-only user when ready for approval', async () => {
    summary.status = 'ready_for_approval';
    renderWithProviders(<MonthEndClosePage />, { user: SUBMITTER });
    await screen.findByText('Ready for approval');
    expect(screen.queryByRole('button', { name: 'Close period' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();
  });

  it('hides Submit without create permission', async () => {
    renderWithProviders(<MonthEndClosePage />, { user: CLOSER });
    await screen.findByText('Open');
    expect(screen.queryByRole('button', { name: 'Submit for closing' })).toBeNull();
  });

  it('requires a reason to return', async () => {
    summary.status = 'ready_for_approval';
    const user = userEvent.setup();
    renderWithProviders(<MonthEndClosePage />, { user: CLOSER });
    await user.click(await screen.findByRole('button', { name: 'Return' }));
    const confirm = screen.getByRole('button', { name: 'Return period' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Reason/), 'Missing receipts');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/return'))?.body).toEqual({
        reason: 'Missing receipts',
      }),
    );
  });

  it('shows a server refusal as-is', async () => {
    summary.status = 'ready_for_approval';
    actionResponse = {
      status: 409,
      body: { error: { code: 'conflict', message: 'Close the earlier open months first.' } },
    };
    const user = userEvent.setup();
    renderWithProviders(<MonthEndClosePage />, { user: CLOSER });
    await user.click(await screen.findByRole('button', { name: 'Close period' }));
    await user.click(screen.getAllByRole('button', { name: 'Close period' }).at(-1)!);
    expect(await screen.findByText('Close the earlier open months first.')).toBeTruthy();
  });

  it('disables Close for the submitter with a reason', async () => {
    summary.status = 'ready_for_approval';
    periods = [
      {
        period: '2026-10',
        status: 'ready_for_approval',
        submittedBy: ME,
        submittedAt: '2026-11-02T00:00:00.000Z',
        closedBy: null,
        closedAt: null,
        returnedReason: null,
        snapshot: null,
      },
    ];
    renderWithProviders(<MonthEndClosePage />, { user: CLOSER });
    const button = (await screen.findByRole('button', {
      name: 'Close period',
    })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(screen.getByText('The submitter cannot close.')).toBeTruthy();
  });

  it('closed period shows the snapshot and no actions', async () => {
    summary.status = 'closed';
    periods = [
      {
        period: '2026-10',
        status: 'closed',
        submittedBy: OTHER,
        submittedAt: '2026-11-02T00:00:00.000Z',
        closedBy: ME,
        closedAt: '2026-11-03T00:00:00.000Z',
        returnedReason: null,
        snapshot: { verifiedTotal: '99000.00', verifiedCount: 5 },
      },
    ];
    renderWithProviders(<MonthEndClosePage />, {
      user: userWith(
        perm('finance.payroll', true, true),
        perm('finance.payroll_close', true, true),
      ),
    });
    const figures = await screen.findByRole('list', { name: 'Closed figures' });
    expect(figures.textContent).toContain('99,000.00');
    expect(figures.textContent).toContain('5');
    expect(screen.queryByRole('button', { name: 'Submit for closing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close period' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();
  });
});
