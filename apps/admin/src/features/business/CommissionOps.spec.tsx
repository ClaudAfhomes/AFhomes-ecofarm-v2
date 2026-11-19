import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { BusinessCommissionsPage } from './BusinessCommissionsPage';
import * as ops from './services-commission-ops';
import * as evidence from './services-external-evidence';

const EARNED_ID = '11111111-0000-4000-8000-000000000001';
const PAID_ID = '11111111-0000-4000-8000-000000000002';
const PAYOUT_ID = '44444444-0000-4000-8000-000000000001';
const CASE_ID = '55555555-0000-4000-8000-000000000001';

const base = {
  saleId: '22222222-0000-4000-8000-000000000001',
  beneficiaryType: 'staff',
  rate: '0.0400',
  basisAmount: '60000.00',
  amount: '2400.00',
  qualificationNotes: null,
  qualifiedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const COMMISSIONS = [
  {
    ...base,
    id: EARNED_ID,
    commissionNumber: 'AF-COM-00001',
    saleNumber: 'SALE-000001',
    beneficiaryName: 'ANA REYES',
    status: 'earned',
    earnedAt: '2026-10-02T00:00:00.000Z',
    paidAt: null,
  },
  {
    ...base,
    id: PAID_ID,
    commissionNumber: 'AF-COM-00002',
    saleNumber: 'SALE-000002',
    beneficiaryName: 'BEN CRUZ',
    status: 'paid',
    earnedAt: '2026-10-02T00:00:00.000Z',
    paidAt: '2026-10-03T00:00:00.000Z',
  },
];

vi.mock('./services', () => ({
  getCommissions: vi.fn(async () => COMMISSIONS),
  markCommissionPaid: vi.fn(),
  qualifyCommission: vi.fn(),
}));

vi.mock('./services-commission-ops', () => ({
  setCommissionHold: vi.fn(async () => ({ id: '11111111-0000-4000-8000-000000000001' })),
  getCommissionPayouts: vi.fn(async (id: string) =>
    id === '11111111-0000-4000-8000-000000000001'
      ? []
      : [
          {
            id: '44444444-0000-4000-8000-000000000001',
            commissionId: id,
            amount: '2400.00',
            status: 'paid',
            bankReference: 'BANK-123',
            method: null,
            paidOn: '2026-10-03',
            failureReason: null,
            recordedBy: null,
            recordedAt: '2026-10-03T00:00:00.000Z',
            reconciledBy: null,
            reconciledAt: null,
          },
        ],
  ),
  getCommissionRecoveries: vi.fn(async () => [
    {
      id: '55555555-0000-4000-8000-000000000001',
      commissionId: '11111111-0000-4000-8000-000000000002',
      trigger: 'rescission',
      paymentAdjustmentId: null,
      proposedAmount: '500.00',
      recoveredAmount: '0.00',
      reason: 'Sale rescinded by customer',
      status: 'proposed',
      requestedBy: '00000000-0000-4000-8000-0000000000aa',
      requestedAt: '2026-10-04T00:00:00.000Z',
      dismissedBy: null,
      dismissedAt: null,
      dismissalNote: null,
    },
  ]),
  recordCommissionPayoutFailure: vi.fn(async () => ({
    id: '11111111-0000-4000-8000-000000000001',
  })),
  reconcileCommissionPayout: vi.fn(async () => ({ id: '11111111-0000-4000-8000-000000000001' })),
  proposeCommissionRecovery: vi.fn(async () => ({ id: '11111111-0000-4000-8000-000000000001' })),
  dismissCommissionRecovery: vi.fn(async () => ({ id: '11111111-0000-4000-8000-000000000001' })),
}));

vi.mock('./services-external-evidence', () => ({
  getExternalEvidence: vi.fn(async (_s: string, id: string) => ({
    subjectType: 'commission_payout',
    subjectId: id,
    status: 'EVIDENCE_EXCEPTION',
    exceptionReview: null,
    items: [],
  })),
  recordExternalEvidence: vi.fn(async () => ({ id: '66666666-0000-4000-8000-000000000001' })),
  uploadExternalEvidence: vi.fn(),
  reviewCommissionEvidenceException: vi.fn(async () => ({ id: 'x' })),
}));

const user = (canUpdate: boolean): SessionUser => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Finance Admin',
  email: 'admin@afhomes.test',
  roleId: 'r-admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    { moduleKey: 'finance.commission_payouts', canView: true, canCreate: false, canUpdate, canDelete: false },
    {
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: false,
      canUpdate,
      canDelete: false,
    },
  ],
});

afterEach(() => vi.clearAllMocks());

const openOps = async (name: string) => {
  const row = (await screen.findByText(name)).closest('tr')!;
  const u = userEvent.setup();
  await u.click(within(row).getByRole('button', { name: /hold, payouts/i }));
  return u;
};

describe('commission operations', () => {
  it('lets Finance manage payout records without commission qualification authority', async () => {
    const finance = user(true);
    finance.afHomesPermissions = finance.afHomesPermissions.filter((p) => p.moduleKey === 'finance.commission_payouts');
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    const row = (await screen.findByText('ANA REYES')).closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Record External Commission Payment' })).toBeEnabled();
    await userEvent.click(within(row).getByRole('button', { name: 'Commission Payouts' }));
    expect(await screen.findByRole('button', { name: 'Record failed transfer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put on hold' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Qualify Commission' })).toBeNull();
    expect(ops.getCommissionRecoveries).not.toHaveBeenCalled();
  });

  it('does not grant external payout recording from qualification permission alone', async () => {
    const qualifier = user(true);
    qualifier.afHomesPermissions = qualifier.afHomesPermissions.filter((p) => p.moduleKey === 'network.commissions');
    renderWithProviders(<BusinessCommissionsPage />, { user: qualifier });
    await screen.findByText('ANA REYES');
    expect(screen.queryByRole('button', { name: 'Record External Commission Payment' })).toBeNull();
    const u = await openOps('BEN CRUZ');
    expect(await screen.findByText('Payout history')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconcile Commission Payout' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('hides every operation without update permission', async () => {
    renderWithProviders(<BusinessCommissionsPage />, { user: user(false) });
    await screen.findByText('ANA REYES');
    expect(screen.queryByRole('button', { name: /hold, payouts/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /record external commission payment/i })).toBeNull();
  });

  it('a hold disables Pay with the reason, and release re-enables it', async () => {
    renderWithProviders(<BusinessCommissionsPage />, { user: user(true) });
    const u = await openOps('ANA REYES');
    await u.type(screen.getByLabelText(/reason for the hold/i), 'Awaiting audit review');
    await u.click(screen.getByRole('button', { name: 'Put on hold' }));
    expect(ops.setCommissionHold).toHaveBeenCalledWith(EARNED_ID, {
      withheld: true,
      reason: 'Awaiting audit review',
    });
    await screen.findByRole('button', { name: 'Release hold' });
    await u.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: /record external commission payment/i })).toBeDisabled();
    expect(screen.getByText('On hold: Awaiting audit review')).toBeInTheDocument();
  });

  it('records a failed transfer with a bank reference', async () => {
    renderWithProviders(<BusinessCommissionsPage />, { user: user(true) });
    const u = await openOps('ANA REYES');
    await u.type(screen.getByLabelText(/bank reference of the failed/i), 'FAIL-9');
    await u.type(screen.getByLabelText(/what went wrong/i), 'Account closed');
    await u.click(screen.getByRole('button', { name: 'Record failed transfer' }));
    expect(ops.recordCommissionPayoutFailure).toHaveBeenCalledWith(EARNED_ID, {
      reason: 'Account closed',
      bankReference: 'FAIL-9',
    });
  });

  it('reconciles a paid payout with its recorded date prefilled, proposes and dismisses recoveries', async () => {
    renderWithProviders(<BusinessCommissionsPage />, { user: user(true) });
    const u = await openOps('BEN CRUZ');
    expect(await screen.findByLabelText(/date on bank statement/i)).toHaveValue('2026-10-03');
    await u.click(screen.getByRole('button', { name: 'Reconcile Commission Payout' }));
    expect(ops.reconcileCommissionPayout).toHaveBeenCalledWith(PAYOUT_ID, { paidOn: '2026-10-03' });

    expect(screen.getByText('Proposal only — no money is deducted.')).toBeInTheDocument();
    await u.type(screen.getByLabelText(/proposed amount/i), '1500.00');
    await u.type(screen.getByLabelText(/^reason$/i), 'Check was returned');
    await u.click(screen.getByRole('button', { name: 'Propose recovery' }));
    expect(ops.proposeCommissionRecovery).toHaveBeenCalledWith(PAID_ID, {
      trigger: 'sale_cancellation',
      amount: '1500.00',
      reason: 'Check was returned',
    });

    await u.type(screen.getByLabelText(/reason for dismissing/i), 'Raised in error');
    await u.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(ops.dismissCommissionRecovery).toHaveBeenCalledWith(CASE_ID, {
      reason: 'Raised in error',
    });

    expect(screen.queryByRole('button', { name: /approve|deduct|recover now/i })).toBeNull();
  });

  it('requires a reason to change a recorded payment date and refuses a future date', async () => {
    renderWithProviders(<BusinessCommissionsPage />, { user: user(true) });
    const u = await openOps('BEN CRUZ');
    const date = await screen.findByLabelText(/date on bank statement/i);
    const button = screen.getByRole('button', { name: 'Reconcile Commission Payout' });
    await u.clear(date);
    await u.type(date, '2999-01-01');
    expect(button).toBeDisabled();
    await u.clear(date);
    await u.type(date, '2026-10-01');
    expect(button).toBeDisabled();
    await u.type(screen.getByLabelText(/reason for changing the recorded date/i), 'Bank statement shows Oct 1');
    await u.click(button);
    expect(ops.reconcileCommissionPayout).toHaveBeenCalledWith(PAYOUT_ID, {
      paidOn: '2026-10-01',
      dateCorrectionReason: 'Bank statement shows Oct 1',
    });
  });

  it('blocks confirming a payout with no evidence until evidence or an exception review exists', async () => {
    vi.mocked(ops.getCommissionPayouts).mockImplementationOnce(async (id: string) => [
      {
        id: PAYOUT_ID,
        commissionId: id,
        amount: '2400.00',
        status: 'paid',
        bankReference: 'BANK-123',
        method: null,
        paidOn: '2026-10-03',
        failureReason: null,
        recordedBy: null,
        recordedAt: '2026-10-03T00:00:00.000Z',
        reconciledBy: null,
        reconciledAt: null,
        evidenceStatus: 'EVIDENCE_EXCEPTION',
        evidenceExceptionReviewed: false,
        postingPeriod: '2026-10',
      },
    ]);
    renderWithProviders(<BusinessCommissionsPage />, { user: user(true) });
    const u = await openOps('BEN CRUZ');
    expect(await screen.findByText('No verifiable evidence')).toBeInTheDocument();
    expect(screen.getByText(/posted to 2026-10/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconcile Commission Payout' })).toBeDisabled();

    // A description alone cannot be attached: the reference is required.
    await u.type(screen.getByLabelText(/issued by/i), 'BDO');
    await u.type(screen.getByLabelText(/^description/i), 'Paid by transfer');
    const attach = screen.getByRole('button', { name: 'Attach evidence' });
    expect(attach).toBeDisabled();
    await u.type(screen.getByLabelText(/transaction reference/i), 'TXN-778899');
    // The transfer amount is prefilled with the payout amount and is required.
    const transfer = screen.getByLabelText(/transfer amount/i);
    expect(transfer).toHaveValue('2400.00');
    await u.clear(transfer);
    expect(attach).toBeDisabled();
    await u.type(transfer, '5000.00');
    await u.click(attach);
    expect(evidence.recordExternalEvidence).toHaveBeenCalledWith('commission_payout', PAYOUT_ID, {
      evidenceType: 'external_transaction_reference',
      transactionReference: 'TXN-778899',
      transferAmount: '5000.00',
      source: 'BDO',
      description: 'Paid by transfer',
    });

    await u.type(screen.getByLabelText(/why no evidence exists/i), 'Paid in cash, no slip kept');
    await u.click(screen.getByRole('button', { name: 'Record exception review' }));
    expect(evidence.reviewCommissionEvidenceException).toHaveBeenCalledWith(
      PAYOUT_ID,
      'Paid in cash, no slip kept',
    );
  });
});
