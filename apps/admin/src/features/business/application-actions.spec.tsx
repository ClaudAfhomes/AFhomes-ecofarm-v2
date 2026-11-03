import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { customerApplicationSchema, type CustomerApplicationStatus } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { CustomerApplicationEditorPage } from './OfficialFormsPages';
import {
  decideCustomerApplication,
  exportCustomerApplication,
  getCustomerApplication,
  getReservationAgreements,
  reopenCustomerApplication,
  reviewApplicationPurchaseTerms,
} from './services';
import { purchaseTermsProposalSchema } from '@afhomes/contracts';
import { notifyWarning } from '@afhomes/ui';

vi.mock('@afhomes/ui', async (original) => {
  const actual = await original<typeof import('@afhomes/ui')>();
  return { ...actual, notifyWarning: vi.fn(actual.notifyWarning) };
});

/** A server-shaped offer. Built lazily: the module mock factory runs before ids. */
const buildOffer = () =>
  purchaseTermsProposalSchema.parse({
    applicationId: id,
    expectedProposalHash: 'a'.repeat(64),
    asOf: '2026-10-07T00:00:00.000Z',
    offerKind: 'submission',
    sellerName: 'QA SELLER',
    terms: {
      applicationId: id,
      customerId: id,
      planId: id,
      sellerStaffId: id,
      captureKind: 'submission',
      tier: 'BRONZE',
      paymentScheme: 'spot_cash',
      totalPrice: '54000.00',
      reservationFee: '10000.00',
      minimumDownPayment: '10000.00',
      requiredInitial: '10000.00',
      installmentMonths: null,
      monthlyAmount: null,
      spotCashDays: 7,
      validityMonths: 84,
      discountPercent: 15,
      yearlyPoints: 10000,
      annualPointsTranches: 5,
      holderLimit: 1,
      inclusions: ['Priority reservation: yes'],
      commissionRuleId: null,
      commissionRate: '0',
      commissionBase: '54000.00',
      expectedCommission: '0.00',
    },
  });

vi.mock('./services', async (original) => ({
  ...(await original()),
  getCustomers: async () => [],
  getCardProducts: async () => [],
  getCustomerApplication: vi.fn(),
  // The offer is server-authoritative; the screen only reads and echoes its hash.
  getPurchaseTermsProposal: vi.fn(async () => buildOffer()),
  decideCustomerApplication: vi.fn(),
  reopenCustomerApplication: vi.fn(),
  reviewApplicationPurchaseTerms: vi.fn(async () => detail('submitted')),
  exportCustomerApplication: vi.fn(),
  // The workflow panel reads the reservation this application produced, so the
  // next action is derived from real server state rather than local guesswork.
  getReservationAgreements: vi.fn(async () => []),
}));
vi.mock('../documents/services', async (original) => ({
  ...(await original()),
  getDocuments: async () => [],
  getCurrentDocument: async () => null,
}));
vi.mock('../genealogy/services', () => ({
  getGenealogy: async () => [],
  getGenealogyNode: async () => null,
  getGenealogyUpline: async () => [],
  getGenealogyDownline: async () => [],
  getGenealogySummary: async () => null,
}));
vi.mock('../../lib/download', () => ({ downloadFile: vi.fn() }));

const id = '00000000-0000-4000-8000-000000000001';
const detail = (status: CustomerApplicationStatus) =>
  customerApplicationSchema.parse({
    id,
    applicationNumber: 'QA APPLICATION',
    purchaseTermsId: id,
    customerId: id,
    planId: id,
    tier: 'BRONZE',
    paymentScheme: 'spot_cash',
    primary: {
      holderType: 'PRIMARY',
      lastName: 'Santos',
      firstName: 'Ana',
      birthDate: '1990-01-01',
      permanentAddressLine1: 'QA ADDRESS',
      cityMunicipality: 'CALAMBA',
      province: 'LAGUNA',
      mobile: '+639171234567',
      email: 'qa@example.test',
      printedName: 'Ana Santos',
    },
    acquisitionChannels: [],
    consentAcknowledged: true,
    acknowledgedAt: '2026-10-01',
    primarySignatureStatus: 'received',
    validIdReceived: false,
    reservationPaymentProofReceived: false,
    vipAmount: '60000.00',
    discountPercent: 10,
    validityYears: 1,
    yearlyPoints: 60000,
    annualPointsTranches: 1,
    holderLimit: 1,
    status,
    createdAt: '2026-10-01',
    updatedAt: '2026-10-01',
    submittedAt: null,
    approvedAt: null,
    rejectedAt: null,
  });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getReservationAgreements).mockResolvedValue([]); });

/** The MemoryRouter's live location, so a button's navigation is provable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <p role="status" aria-label="route">
      {location.pathname}
      {location.search}
    </p>
  );
}

async function show(status: CustomerApplicationStatus) {
  vi.mocked(getCustomerApplication).mockResolvedValue(detail(status));
  renderWithProviders(
    <Routes>
      <Route path="/admin/customers/applications/:id" element={<CustomerApplicationEditorPage />} />
      <Route path="*" element={<LocationProbe />} />
    </Routes>,
    {
      route: `/admin/customers/applications/${id}`,
      user: {
        id,
        name: 'QA ADMIN',
        email: 'qa@example.test',
        roleId: id,
        roleSlug: 'super_admin',
        roleName: 'Super Admin',
        status: 'active',
        afHomesPermissions: [],
      },
    },
  );
  await screen.findByText('QA APPLICATION');
  if (status === 'draft')
    await waitFor(() => expect(screen.getByLabelText('First name')).toHaveValue('Ana'));
}
it.each(['draft', 'submitted', 'approved', 'rejected', 'cancelled'] as const)(
  'keeps %s actions outside the read-only fields',
  async (status) => {
    await show(status);
    if (status === 'draft') {
      expect(screen.getByLabelText('First name')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    } else {
      expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    }
    const actions = screen.queryByRole('region', { name: 'Record actions' });
    if (status === 'submitted' || status === 'rejected') {
      expect(actions).toBeInTheDocument();
      expect(actions!.closest('fieldset')).toBeNull();
      expect(within(actions!).getByRole('button', { name: 'Reopen' })).toBeEnabled();
      for (const name of ['Approve', 'Reject']) {
        const button = within(actions!).getByRole('button', { name });
        if (status === 'submitted') expect(button).toBeEnabled();
        else expect(button).toBeDisabled();
      }
    } else expect(actions).not.toBeInTheDocument();
    for (const name of ['Export XLSX', 'Export PDF', 'Cancel'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  },
);

it('names every blocker of the single save-and-submit action', async () => {
  await show('draft');
  // One visible list next to the button, never a silent grey control: the
  // missing ID with its type is stated, and certification is already ticked in
  // this fixture so it does not appear.
  const alert = await screen.findByText('Cannot save and submit yet:');
  const list = alert.parentElement?.parentElement ?? alert.parentElement!;
  expect(list).toHaveTextContent('Upload a valid ID and choose its ID type.');
  expect(list).not.toHaveTextContent('Certification and consent must be ticked.');
});

it.each(['submitted', 'approved', 'rejected', 'cancelled'] as const)(
  'keeps the %s edit route read-only',
  async (status) => {
    vi.mocked(getCustomerApplication).mockResolvedValue(detail(status));
    renderWithProviders(
      <Routes>
        <Route path="/admin/customers/applications/:id/edit" element={<CustomerApplicationEditorPage />} />
      </Routes>,
      { route: `/admin/customers/applications/${id}/edit` },
    );
    expect(await screen.findByLabelText('First name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Record actions' })).not.toBeInTheDocument();
  },
);

/**
 * The next action is a NAVIGATION derived from server state. It never replaces
 * the lifecycle calls, so an illegal step stays illegal - the panel just shows
 * where the customer actually is.
 */
describe('purchase workflow next step', () => {
  const reservation = (status: string, saleId: string | null = null) => ({
    id: 'bbbbbbbb-0000-4000-8000-000000000009',
    reservationNumber: 'AF-RES-Y7USC',
    saleId,
    saleNumber: null,
    paymentScheme: 'spot_cash' as const,
    totalPrice: '60000.00',
    verifiedTotal: null,
    fullyPaid: false,
    hasSecondaryHolder: false,
    tier: 'BRONZE' as const,
    applicantName: 'ANA SANTOS',
    createdBy: null,
    createdAt: '2026-10-08',
    submittedAt: null,
    status: status as 'draft' | 'submitted' | 'executed' | 'cancelled',
    paymentStatus: null,
  });

  it('offers Create Reservation for an approved application with no reservation', async () => {
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Create Reservation' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent(
        `/admin/sales/reservations/new?application=${encodeURIComponent(id)}`,
      ),
    );
  });

  it('does not offer a reservation action while the current reservation is unknown', async () => {
    vi.mocked(getReservationAgreements).mockImplementationOnce(() => new Promise(() => {}));
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(within(panel).queryByRole('button', { name: 'Create Reservation' })).not.toBeInTheDocument();
  });

  it('requires a successful reservation lookup before offering creation', async () => {
    vi.mocked(getReservationAgreements).mockRejectedValueOnce(new Error('Reservation lookup unavailable'));
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(await within(panel).findByRole('button', { name: /retry/i })).toBeEnabled();
    expect(within(panel).queryByRole('button', { name: 'Create Reservation' })).not.toBeInTheDocument();
  });

  it('does not recapture frozen terms when approval has already created the reservation', async () => {
    vi.mocked(decideCustomerApplication).mockImplementation(async () => {
      vi.mocked(getReservationAgreements).mockResolvedValue([reservation('executed')]);
      vi.mocked(getCustomerApplication).mockResolvedValue(detail('approved'));
      return detail('approved');
    });
    await show('submitted');
    fireEvent.click(screen.getByRole('button',{name:'Approve'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout:4000 });
    expect(await screen.findByRole('button',{name:'Continue Payment'}, {timeout:4000})).toBeEnabled();
    expect(reviewApplicationPurchaseTerms).not.toHaveBeenCalled();
  });

  it('offers Continue Payment once the reservation is executed', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([reservation('executed')]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Continue Payment' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent('/admin/finance/payments'),
    );
  });

  it('offers Open Reservation before the agreement is executed', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([reservation('submitted')]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Open Reservation' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent(
        '/admin/sales/reservations/bbbbbbbb-0000-4000-8000-000000000009',
      ),
    );
  });

  it('hands a finalized purchase to the activation queue', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([
      reservation('executed', 'cccccccc-0000-4000-8000-000000000010'),
    ]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Continue Activation' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent('/admin/finance/activation'),
    );
  });

  it('ignores a cancelled reservation, which returns the customer to application work', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([reservation('cancelled')]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(await within(panel).findByRole('button', { name: 'Create Reservation' })).toBeEnabled();
    expect(within(panel).queryByRole('button', { name: 'Open Reservation' })).toBeNull();
  });

  it('asks a submitted application to review purchase terms instead of linking out', async () => {
    await show('submitted');
    const panel = await screen.findByLabelText('Purchase workflow');
    // No destination yet: the next step states the action, without a control.
    expect(within(panel).getByText('Review terms')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Review terms' })).toBeNull();
  });

  it('keeps a draft inside the application form', async () => {
    await show('draft');
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(within(panel).getByText('Continue draft')).toBeInTheDocument();
  });

  it('marks only reached steps as done', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([reservation('executed')]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    await waitFor(() => {
      for (const label of ['Application Submitted', 'Reservation Created'])
        expect(within(panel).getByText(label).closest('li')).toHaveAttribute('data-state', 'Done');
      expect(within(panel).getByText('Payment Processing').closest('li')).toHaveAttribute('data-state', 'Current');
      expect(within(panel).getByText('Commission').closest('li')).toHaveAttribute('data-state', 'Pending');
    });
  });
});
it('dispatches submitted decisions and reopen', async () => {
  await show('submitted');
  vi.mocked(decideCustomerApplication).mockResolvedValue(detail('submitted'));
  vi.mocked(reopenCustomerApplication).mockResolvedValue(detail('submitted'));
  for (const [name, decision] of [
    ['Approve', 'approved'],
    ['Reject', 'rejected'],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name }));
    // Every decision carries a request identity so a retry after a lost
    // response replays the original result instead of deciding twice.
    await waitFor(() =>
      expect(decideCustomerApplication).toHaveBeenCalledWith(
        id,
        decision,
        expect.stringMatching(/^[0-9a-f-]{36}$/),
        'Reviewed by authorized staff.',
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), {
      timeout: 4000,
    });
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    if (decision === 'approved')
      expect(reviewApplicationPurchaseTerms).toHaveBeenCalledWith(id, {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        expectedProposalHash: 'a'.repeat(64),
        reason: 'Auto-confirmed on approval',
      });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  await waitFor(() =>
    expect(reopenCustomerApplication).toHaveBeenCalledWith(id, expect.any(String)),
  );
});

it('shows the server-authoritative offer with no editable price', async () => {
  await show('draft');
  const panel = await screen.findByRole('region', { name: 'Purchase terms offer' });
  expect(panel).toHaveTextContent('₱54,000.00');
  // The included reservation amount is shown as its own labelled figure.
  expect(panel).toHaveTextContent('₱10,000.00');
  // The offer is read-only: nothing on this screen can authoritatively price it.
  expect(screen.queryByLabelText(/^Total purchase amount$/)).toBeNull();
});
it.each(['xlsx', 'pdf'] as const)(
  'keeps the retired %s export off the application record',
  async (format) => {
    await show('approved');
    expect(screen.queryByRole('button', { name: `Export ${format.toUpperCase()}` })).not.toBeInTheDocument();
    expect(exportCustomerApplication).not.toHaveBeenCalled();
  },
);

it('does not expose a new application form when an existing application fails to load', async () => {
  vi.mocked(getCustomerApplication).mockRejectedValue(new Error('Application detail unavailable'));
  renderWithProviders(
    <Routes>
      <Route path="/admin/customers/applications/:id" element={<CustomerApplicationEditorPage />} />
    </Routes>,
    { route: `/admin/customers/applications/${id}` },
  );
  await screen.findByText('Application could not be loaded');
  expect(screen.queryByText('New Customer Application')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
});

it('guides legacy submitted applications through terms capture instead of a doomed approval', async () => {
  vi.mocked(getCustomerApplication).mockResolvedValue({
    ...detail('submitted'),
    purchaseTermsId: null,
  });
  renderWithProviders(
    <Routes>
      <Route path="/admin/customers/applications/:id" element={<CustomerApplicationEditorPage />} />
    </Routes>,
    { route: '/admin/customers/applications/' + id },
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
  expect(await screen.findByText(/Reopen to review purchase terms, check the offer/)).toBeInTheDocument();
  expect(notifyWarning).toHaveBeenCalledOnce();
  expect(decideCustomerApplication).not.toHaveBeenCalled();
  expect(reviewApplicationPurchaseTerms).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Reopen' })).toBeEnabled();
});
