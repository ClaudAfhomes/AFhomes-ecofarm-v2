import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { membershipSchema, pointsAccountSchema, type AfHomesPermission } from '@jad/contracts';
import { renderWithProviders } from '../../test/utils';
import { MembershipActivity } from './MembershipActivity';
import { getMembership, getMembershipLedger, getMembershipPoints } from './services';
import { getSalePayments } from '../business/services';
vi.mock('./services', () => ({
  getMembership: vi.fn(),
  getMembershipPoints: vi.fn(),
  getMembershipLedger: vi.fn(),
}));
vi.mock('../business/services', () => ({ getSalePayments: vi.fn() }));
vi.mock('../reports/services', () => ({ getReport: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const id = '00000000-0000-4000-8000-000000000001';
const saleId = '00000000-0000-4000-8000-000000000002';
const accountId = '00000000-0000-4000-8000-000000000003';
const grant = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});
const open = (label: string) => {
  const details = screen.getByText(label).closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
};
it('shows no restricted activity and performs no requests without grants', () => {
  renderWithProviders(<MembershipActivity id={id} number="MBS-QA-1" permissions={[]} />);
  expect(screen.queryByText('Payments')).not.toBeInTheDocument();
  expect(screen.queryByText('Points')).not.toBeInTheDocument();
  expect(getMembership).not.toHaveBeenCalled();
  expect(getMembershipPoints).not.toHaveBeenCalled();
  expect(getSalePayments).not.toHaveBeenCalled();
});
it('loads authoritative points and its ledger lazily through the account identifier', async () => {
  vi.mocked(getMembershipPoints).mockResolvedValue(
    pointsAccountSchema.parse({
      id: accountId,
      membershipId: id,
      balance: 52000,
      lifetimeAllocated: 60000,
      lifetimeRedeemed: 8000,
      updatedAt: '2026-10-01',
    }),
  );
  vi.mocked(getMembershipLedger).mockResolvedValue([]);
  renderWithProviders(
    <MembershipActivity id={id} number="MBS-QA-1" permissions={[grant('finance.points')]} />,
  );
  expect(getMembershipPoints).not.toHaveBeenCalled();
  open('Points');
  expect(await screen.findByText(/Balance: 52,000/)).toBeInTheDocument();
  await waitFor(() => expect(getMembershipLedger).toHaveBeenCalledWith(accountId));
  expect(getSalePayments).not.toHaveBeenCalled();
});
it('resolves the membership sale before loading its payments', async () => {
  vi.mocked(getMembership).mockResolvedValue(
    membershipSchema.parse({
      id,
      customerId: id,
      customerName: 'QA Customer',
      customerStatus: 'active',
      saleId,
      membershipNumber: 'MBS-QA-1',
      productId: null,
      productName: 'Gold',
      categoryName: null,
      status: 'active',
      paymentScheme: 'spot_cash',
      pointsBalance: 52000,
      yearlyPointsAllocated: 25000,
      activatedAt: null,
      expiresAt: null,
      renewalDueAt: null,
      cardIssuedAt: null,
      issuedBy: null,
      lastPrintedAt: null,
      printCount: 0,
      createdAt: '2026-10-01',
    }),
  );
  vi.mocked(getSalePayments).mockResolvedValue([]);
  renderWithProviders(
    <MembershipActivity
      id={id}
      number="MBS-QA-1"
      permissions={[grant('finance.payment_verification')]}
    />,
  );
  open('Payments');
  expect(await screen.findByText('No payments recorded.')).toBeInTheDocument();
  expect(getMembership).toHaveBeenCalledWith(id);
  expect(getSalePayments).toHaveBeenCalledWith(saleId);
  expect(getMembershipPoints).not.toHaveBeenCalled();
});
