import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Commission } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import { ApiError } from '../../lib/api/errors';
import type { SessionUser } from '../../lib/session';
import { BusinessCommissionsPage } from './BusinessCommissionsPage';
import { collectionPercent } from './CommissionDetailDialog';
import { manilaToday } from './payroll-utils';
import { businessKeys } from './queryKeys';
import * as services from './services';

const EARNED_ID = '11111111-0000-4000-8000-000000000001';
const PAID_ID = '11111111-0000-4000-8000-000000000002';
const SALE_ID = '22222222-0000-4000-8000-000000000001';
const LEGACY_ID = '11111111-0000-4000-8000-000000000003';
const PENDING_ID = '11111111-0000-4000-8000-000000000004';
const OTHER_SALE_ID = '22222222-0000-4000-8000-000000000002';

const COMMISSIONS = [
  {
    id: EARNED_ID,
    commissionNumber: 'AF-COM-00001',
    saleId: SALE_ID,
    saleNumber: 'SALE-000001',
    beneficiaryType: 'staff',
    beneficiaryName: 'ANA REYES',
    rate: '0.0400',
    basisAmount: '60000.00',
    amount: '2400.00',
    status: 'earned',
    qualificationNotes: 'Qualified after activation.',
    qualifiedAt: '2026-10-01T00:00:00.000Z',
    earnedAt: '2026-10-02T00:00:00.000Z',
    paidAt: null,
    eligibleAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: PAID_ID,
    commissionNumber: 'AF-COM-00002',
    saleId: SALE_ID,
    saleNumber: 'SALE-000001',
    beneficiaryType: 'staff',
    beneficiaryName: 'BEA CRUZ',
    rate: '0.0400',
    basisAmount: '60000.00',
    amount: '2400.00',
    status: 'paid',
    qualificationNotes: 'Qualified for the paid record.',
    qualifiedAt: '2026-10-01T00:00:00.000Z',
    earnedAt: '2026-10-02T00:00:00.000Z',
    paidAt: '2026-11-03T02:00:00.000Z',
    paidOn: '2026-11-02',
    paidMethod: 'Cheque',
    paidReference: 'BDO-9902',
    paidEvidenceReference: 'Deposit slip 9902 on file',
    eligibleAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    // Approved, but no eligibility date was ever recorded (e.g. an imported commission).
    id: LEGACY_ID,
    commissionNumber: 'AF-COM-00003',
    saleId: SALE_ID,
    saleNumber: 'SALE-000001',
    beneficiaryType: 'staff',
    beneficiaryName: 'CARL DIAZ',
    rate: '0.0400',
    basisAmount: '60000.00',
    amount: '2400.00',
    status: 'earned',
    qualificationNotes: 'Qualified on the imported record.',
    qualifiedAt: '2026-10-01T00:00:00.000Z',
    earnedAt: '2026-10-02T00:00:00.000Z',
    paidAt: null,
    eligibleAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: PENDING_ID,
    commissionNumber: 'AF-COM-00004',
    saleId: OTHER_SALE_ID,
    saleNumber: 'SALE-000002',
    beneficiaryType: 'staff',
    beneficiaryName: 'DINA LIM',
    rate: '0.0400',
    basisAmount: '60000.00',
    amount: '2400.00',
    status: 'pending',
    qualificationNotes: null,
    qualifiedAt: null,
    earnedAt: null,
    paidAt: null,
    eligibleAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

const payment = (n: number, amount: string, status: string) => ({
  id: `33333333-0000-4000-8000-00000000000${n}`,
  saleId: SALE_ID,
  paymentNumber: `AF-PAY-0000${n}`,
  customerId: null,
  amount,
  paymentType: 'installment',
  method: 'cash',
  reference: null,
  notes: null,
  status,
  rejectionReason: null,
  recordedBy: '00000000-0000-4000-8000-0000000000aa',
  verifiedBy: status === 'verified' ? '00000000-0000-4000-8000-0000000000aa' : null,
  paymentPurpose: null,
  recordedAt: '2026-09-10T00:00:00.000Z',
  verifiedAt: status === 'verified' ? '2026-09-11T00:00:00.000Z' : null,
});

vi.mock('./services', () => ({
  getCommissions: vi.fn(async () => COMMISSIONS),
  markCommissionPaid: vi.fn(async () => ({ ...COMMISSIONS[0], status: 'paid' })),
  qualifyCommission: vi.fn(),
  getSalePayments: vi.fn(async (saleId: string) =>
    saleId === SALE_ID
      ? [
          payment(1, '20000.00', 'verified'),
          payment(2, '4000.00', 'verified'),
          payment(3, '9000.00', 'recorded'),
        ]
      : [],
  ),
}));

// The hold flow. The refreshed list does not echo a hold, so it lives in the session only.
vi.mock('./services-commission-ops', () => ({
  setCommissionHold: vi.fn(async () => ({ id: '11111111-0000-4000-8000-000000000001' })),
  getCommissionPayouts: vi.fn(async () => []),
  getCommissionRecoveries: vi.fn(async () => []),
  recordCommissionPayoutFailure: vi.fn(),
  reconcileCommissionPayout: vi.fn(),
  proposeCommissionRecovery: vi.fn(),
  dismissCommissionRecovery: vi.fn(),
}));

const finance: SessionUser = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Finance',
  email: 'finance@afhomes.test',
  roleId: 'r-finance',
  roleName: 'Finance',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'finance.commission_payouts',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    },
    {
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

// A seller reads commissions in seller scope: no payout permission, and the API masks
// Finance's evidence reference (paidEvidenceReference: null).
const seller: SessionUser = {
  id: '00000000-0000-4000-8000-0000000000bb',
  name: 'Seller',
  email: 'seller@afhomes.test',
  roleId: 'r-sm',
  roleName: 'Sales Manager',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
};

// Qualifies commissions and records payouts, so the operations dialog offers the hold.
const approver: SessionUser = {
  ...finance,
  afHomesPermissions: [
    {
      moduleKey: 'finance.commission_payouts',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    },
    {
      moduleKey: 'network.commissions',
      canView: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    },
  ],
};

const asRows = (rows: object[]) => rows as unknown as Commission[];
const valueOf = (dialog: HTMLElement, label: string) =>
  within(dialog).getByText(label).nextElementSibling;

afterEach(() => vi.clearAllMocks());

describe('external commission payment', () => {
  it('requires a reference and evidence, and sends method and date with the frozen commission', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    const row = (await screen.findByText('ANA REYES')).closest('tr')!;
    await u.click(within(row).getByRole('button', { name: 'Record External Commission Payment' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', {
      name: 'Record External Commission Payment',
    });
    expect(submit).toBeDisabled();
    expect(within(dialog).getByLabelText('Payment method')).toHaveValue('Bank transfer');
    await u.type(within(dialog).getByLabelText(/external payment reference/i), 'BDO-7781');
    await u.clear(within(dialog).getByLabelText('Payment date'));
    await u.type(within(dialog).getByLabelText('Payment date'), '2026-11-02');
    await u.selectOptions(within(dialog).getByLabelText('Payment method'), 'Cheque');
    // Reference alone is not enough: the evidence reference needs at least 10 characters.
    expect(submit).toBeDisabled();
    await u.type(within(dialog).getByLabelText(/payment evidence reference/i), 'Cheque 7781');
    expect(submit).toBeEnabled();
    await u.click(submit);
    expect(services.markCommissionPaid).toHaveBeenCalledWith(EARNED_ID, {
      reference: 'BDO-7781',
      method: 'Cheque',
      paidOn: '2026-11-02',
      evidenceReference: 'Cheque 7781',
    });
  });

  it('keeps the action disabled for a reference with no letter or number', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    const row = (await screen.findByText('ANA REYES')).closest('tr')!;
    await u.click(within(row).getByRole('button', { name: 'Record External Commission Payment' }));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText(/payment evidence reference/i), 'Deposit slip 7781');
    await u.type(within(dialog).getByLabelText(/external payment reference/i), '- / -');
    const submit = within(dialog).getByRole('button', {
      name: 'Record External Commission Payment',
    });
    expect(submit).toBeDisabled();
    await u.type(within(dialog).getByLabelText(/external payment reference/i), '7');
    expect(submit).toBeEnabled();
  });

  it('refuses a future payment date in the form', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    const row = (await screen.findByText('ANA REYES')).closest('tr')!;
    await u.click(within(row).getByRole('button', { name: 'Record External Commission Payment' }));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText(/external payment reference/i), 'BDO-7781');
    await u.type(within(dialog).getByLabelText(/payment evidence reference/i), 'Deposit slip 7781');
    const date = within(dialog).getByLabelText('Payment date');
    // The picker offers nothing after today (Manila), and a typed future date says why.
    expect(date).toHaveAttribute('max', manilaToday());
    expect(date).toHaveAttribute('min', '2000-01-01');
    await u.clear(date);
    await u.type(date, '2999-01-01');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The payment date cannot be in the future.',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Record External Commission Payment' }),
    ).toBeDisabled();
  });

  it('refuses a date before the sanity floor with its own reason', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    const row = (await screen.findByText('ANA REYES')).closest('tr')!;
    await u.click(within(row).getByRole('button', { name: 'Record External Commission Payment' }));
    const dialog = await screen.findByRole('dialog');
    await u.type(within(dialog).getByLabelText(/external payment reference/i), 'BDO-7781');
    await u.type(within(dialog).getByLabelText(/payment evidence reference/i), 'Deposit slip 7781');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await u.clear(within(dialog).getByLabelText('Payment date'));
    await u.type(within(dialog).getByLabelText('Payment date'), '1999-12-31');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a real payment date.');
    expect(
      within(dialog).getByRole('button', { name: 'Record External Commission Payment' }),
    ).toBeDisabled();
  });

  it('caps the reference and evidence at the server limits', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    const row = (await screen.findByText('ANA REYES')).closest('tr')!;
    await u.click(within(row).getByRole('button', { name: 'Record External Commission Payment' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/external payment reference/i)).toHaveAttribute(
      'maxlength',
      '100',
    );
    expect(within(dialog).getByLabelText(/payment evidence reference/i)).toHaveAttribute(
      'maxlength',
      '500',
    );
  });
});

describe('commission detail', () => {
  it('shows the frozen calculation, verified-only progress and the single next action', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00001/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(services.getSalePayments).toHaveBeenCalledWith(SALE_ID);
    // 20,000 + 4,000 verified; the recorded 9,000 is not money yet.
    expect(await within(dialog).findByText('40.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('Qualified after activation.')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Qualify Commission' })).toBeNull();
    await u.click(
      within(dialog).getByRole('button', { name: 'Record External Commission Payment' }),
    );
    expect(await screen.findByLabelText(/external payment reference/i)).toBeInTheDocument();
  });

  it('shows the recorded payout facts on a paid commission and offers no further action', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00002/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Cheque')).toBeInTheDocument();
    expect(within(dialog).getByText('BDO-9902')).toBeInTheDocument();
    expect(within(dialog).getByText('Deposit slip 9902 on file')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Record External Commission Payment' }),
    ).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Qualify Commission' })).toBeNull();
  });

  it('reads a missing eligibility date as not recorded once the commission is past review', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00003/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Date not recorded')).toBeInTheDocument();
    expect(within(dialog).queryByText('Not yet eligible')).toBeNull();
  });

  it('says "Not yet eligible" only while the commission is still expected', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00004/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Not yet eligible')).toBeInTheDocument();
    expect(await within(dialog).findByText('No verified payments')).toBeInTheDocument();
  });

  it('shows the recorded payment date as entered, whatever the viewer time zone', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      const u = userEvent.setup();
      renderWithProviders(<BusinessCommissionsPage />, { user: finance });
      await u.click(
        await screen.findByRole('button', { name: /view details for commission AF-COM-00002/i }),
      );
      const dialog = await screen.findByRole('dialog');
      // Proof the zone switch took effect: an instant still renders in the viewer's zone.
      expect(within(dialog).getByText('Aug 31, 2026')).toBeInTheDocument();
      // 2026-11-02 is a calendar date: west of UTC it must not read as Nov 1.
      expect(within(dialog).getByText('Nov 2, 2026')).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps an open detail in step with the refreshed list', async () => {
    const u = userEvent.setup();
    const { client } = renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00001/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Record External Commission Payment' }),
    ).toBeInTheDocument();
    // Another session records the payment; the next refresh carries it into the open detail.
    vi.mocked(services.getCommissions).mockResolvedValueOnce(
      asRows(
        COMMISSIONS.map((c) =>
          c.id === EARNED_ID
            ? {
                ...c,
                status: 'paid',
                paidAt: '2026-11-03T02:00:00.000Z',
                paidOn: '2026-11-02',
                paidMethod: 'Cash',
                paidReference: 'CASH-0042',
                paidEvidenceReference: 'Cash voucher 0042 on file',
              }
            : c,
        ),
      ),
    );
    await act(() => client.invalidateQueries({ queryKey: businessKeys.commissionsScope }));
    expect(await within(dialog).findByText('CASH-0042')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Record External Commission Payment' }),
    ).toBeNull();
  });

  it('shows a seller no evidence row, never a misleading "—"', async () => {
    vi.mocked(services.getCommissions).mockResolvedValueOnce(
      asRows(COMMISSIONS.map((c) => ({ ...c, paidEvidenceReference: null }))),
    );
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: seller });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00002/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('BDO-9902')).toBeInTheDocument();
    expect(within(dialog).queryByText('Payout evidence')).toBeNull();
  });

  it('tells Finance the payout evidence is not recorded yet', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00001/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(valueOf(dialog, 'Payout evidence')).toHaveTextContent('—');
  });

  it('says the collection figures are unavailable when the payments cannot load', async () => {
    vi.mocked(services.getSalePayments).mockRejectedValueOnce(
      new Error('Payments are unavailable.'),
    );
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: finance });
    await u.click(
      await screen.findByRole('button', { name: /view details for commission AF-COM-00001/i }),
    );
    const dialog = await screen.findByRole('dialog');
    // The evidence list shows the retryable error state; the derived figures do not spin forever.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'We couldn’t load this information',
    );
    expect(valueOf(dialog, 'Verified collections')).toHaveTextContent('Unavailable');
    expect(valueOf(dialog, 'Collection progress')).toHaveTextContent('Unavailable');
  });

  it.each([403, 404])(
    'tells a viewer the server does not show them the payments (%i), with no dead-end retry',
    async (status) => {
      vi.mocked(services.getSalePayments).mockRejectedValueOnce(
        new ApiError({
          code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
          message: 'Refused',
          status,
        }),
      );
      const u = userEvent.setup();
      renderWithProviders(<BusinessCommissionsPage />, { user: seller });
      await u.click(
        await screen.findByRole('button', { name: /view details for commission AF-COM-00001/i }),
      );
      const dialog = await screen.findByRole('dialog');
      // An answer about access, not a fault: retrying can never change it.
      expect(
        await within(dialog).findByText(
          /payment records for this sale are not shown to your account/i,
        ),
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole('alert')).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(valueOf(dialog, 'Verified collections')).toHaveTextContent('Not shown');
      expect(valueOf(dialog, 'Collection progress')).toHaveTextContent('Not shown');
    },
  );

  it('shows a hold placed in this session, as the list row does, and offers no payment', async () => {
    const u = userEvent.setup();
    renderWithProviders(<BusinessCommissionsPage />, { user: approver });
    const row = (await screen.findByText('ANA REYES')).closest('tr')!;
    await u.click(within(row).getByRole('button', { name: /hold, payouts/i }));
    await u.type(await screen.findByLabelText(/reason for the hold/i), 'Awaiting audit review');
    await u.click(screen.getByRole('button', { name: 'Put on hold' }));
    await screen.findByRole('button', { name: 'Release hold' });
    await u.click(screen.getByRole('button', { name: 'Close' }));
    expect(within(row).getByText('On hold: Awaiting audit review')).toBeInTheDocument();
    await u.click(
      screen.getByRole('button', { name: /view details for commission AF-COM-00001/i }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(valueOf(dialog, 'On hold')).toHaveTextContent('Awaiting audit review');
    expect(
      within(dialog).queryByRole('button', { name: 'Record External Commission Payment' }),
    ).toBeNull();
  });

  it('floors collection progress so the milestone is never overstated', () => {
    expect(collectionPercent('23999.99', '60000.00')).toBe('39.9%');
    expect(collectionPercent('24000.00', '60000.00')).toBe('40.0%');
    expect(collectionPercent('0.00', '0.00')).toBe('—');
  });
});
