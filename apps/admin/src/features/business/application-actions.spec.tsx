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
  getReservationAgreement,
  reopenCustomerApplication,
  reviewApplicationPurchaseTerms,
} from './services';
import { purchaseTermsProposalSchema } from '@afhomes/contracts';
import { listSignedDocuments } from './services-signed-documents';
import { reservationPdf } from './reservation-print';

vi.mock('./reservation-print', async (original) => ({
  ...(await original<typeof import('./reservation-print')>()),
  reservationPdf: vi.fn(async () => new Blob(['test PDF'])),
}));

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

function acceptedSignedDocuments(
  owner: 'applications' | 'reservations',
): Awaited<ReturnType<typeof listSignedDocuments>> {
  return [
    {
      id: '00000000-0000-4000-8000-0000000000d1',
      kind:
        owner === 'applications' ? 'signed_customer_application' : 'signed_reservation_agreement',
      status: 'accepted',
      applicationId: '00000000-0000-4000-8000-000000000001',
      reservationId: owner === 'reservations' ? 'bbbbbbbb-0000-4000-8000-000000000009' : null,
      originalFilename: 'signed.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      uploadedBy: '00000000-0000-4000-8000-0000000000d2',
      uploadedByName: 'Uploader',
      uploadedAt: '2026-11-11T00:00:00.000Z',
      reviewedBy: '00000000-0000-4000-8000-0000000000d3',
      reviewedByName: 'Reviewer',
      reviewedAt: '2026-11-11T01:00:00.000Z',
      reviewNotes: null,
    },
  ];
}

// Both accepted documents exist unless a case overrides one document's state.
vi.mock('./services-signed-documents', async (original) => ({
  ...(await original()),
  listSignedDocuments: vi.fn(async (owner: 'applications' | 'reservations') =>
    acceptedSignedDocuments(owner),
  ),
  getSignedDocumentDownload: async () => ({
    url: 'https://files.test/signed.pdf',
    expiresAt: '2026-11-11T02:00:00.000Z',
  }),
}));
vi.mock('./services', async (original) => ({
  ...(await original()),
  getCustomers: async () => [],
  getCardProducts: async () => [],
  getCustomerApplication: vi.fn(),
  getReservationAgreement: vi.fn(),
  // The offer is server-authoritative; the screen only reads and echoes its hash.
  getPurchaseTermsProposal: vi.fn(async () => buildOffer()),
  decideCustomerApplication: vi.fn(),
  reopenCustomerApplication: vi.fn(),
  reviewApplicationPurchaseTerms: vi.fn(async () => detail('submitted')),
  exportCustomerApplication: vi.fn(),
  // The workflow panel reads the reservation this application produced, so the
  // next action is derived from real server state rather than local guesswork.
  getReservationAgreements: vi.fn(async () => [buildReservation('submitted')]),
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
  resolveAaNumber: async () => ({ member: null }),
  getAccreditationNumbers: async () => ({}),
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
function buildReservation(status: string, saleId: string | null = null) {
  return {
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
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getReservationAgreements).mockResolvedValue([buildReservation('submitted')]);
  vi.mocked(listSignedDocuments).mockImplementation(async (owner) =>
    acceptedSignedDocuments(owner),
  );
});

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

async function show(
  status: CustomerApplicationStatus,
  roleSlug = 'super_admin',
  approvalAccess = true,
  overrides: Partial<ReturnType<typeof detail>> = {},
) {
  vi.mocked(getCustomerApplication).mockResolvedValue({ ...detail(status), ...overrides });
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
        roleSlug,
        roleName: 'Super Admin',
        status: 'active',
        afHomesPermissions: approvalAccess
          ? [
              {
                moduleKey: 'sales.application_approval',
                canView: true,
                canCreate: false,
                canUpdate: true,
                canDelete: false,
              },
            ]
          : [],
      },
    },
  );
  await screen.findByText('QA APPLICATION');
  if (status === 'draft')
    await waitFor(() => expect(screen.getByLabelText('First name')).toHaveValue('ANA'));
}
it('refuses to reconstruct a missing historical agreement from current plan configuration', async () => {
  vi.mocked(getReservationAgreements).mockResolvedValue([]);
  await show('approved');
  fireEvent.click(screen.getByText('Reservation Agreement details', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download RA form' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Load the linked Reservation Agreement before exporting.');
  expect(reservationPdf).not.toHaveBeenCalled();
});

it.each(['approved', 'cancelled'] as const)('exports stored agreement snapshots for a %s application', async (status) => {
  const agreement = buildReservation(status === 'cancelled' ? 'cancelled' : 'executed');
  vi.mocked(getReservationAgreements).mockResolvedValue([agreement]);
  const frozen = {
    ...agreement,
    primary: { name: 'ANA SANTOS', address: 'QA ADDRESS', contactNumber: '+639171234567', email: 'qa@example.test' },
    secondary: null,
    reservationFee: '10000.00',
    yearlyPoints: 12345,
  };
  vi.mocked(getReservationAgreement).mockResolvedValue(frozen as never);
  await show(status);
  if (status === 'approved') {
    const snapshot = await screen.findByRole('region', { name: 'Frozen purchase terms' });
    expect(snapshot).toHaveTextContent('60,000.00');
    expect(screen.getByLabelText('Official Reservation Agreement Number')).toHaveValue(frozen.reservationNumber);
  }
  expect(screen.queryByRole('region', { name: 'Purchase terms offer' })).not.toBeInTheDocument();
  expect(screen.queryByText('Cannot save and submit yet:')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Reservation Agreement details', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download RA form' }));
  await waitFor(() => expect(getReservationAgreement).toHaveBeenCalledWith(frozen.id));
  await waitFor(() => expect(reservationPdf).toHaveBeenCalledWith(expect.objectContaining({ agreement: frozen })));
});

it.each(['draft', 'submitted', 'approved', 'rejected', 'cancelled'] as const)(
  'keeps %s actions outside the read-only fields',
  async (status) => {
    await show(status);
    if (status === 'draft') {
      expect(screen.getByLabelText('First name')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeDisabled();
    } else {
      expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Submit for Approval' })).not.toBeInTheDocument();
    }
    const actions = screen.queryByRole('region', { name: 'Record actions' });
    if (status !== 'cancelled') {
      expect(actions).toBeInTheDocument();
      expect(actions!.closest('fieldset')).toBeNull();
      if (status === 'submitted' || status === 'rejected')
        expect(
          within(actions!).getByRole('button', { name: 'Return for Corrections' }),
        ).toBeEnabled();
      for (const name of ['Approve Application & RA', 'Reject']) {
        if (status === 'submitted' || (status === 'approved' && name === 'Approve Application & RA'))
          await waitFor(() => expect(within(actions!).getByRole('button', { name })).toBeEnabled());
        else expect(within(actions!).queryByRole('button', { name })).toBeNull();
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
        <Route
          path="/admin/customers/applications/:id/edit"
          element={<CustomerApplicationEditorPage />}
        />
      </Routes>,
      { route: `/admin/customers/applications/${id}/edit` },
    );
    expect(await screen.findByLabelText('First name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit for Approval' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Record actions' })).not.toBeInTheDocument();
  },
);

/**
 * The next action is a NAVIGATION derived from server state. It never replaces
 * the lifecycle calls, so an illegal step stays illegal - the panel just shows
 * where the customer actually is.
 */
describe('purchase workflow next step', () => {
  it('never offers a replacement RA when the linked agreement is missing', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(within(panel).getByText('Linked RA requires review')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /create reservation/i })).toBeNull();
  });

  it('requires a successful reservation lookup before Finance handoff', async () => {
    vi.mocked(getReservationAgreements).mockRejectedValue(
      new Error('Reservation lookup unavailable'),
    );
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(await within(panel).findByRole('button', { name: /retry/i })).toBeEnabled();
    expect(within(panel).queryByRole('button', { name: 'Continue in Finance' })).toBeNull();
  });

  it('approval uses one decision and hands the executed purchase to Finance', async () => {
    vi.mocked(decideCustomerApplication).mockImplementation(async () => {
      vi.mocked(getReservationAgreements).mockResolvedValue([buildReservation('executed')]);
      vi.mocked(getCustomerApplication).mockResolvedValue(detail('approved'));
      return detail('approved');
    });
    await show('submitted');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve Application & RA' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve Application & RA' }));
    expect(await screen.findByRole('button', { name: 'Continue in Finance' })).toBeEnabled();
    expect(decideCustomerApplication).toHaveBeenCalledOnce();
    expect(reviewApplicationPurchaseTerms).not.toHaveBeenCalled();
  });

  it('completes an older approved application through the same joint approval action', async () => {
    vi.mocked(decideCustomerApplication).mockResolvedValue(detail('approved'));
    await show('approved');
    const action = await screen.findByRole('button', { name: 'Approve Application & RA' });
    await waitFor(() => expect(action).toBeEnabled());
    fireEvent.click(action);
    await waitFor(() => expect(decideCustomerApplication).toHaveBeenCalledOnce());
    expect(vi.mocked(decideCustomerApplication).mock.calls[0]?.slice(0, 2)).toEqual([id, 'approved']);
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('offers Finance only after approval and execution', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([buildReservation('executed')]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Continue in Finance' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent('/admin/finance/payments'),
    );
  });

  it('keeps a submitted linked RA inside application approval', async () => {
    await show('submitted');
    const approval = screen.getByRole('button', { name: 'Approve Application & RA' });
    const agreement = screen.getByText('Reservation Agreement details', { selector: 'summary' });
    expect(approval.compareDocumentPosition(agreement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(within(panel).getByText('Review Signed Documents')).toBeInTheDocument();
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).getByText('Application & RA Approved').closest('li')).toHaveAttribute(
      'data-state',
      'Current',
    );
    expect(within(panel).getByText('Payment Processing').closest('li')).toHaveAttribute(
      'data-state',
      'Pending',
    );
  });

  it('hands a finalized purchase to activation', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([
      buildReservation('executed', 'cccccccc-0000-4000-8000-000000000010'),
    ]);
    await show('approved');
    const panel = await screen.findByLabelText('Purchase workflow');
    fireEvent.click(await within(panel).findByRole('button', { name: 'View activation' }));
    await waitFor(() =>
      expect(screen.getByLabelText('route')).toHaveTextContent('/admin/finance/activation'),
    );
  });

  it('does not mark a draft application approved merely because its RA exists', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([buildReservation('draft')]);
    await show('draft');
    const panel = await screen.findByLabelText('Purchase workflow');
    expect(within(panel).getByText('Application & RA Approved').closest('li')).toHaveAttribute(
      'data-state',
      'Pending',
    );
    expect(within(panel).queryByText('Reservation Created')).toBeNull();
    expect(within(panel).getByText('0 of 3 complete')).toBeInTheDocument();
    const details = screen.getByText('Application details & ID review', { selector: 'summary' }).closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Submit for Approval' })).toBeDisabled();
    expect(screen.getByText('Reservation Agreement details', { selector: 'summary' }).closest('details')).not.toHaveAttribute('open');
    fireEvent.click(within(details).getByText('Application details & ID review'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByLabelText('First name')).toBeVisible();

  });
});
it('dispatches submitted decisions and reopen', async () => {
  await show('submitted');
  vi.mocked(decideCustomerApplication).mockResolvedValue(detail('submitted'));
  vi.mocked(reopenCustomerApplication).mockResolvedValue(detail('submitted'));
  for (const [name, decision] of [
    ['Approve Application & RA', 'approved'],
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
    expect(reviewApplicationPurchaseTerms).not.toHaveBeenCalled();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Return for Corrections' }));
  await waitFor(() =>
    expect(reopenCustomerApplication).toHaveBeenCalledWith(id, expect.any(String)),
  );
});

it.each(['sales_manager', 'senior_sales_manager', 'vice_director', 'ost', 'finance'])(
  'does not grant %s application approval even with the capability',
  async (role) => {
    await show('submitted', role);
    expect(screen.queryByRole('button', { name: 'Approve Application & RA' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return for Corrections' })).toBeNull();
  },
);

it('requires the dynamic approval capability for Admin', async () => {
  await show('submitted', 'admin', false);
  expect(screen.queryByRole('button', { name: 'Approve Application & RA' })).toBeNull();
});

it.each(['senior_sales_manager', 'vice_director', 'ost', 'finance'])(
  'hides the application creation form from %s even with create permission',
  async (roleSlug) => {
    renderWithProviders(<CustomerApplicationEditorPage />, {
      user: {
        id,
        name: 'Viewer',
        email: 'viewer@example.test',
        roleId: id,
        roleSlug,
        roleName: roleSlug,
        status: 'active',
        afHomesPermissions: [
          {
            moduleKey: 'sales.customers',
            canView: true,
            canCreate: true,
            canUpdate: true,
            canDelete: false,
          },
        ],
      },
    });
    expect(
      await screen.findByText(
        /Only an active Sales Manager, Admin or Super Admin with application creation access/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for Approval' })).toBeNull();
    expect(screen.queryByLabelText('First name')).toBeNull();
  },
);

it('blocks approval with a specific reason when the linked RA is missing', async () => {
  vi.mocked(getReservationAgreements).mockResolvedValue([]);
  await show('submitted');
  expect(
    await screen.findByText('A submitted linked RA is required before approval.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve Application & RA' })).toBeDisabled();
});

it('blocks approval when the linked signed RA has not been accepted', async () => {
  const signed = await listSignedDocuments('applications', id);
  vi.mocked(listSignedDocuments).mockImplementation(async (owner) =>
    owner === 'applications' ? signed : [],
  );
  await show('submitted');
  const section = await screen.findByRole('region', { name: 'Required Signed Documents' });
  expect(within(section).getByText('Signed Application Form')).toBeInTheDocument();
  expect(within(section).getByText('Signed Reservation Agreement')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Approve Application & RA' })).toBeDisabled();
  expect(
    screen.getByText(
      /Both the Signed Application Form and Signed Reservation Agreement must be accepted/,
    ),
  ).toBeInTheDocument();
});

it('shows the server-authoritative offer with no editable price', async () => {
  await show('draft');
  const panel = await screen.findByLabelText('Purchase terms offer');
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
    expect(
      screen.queryByRole('button', { name: `Export ${format.toUpperCase()}` }),
    ).not.toBeInTheDocument();
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
  expect(screen.queryByRole('button', { name: 'Submit for Approval' })).not.toBeInTheDocument();
});

it('does not ask an Admin to re-pick the seller already saved on a draft', async () => {
  const smStaffId = 'cccccccc-0000-4000-8000-000000000001';
  await show('draft', 'admin', true, { smStaffId });
  const alert = await screen.findByText('Cannot save and submit yet:');
  const list = alert.parentElement?.parentElement ?? alert.parentElement!;
  expect(list).not.toHaveTextContent('seller of record');
});

it('still asks an Admin to choose the seller when the draft has none', async () => {
  await show('draft', 'admin', true, { smStaffId: undefined });
  const alert = await screen.findByText('Cannot save and submit yet:');
  const list = alert.parentElement?.parentElement ?? alert.parentElement!;
  expect(list).toHaveTextContent('seller of record');
});
