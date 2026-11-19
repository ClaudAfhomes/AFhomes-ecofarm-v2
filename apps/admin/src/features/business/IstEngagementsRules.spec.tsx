import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { IstPayrollPage } from './IstPayrollPage';
import { PayrollLinesTable } from './PayrollLinesTable';

const ME = '22222222-2222-4222-8222-222222222222';
const STAFF = '77777777-7777-4777-8777-777777777777';
const ENG = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const RULE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PAY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

const DRAFTER = userWith(
  perm('finance.payroll', false, false),
  perm('finance.payroll_policy', true, true),
);
const DECIDER = userWith(
  perm('finance.payroll', false, false),
  perm('finance.payroll_policy_approval', false, true),
);
const VIEWER = userWith(perm('finance.payroll', false, false));

const actor = {
  createdBy: ME,
  createdByName: 'Fae',
  createdAt: '2026-11-01T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  returnedBy: null,
  returnedAt: null,
  returnReason: null,
  approvedBy: null,
  approvedByName: null,
  approvedAt: null,
  approvalEvidenceReference: null,
  approvalNote: null,
  endedBy: null,
  endedAt: null,
  endNote: null,
};
const engagement = (over: Record<string, unknown> = {}) => ({
  id: ENG,
  staffId: STAFF,
  staffName: 'Cora Lead',
  rank: 'SSM',
  contractStart: '2026-01-01',
  contractEnd: null,
  suspendedFrom: null,
  evidenceReference: 'Signed contract 2026-01',
  status: 'draft',
  ...actor,
  ...over,
});
const rule = (over: Record<string, unknown> = {}) => ({
  id: RULE,
  ruleVersion: 3,
  effectiveFrom: '2026-01-01',
  effectiveUntil: null,
  attributionBasis: null,
  closedDealThresholdPct: null,
  countDateBasis: null,
  assumedCreditRate: null,
  adjustmentTreatment: null,
  sourceReference: 'Pending presidential decision',
  status: 'draft',
  ...actor,
  ...over,
});
const staffPerf = (over: Record<string, unknown> = {}) => ({
  staffId: STAFF,
  rank: 'SM',
  contractStart: '2026-01-01',
  contractEnd: null,
  suspendedFrom: null,
  kpi: '0.00',
  collection: '0.00',
  verifiedCash: '12345.60',
  assumedCredit: '0.00',
  approvedAdjustmentsTotal: '100.00',
  proposedAdjustmentsTotal: '0.00',
  status: 'CALCULABLE',
  blockers: [],
  evidenceHash: 'abc',
  evidenceCount: 1,
  ruleId: null,
  ruleVersion: null,
  engagementId: null,
  ...over,
});
const evidenceItem = (over: Record<string, unknown> = {}) => ({
  staffId: STAFF,
  period: '2026-11',
  saleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  reservationId: null,
  paymentId: PAY,
  amount: '5000.00',
  postingPeriod: '2026-11',
  paidOn: '2026-11-03',
  verifiedAt: '2026-11-04T00:00:00Z',
  paymentPurpose: 'down_payment',
  sellerStaffId: STAFF,
  contractPriceSnapshot: null,
  cumulativeVerifiedAtPeriodEnd: null,
  evidenceClass: 'x',
  eligibility: 'UNDETERMINED',
  reasonCode: 'COUNT_DATE_MISSING',
  countPeriod: null,
  countDate: null,
  isClosingPayment: true,
  closedDealThresholdAmount: null,
  approvedAdjustmentsTotal: '0.00',
  proposedAdjustmentsTotal: '0.00',
  assumedCredit: '0.00',
  ruleId: null,
  engagementId: null,
  ...over,
});

let engagements: Record<string, unknown>[];
let rules: Record<string, unknown>[];
let performance: Record<string, unknown>;
let evidenceItems: Record<string, unknown>[];
let postError: { status: number; body: unknown } | null;
const calls: { url: string; method: string; body: unknown }[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const list = (data: unknown[]) => json(200, { data, meta: { total: data.length } });

beforeEach(() => {
  calls.length = 0;
  engagements = [];
  rules = [];
  postError = null;
  evidenceItems = [evidenceItem()];
  performance = {
    period: '2026-11',
    ruleId: null,
    ruleVersion: null,
    ruleBlocker: null,
    staff: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method !== 'GET') {
        if (postError) return json(postError.status, postError.body);
        return json(method === 'POST' ? 201 : 200, { id: ENG, status: 'draft' });
      }
      if (url.includes('/payroll/engagements')) return list(engagements);
      if (url.includes('/payroll/performance-rules')) return list(rules);
      if (url.includes('/evidence'))
        return json(200, {
          period: '2026-11',
          staffId: STAFF,
          summary: null,
          items: evidenceItems,
        });
      if (url.includes('/payroll/performance')) return json(200, performance);
      if (url.includes('/payroll/roster'))
        return list([
          {
            id: STAFF,
            name: 'Cora Lead',
            aaNumber: 'AA-001',
            rank: 'SSM',
            roleName: 'Senior Sales Manager',
            status: 'active',
            eligible: true,
          },
        ]);
      if (url.includes('/payroll/gate'))
        return json(200, {
          q1Status: 'approved',
          liveAuthorized: true,
          note: null,
          q1Source: null,
          q1DecisionOption: null,
          q1EvidenceStatus: null,
          q1EffectiveDate: null,
        });
      return list([]);
    }),
  );
});

const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;
const openTab = async (user: SessionUser) => {
  renderWithProviders(<IstPayrollPage />, { user });
  await userEvent.click(await screen.findByRole('tab', { name: 'Engagements & rules' }));
};

describe('IST engagements', () => {
  it('lists engagements with rank name, status and approver name', async () => {
    engagements = [
      engagement({
        status: 'approved',
        approvedByName: 'Pat Approver',
        contractEnd: '2026-12-31',
        suspendedFrom: '2026-12-01',
      }),
    ];
    await openTab(DRAFTER);
    expect(await screen.findByText('Cora Lead')).toBeTruthy();
    expect(screen.getByText('Senior Sales Manager')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Pat Approver')).toBeTruthy();
    // End is available to approvers only; both dates set -> disabled with a reason.
    expect(screen.getByText('Only the approver role can end this.')).toBeTruthy();
  });

  it('drafts an engagement through the staff picker, then submits it', async () => {
    await openTab(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New engagement' }));
    await userEvent.click(await screen.findByRole('option', { name: /Cora Lead/ }));
    fireEvent.change(screen.getByLabelText(/^Contract start/), { target: { value: '2026-12-01' } });
    await userEvent.type(screen.getByLabelText(/^Evidence reference/), 'Signed contract Dec');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/payroll/engagements'));
      expect(post?.body).toEqual({
        staffId: STAFF,
        rank: 'SSM',
        contractStart: '2026-12-01',
        contractEnd: null,
        evidenceReference: 'Signed contract Dec',
      });
    });
  });

  it('refuses a draft without a staff member', async () => {
    await openTab(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New engagement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Choose the staff member first.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('submits a draft for approval', async () => {
    engagements = [engagement()];
    await openTab(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith(`/engagements/${ENG}/submit`)),
      ).toBe(true),
    );
  });

  it('shows a returned note on a draft and disables edits without permission', async () => {
    engagements = [engagement({ returnReason: 'Contract date unclear' })];
    await openTab(DECIDER);
    expect(await screen.findByText('Returned: Contract date unclear')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: 'Edit draft' }))).toBe(true);
    expect(screen.getByText('No permission to edit or submit drafts.')).toBeTruthy();
  });

  it('approve requires an evidence reference of at least 10 characters', async () => {
    engagements = [engagement({ status: 'pending_approval' })];
    await openTab(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('button', { name: 'Approve engagement' });
    await userEvent.type(screen.getByLabelText(/^Evidence reference/), 'short');
    await userEvent.type(screen.getByLabelText(/^Note/), 'Looks right');
    expect(isDisabled(confirm)).toBe(true);
    await userEvent.type(screen.getByLabelText(/^Evidence reference/), ' and long enough');
    expect(isDisabled(confirm)).toBe(false);

    postError = {
      status: 409,
      body: { error: { code: 'conflict', message: 'The drafter cannot approve this record.' } },
    };
    await userEvent.click(confirm);
    expect(await screen.findByText('The drafter cannot approve this record.')).toBeTruthy();
  });

  it('return needs a reason of at least 5 characters', async () => {
    engagements = [engagement({ status: 'pending_approval' })];
    await openTab(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'Return' }));
    const confirm = screen.getByRole('button', { name: 'Return engagement' });
    expect(isDisabled(confirm)).toBe(true);
    await userEvent.type(screen.getByLabelText(/^Reason/), 'abc');
    expect(isDisabled(confirm)).toBe(true);
    await userEvent.type(screen.getByLabelText(/^Reason/), 'def');
    await userEvent.click(confirm);
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/engagements/${ENG}/return`),
      );
      expect(post?.body).toEqual({ reason: 'abcdef' });
    });
  });

  it('ends an approved engagement with a contract end date and note', async () => {
    engagements = [engagement({ status: 'approved' })];
    await openTab(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'End' }));
    const save = screen.getByRole('button', { name: 'Save end / suspension' });
    expect(isDisabled(save)).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Contract end/), { target: { value: '2026-12-31' } });
    await userEvent.type(screen.getByLabelText(/^Note/), 'Contract finished');
    await userEvent.click(save);
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/engagements/${ENG}/end`),
      );
      expect(post?.body).toEqual({
        contractEnd: '2026-12-31',
        suspendedFrom: null,
        note: 'Contract finished',
      });
    });
  });
});

describe('IST performance rules', () => {
  it('lists rules, shows undecided choices and the no-approval note', async () => {
    rules = [rule(), rule({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ruleVersion: 2 })];
    await openTab(DRAFTER);
    expect(await screen.findByText('v3')).toBeTruthy();
    expect(
      screen.getByText(
        /No rule is approved\. Values must come from an approved Presidential decision/,
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Not decided').length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByText('Pending presidential decision').length).toBe(2);
  });

  it('renders configured values for an approved rule', async () => {
    rules = [
      rule({
        status: 'approved',
        approvedByName: 'Pat Approver',
        attributionBasis: 'seller_only',
        closedDealThresholdPct: '30',
        countDateBasis: 'paid_on',
        assumedCreditRate: '0.5',
        adjustmentTreatment: 'report_only',
      }),
    ];
    await openTab(DRAFTER);
    expect(await screen.findByText('Seller only')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();
    expect(screen.getByText('Paid-on date')).toBeTruthy();
    expect(screen.getByText('Report only')).toBeTruthy();
    expect(screen.getByText('Pat Approver')).toBeTruthy();
  });

  it('opens a new draft with no pre-filled values and posts only what is entered', async () => {
    await openTab(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    for (const label of [
      /^Effective from/,
      /^Closed-deal threshold/,
      /^Assumed-credit rate/,
      /^Source reference/,
    ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
    }
    for (const label of ['Attribution basis', 'Count-date basis', 'Adjustment treatment']) {
      expect((screen.getByLabelText(label) as HTMLSelectElement).value).toBe('');
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/^Check /)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: '2026-12-01' } });
    await userEvent.type(screen.getByLabelText(/^Source reference/), 'Draft pending decision');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith('/payroll/performance-rules'),
      );
      expect(post?.body).toEqual({
        effectiveFrom: '2026-12-01',
        effectiveUntil: null,
        attributionBasis: null,
        closedDealThresholdPct: null,
        countDateBasis: null,
        assumedCreditRate: null,
        adjustmentTreatment: null,
        sourceReference: 'Draft pending decision',
      });
    });
  });

  it('refuses a threshold above 100 locally', async () => {
    await openTab(DRAFTER);
    await userEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: '2026-12-01' } });
    await userEvent.type(screen.getByLabelText(/^Source reference/), 'Draft pending decision');
    await userEvent.type(screen.getByLabelText(/^Closed-deal threshold/), '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/^Check closedDealThresholdPct/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('approve rule needs evidence of at least 10 characters', async () => {
    rules = [rule({ status: 'pending_approval' })];
    await openTab(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('button', { name: 'Approve rule' });
    await userEvent.type(screen.getByLabelText(/^Evidence reference/), '123456789');
    await userEvent.type(screen.getByLabelText(/^Note/), 'Approved by decision');
    expect(isDisabled(confirm)).toBe(true);
    await userEvent.type(screen.getByLabelText(/^Evidence reference/), '0');
    expect(isDisabled(confirm)).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/performance-rules/${RULE}/approve`),
      );
      expect(post?.body).toEqual({ evidenceReference: '1234567890', note: 'Approved by decision' });
    });
  });

  it('ends a rule with a date and note', async () => {
    rules = [rule({ status: 'approved' })];
    await openTab(DECIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'End' }));
    fireEvent.change(screen.getByLabelText(/^Effective until/), {
      target: { value: '2026-12-31' },
    });
    await userEvent.type(screen.getByLabelText(/^Note/), 'Superseded');
    await userEvent.click(screen.getByRole('button', { name: 'End rule' }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.endsWith(`/performance-rules/${RULE}/end`),
      );
      expect(post?.body).toEqual({ effectiveUntil: '2026-12-31', note: 'Superseded' });
    });
  });
});

describe('IST performance view (Live tab)', () => {
  it('shows blocked rows with plain sentences, the rule banner and unattributed totals', async () => {
    performance = {
      period: '2026-11',
      ruleId: null,
      ruleVersion: null,
      ruleBlocker: 'RULE_NOT_APPROVED',
      staffNames: { [STAFF]: 'Cora Lead' },
      unattributed: { count: 2, total: '3000.00' },
      staff: [
        staffPerf({
          status: 'BLOCKED',
          verifiedCash: '0.00',
          blockers: ['MISSING_ENGAGEMENT', 'SOME_NEW_CODE'],
        }),
      ],
    };
    renderWithProviders(<IstPayrollPage />, { user: VIEWER });
    expect(await screen.findByText('Cora Lead')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(
      screen.getByText('No approved IST engagement (contract start) exists for this staff member.'),
    ).toBeTruthy();
    expect(screen.getByText('SOME_NEW_CODE')).toBeTruthy();
    // The rule blocker shows both in the banner.
    expect(screen.getAllByText('No performance rule is approved for this month.').length).toBe(1);
    expect(screen.getByText(/Unattributed: 2 payments totalling ₱3,000\.00/)).toBeTruthy();
  });

  it('shows money for a calculable row and the reported adjustments', async () => {
    performance = {
      period: '2026-11',
      ruleId: null,
      ruleVersion: 2,
      ruleBlocker: null,
      staffNames: { [STAFF]: 'Cora Lead' },
      staff: [staffPerf()],
    };
    renderWithProviders(<IstPayrollPage />, { user: VIEWER });
    expect(await screen.findByText('Calculable')).toBeTruthy();
    expect(screen.getByText('₱12,345.60')).toBeTruthy();
    expect(screen.getByText('Approved ₱100.00')).toBeTruthy();
  });

  it('opens the evidence drill-down with the payment items', async () => {
    performance = {
      period: '2026-11',
      ruleId: null,
      ruleVersion: null,
      ruleBlocker: null,
      staffNames: { [STAFF]: 'Cora Lead' },
      staff: [staffPerf()],
    };
    renderWithProviders(<IstPayrollPage />, { user: VIEWER });
    await userEvent.click(await screen.findByRole('button', { name: /View evidence/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('₱5,000.00')).toBeTruthy();
    expect(within(dialog).getByText('down payment')).toBeTruthy();
    expect(within(dialog).getByText('Undetermined')).toBeTruthy();
    expect(within(dialog).getByText('A verified payment has no count date.')).toBeTruthy();
    expect(within(dialog).getByText('Yes')).toBeTruthy();
    expect(calls.some((c) => c.url.includes(`/performance/${STAFF}/evidence?period=`))).toBe(true);
  });
});

describe('Payroll lines reviewer name', () => {
  const line = (over: Record<string, unknown>) =>
    ({
      id: 'f1111111-1111-4111-8111-111111111111',
      batchId: 'f2222222-2222-4222-8222-222222222222',
      staffId: STAFF,
      staffName: 'Ana IST',
      rank: 'SM',
      status: 'computed',
      blockedReason: null,
      policyId: null,
      ba: '1.00',
      pa: '1.00',
      pb: '1.00',
      adjustments: '0.00',
      withheld: '0.00',
      net: '3.00',
      reviewRequired: true,
      reviewFlags: [],
      reviewedBy: ME,
      reviewedAt: '2026-11-05T00:00:00Z',
      reviewNote: 'Checked',
      disbursement: null,
      ...over,
    }) as never;

  it('shows the reviewer name instead of the id', () => {
    renderWithProviders(
      <PayrollLinesTable lines={[line({ reviewedByName: 'Riley Reviewer' })]} />,
      {
        user: VIEWER,
      },
    );
    expect(screen.getByText(/by Riley Reviewer: Checked/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(ME))).toBeNull();
  });

  it('keeps an external payment visible with an unresolved evidence warning', () => {
    renderWithProviders(<PayrollLinesTable lines={[line({ disbursement: {
      id: 'f3333333-3333-4333-8333-333333333333', paidOn: '2026-11-05',
      amount: '3.00', evidenceChanged: true, reconciled: false, proofReference: 'TEST ONLY external receipt',
    } })]} onReconcile={vi.fn()} />, { user: VIEWER });
    expect(screen.getByText('Evidence changed after approval')).toBeTruthy();
    expect(screen.getByText('Note: TEST ONLY external receipt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review reconciliation' })).toBeTruthy();
  });
});
