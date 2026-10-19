import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import {
  customerSchema,
  identityDocumentSchema,
  purchaseTermsProposalSchema,
} from '@afhomes/contracts';
import {
  CustomerApplicationEditorPage,
  CustomerApplicationsPage,
  ReservationAgreementsPage,
} from './OfficialFormsPages';
import {
  createCustomerApplication,
  getCardProducts,
  getCustomerApplication,
  getCustomerById,
  getCustomerApplicationsPage,
  getCustomersPage,
  getPurchaseTermsProposal,
  getReservationAgreementsPage,
  registerCustomerApplication,
  submitCustomerApplication,
} from './services';
import {
  getCurrentDocument,
  completeDocumentUpload,
  putUploadBytes,
  requestUploadGrant,
} from '../documents/services';
import { getImportRowIntake } from './import-workflow-services';
vi.mock('./import-workflow-services', () => ({
  getImportRowIntake: vi.fn(),
  getImportContinuations: vi.fn(async () => []),
}));

vi.mock('./services', () => ({
  createCustomerApplication: vi.fn(),
  createReservationAgreement: vi.fn(),
  decideCustomerApplication: vi.fn(),
  decideReservationAgreement: vi.fn(),
  exportCustomerApplication: vi.fn(),
  exportReservationAgreement: vi.fn(),
  getCardProducts: vi.fn(),
  getCustomerApplication: vi.fn(),
  getCustomerApplications: vi.fn(),
  getCustomerApplicationsPage: vi.fn(),
  getCustomersPage: vi.fn(),
  getCustomerById: vi.fn(),
  getOfficialFormTemplate: vi.fn(),
  getReservationAgreement: vi.fn(),
  getReservationAgreements: vi.fn(),
  getReservationAgreementsPage: vi.fn(),
  getSaleSummary: vi.fn(),
  getSales: vi.fn(),
  previewOfficialFormImport: vi.fn(),
  registerCustomerApplication: vi.fn(),
  reopenCustomerApplication: vi.fn(),
  reopenReservationAgreement: vi.fn(),
  getPurchaseTermsProposal: vi.fn(),
  submitCustomerApplication: vi.fn(),
  submitReservationAgreement: vi.fn(),
  updateCustomerApplication: vi.fn(),
  updateReservationAgreement: vi.fn(),
}));

vi.mock('../documents/services', async (original) => ({
  ...(await original()),
  getCurrentDocument: vi.fn(),
  completeDocumentUpload: vi.fn(),
  confirmDocument: vi.fn(),
  putUploadBytes: vi.fn(),
  requestUploadGrant: vi.fn(),
  runDocumentOcr: vi.fn(),
}));

// The referral chain reads the Organization live. Tests pin the cascade with
// their own nodes where needed; by default the list is empty so the four
// dropdowns render with `Not specified` only and no request ever leaves.
vi.mock('../genealogy/services', () => ({
  getGenealogy: vi.fn(async () => []),
  getGenealogyNode: vi.fn(),
  getGenealogyUpline: vi.fn(async () => []),
  getGenealogyDownline: vi.fn(async () => []),
  getGenealogySummary: vi.fn(),
}));

// Geographic reference data comes from the server-held provider. ONE small
// synthetic hierarchy proves the holder cascade end to end without the
// network; nothing here is real PSGC data. Fixtures are inline because
// `vi.mock` factories are hoisted above any module-scope constant.
vi.mock('../address/services', () => ({
  getAddressProvinces: vi.fn(async () => [{ code: '0403400000', name: 'Laguna' }]),
  getAddressLocalities: vi.fn(async () => [
    {
      code: '0403406000',
      name: 'Calauan',
      type: 'municipality' as const,
      provinceCode: '0403400000',
      postalCode: '4004',
    },
  ]),
  getAddressBarangays: vi.fn(async () => [
    { code: '0403406003', name: 'Dayap', localityCode: '0403406000' },
  ]),
}));

beforeEach(() => {
  // Default: no current identity document. Tests that need one set it through
  // their own setup so the value is in place before the query first runs.
  vi.mocked(getCurrentDocument).mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

it('reopens the canonical imported application after a reload instead of creating another', async () => {
  vi.mocked(getCardProducts).mockResolvedValue([]);
  vi.mocked(getCustomersPage).mockResolvedValue({ data: [], total: 0 });
  vi.mocked(getImportRowIntake).mockResolvedValue({
    continuation: {
      rowId: 'row',
      sourceId: 'source',
      customerId: 'customer',
      applicationId: 'existing-imported-app',
      reservationId: null,
      saleId: null,
      stage: 'application',
      missingRequirements: [],
      conflicts: [],
      proposedFields: [],
      claimCount: 1,
      expectedSourceHash: 'a'.repeat(64),
      expectedTargetVersion: 'b'.repeat(64),
      expectedTeamVersion: 'c'.repeat(64),
      nextAction: null,
    },
    prefill: {
      primary: {},
      secondary: null,
      recommenderName: '',
      recommenderContact: '',
      recommenderEmail: '',
      salesManagerName: '',
      referrerName: '',
      missingFields: [],
    },
    claims: [],
    purchaseReference: 'REVIEWED PURCHASE',
    team: {},
  });
  renderWithProviders(
    <Routes>
      <Route path="/admin/customers/applications/new" element={<CustomerApplicationEditorPage />} />
      <Route
        path="/admin/customers/applications/existing-imported-app"
        element={<h1>Existing imported application</h1>}
      />
    </Routes>,
    {
      route: '/admin/customers/applications/new?importRowId=row',
      user: {
        id: 'user',
        name: 'Admin',
        email: 'admin@example.invalid',
        roleId: 'role',
        roleSlug: 'super_admin',
        roleName: 'Admin',
        status: 'active',
        afHomesPermissions: [],
      },
    },
  );
  expect(
    await screen.findByRole('heading', { name: 'Existing imported application' }),
  ).toBeInTheDocument();
  expect(createCustomerApplication).not.toHaveBeenCalled();
  expect(registerCustomerApplication).not.toHaveBeenCalled();
});

const application = {
  id: 'app-1',
  applicationNumber: 'APP-000001',
  applicantName: 'MARIA SANTOS',
  tier: 'GOLD',
  createdBy: '11111111-1111-4111-8111-111111111111',
  sellerName: 'Sam Seller',
  status: 'submitted',
  submittedAt: '2026-09-28T00:00:00.000Z',
  createdAt: '2026-09-28T00:00:00.000Z',
};

const agreement = {
  id: 'res-1',
  reservationNumber: 'RES-000001',
  tier: 'SILVER',
  saleId: 'sale-1',
  applicantName: 'QA IST Applicant',
  paymentScheme: 'spot_cash',
  totalPrice: '312000.00',
  primarySignatureStatus: 'received',
  secondarySignatureStatus: null,
  hasSecondaryHolder: false,
  status: 'submitted',
  submittedAt: '2026-09-28T00:00:00.000Z',
  createdAt: '2026-09-28T00:00:00.000Z',
};

describe('CustomerApplicationsPage list states', () => {
  const pageOf = (rows: unknown[], total: number) => ({ data: rows, total }) as never;

  it('shows loading - never a phantom empty state - on first load', () => {
    vi.mocked(getCustomerApplicationsPage).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CustomerApplicationsPage />);
    expect(screen.getByRole('status', { name: 'Loading applications' })).toBeInTheDocument();
    expect(screen.queryByText('No customer applications')).not.toBeInTheDocument();
  });

  it('shows the real empty state only after an empty response', async () => {
    vi.mocked(getCustomerApplicationsPage).mockResolvedValue(pageOf([], 0));
    renderWithProviders(<CustomerApplicationsPage />);
    expect(await screen.findByText('No customer applications')).toBeInTheDocument();
  });

  it('renders rows in the shared filter toolbar with a clearable search', async () => {
    vi.mocked(getCustomerApplicationsPage).mockResolvedValue(pageOf([application], 1));
    renderWithProviders(<CustomerApplicationsPage />);
    expect(await screen.findByText('APP-000001')).toBeInTheDocument();
    expect(screen.getByText('Sam Seller')).toBeInTheDocument();
    expect(screen.queryByText(application.createdBy)).not.toBeInTheDocument();
    // Shared FilterBar grammar: landmark search + clearable field.
    expect(screen.getByRole('search')).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: 'Search applications' });
    fireEvent.change(search, { target: { value: 'APP-000001' } });
    expect(screen.getByRole('button', { name: 'Clear search applications' })).toBeInTheDocument();
  });

  /**
   * The default table is APPLICATION WORK. Progressed applications are owned by
   * the reservation and Finance queues, but stay one filter away - never
   * deleted, never archived.
   */
  it('asks the server for application work by default', async () => {
    vi.mocked(getCustomerApplicationsPage).mockResolvedValue(pageOf([application], 1));
    renderWithProviders(<CustomerApplicationsPage />);
    await screen.findByText('APP-000001');
    expect(getCustomerApplicationsPage).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'application_work', limit: 10, offset: 0 }),
    );
  });

  it('drops the queue filter when Include progressed is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomerApplicationsPage).mockResolvedValue(pageOf([application], 1));
    renderWithProviders(<CustomerApplicationsPage />);
    await screen.findByText('APP-000001');
    vi.mocked(getCustomerApplicationsPage).mockClear();
    await user.selectOptions(screen.getByLabelText('Queue'), 'all');
    await waitFor(() =>
      expect(getCustomerApplicationsPage).toHaveBeenCalledWith(
        expect.not.objectContaining({ queue: expect.anything() }),
      ),
    );
  });

  it('fetches 10-row pages and walks them with the shared pagination', async () => {
    vi.mocked(getCustomerApplicationsPage).mockResolvedValue(pageOf([application], 25));
    renderWithProviders(<CustomerApplicationsPage />);
    await screen.findByText('APP-000001');
    expect(vi.mocked(getCustomerApplicationsPage).mock.calls[0]![0]).toMatchObject({
      limit: 10,
      offset: 0,
    });
    expect(
      screen.getByRole('navigation', { name: 'Customer applications pagination' }),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(vi.mocked(getCustomerApplicationsPage).mock.calls[1]![0]).toMatchObject({
        limit: 10,
        offset: 10,
      }),
    );
  });
});

describe('CustomerApplicationEditorPage load errors', () => {
  const EDITOR_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const showEditorWithError = (error: unknown) => {
    vi.mocked(getCustomerApplication).mockRejectedValue(error);
    renderWithProviders(
      <Routes>
        <Route
          path="/admin/customers/applications/:id"
          element={<CustomerApplicationEditorPage />}
        />
      </Routes>,
      { route: `/admin/customers/applications/${EDITOR_ID}` },
    );
  };

  it('tells a missing record apart from a broken one', async () => {
    showEditorWithError(new ApiError({ code: 'NOT_FOUND', message: 'Not here', status: 404 }));
    expect(await screen.findByText('Application could not be loaded')).toBeInTheDocument();
    expect(screen.getByText(/No application exists at this link/)).toBeInTheDocument();
  });

  it('names record review as the next step when the payload fails the contract', async () => {
    showEditorWithError(new ApiParseError('/official-forms/customer-applications/x', 'bad'));
    expect(await screen.findByText('Application could not be loaded')).toBeInTheDocument();
    expect(screen.getByText(/values this form cannot display/)).toBeInTheDocument();
  });

  it('names the connection when the API is unreachable', async () => {
    showEditorWithError(new ApiNetworkError(new Error('refused')));
    expect(await screen.findByText('Application could not be loaded')).toBeInTheDocument();
    expect(screen.getByText(/Check your connection/)).toBeInTheDocument();
  });

  it('falls back to the generic message for unknown failures', async () => {
    showEditorWithError(new Error('Something odd'));
    expect(await screen.findByText('Application could not be loaded')).toBeInTheDocument();
    expect(screen.getByText(/Please try again/)).toBeInTheDocument();
  });
});

describe('ReservationAgreementsPage list states', () => {
  /**
   * Executing an agreement hands collection to Finance, so the active IST
   * reservation queue is asked for reservation work by default. The executed
   * agreement stays reachable through "Include progressed" or an explicit status
   * filter - it is never deleted, only handed over.
   */
  it('asks the server for reservation work by default', async () => {
    vi.mocked(getReservationAgreementsPage).mockResolvedValue({
      data: [agreement],
      total: 1,
    } as never);
    renderWithProviders(<ReservationAgreementsPage />);
    await screen.findByText('RES-000001');
    expect(getReservationAgreementsPage).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'reservation_work', limit: 10, offset: 0 }),
    );
  });

  it('drops the queue filter when Include progressed is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(getReservationAgreementsPage).mockResolvedValue({
      data: [agreement],
      total: 1,
    } as never);
    renderWithProviders(<ReservationAgreementsPage />);
    await screen.findByText('RES-000001');
    vi.mocked(getReservationAgreementsPage).mockClear();
    await user.selectOptions(screen.getByLabelText('Queue'), 'all');
    await waitFor(() =>
      expect(getReservationAgreementsPage).toHaveBeenCalledWith(
        expect.not.objectContaining({ queue: expect.anything() }),
      ),
    );
  });

  it('shows loading - never a phantom empty state - on first load', () => {
    vi.mocked(getReservationAgreementsPage).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ReservationAgreementsPage />);
    expect(screen.getByRole('status', { name: 'Loading reservations' })).toBeInTheDocument();
    expect(screen.queryByText('No reservation agreements')).not.toBeInTheDocument();
  });

  it('renders rows with a clearable search after load', async () => {
    vi.mocked(getReservationAgreementsPage).mockResolvedValue({
      data: [agreement],
      total: 1,
    } as never);
    renderWithProviders(<ReservationAgreementsPage />);
    expect(await screen.findByText('RES-000001')).toBeInTheDocument();
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: 'Search reservation agreements' }),
    ).toBeInTheDocument();
  });

  it('navigates to the detail view when a row is activated', async () => {
    const user = userEvent.setup();
    vi.mocked(getReservationAgreementsPage).mockResolvedValue({
      data: [agreement],
      total: 1,
    } as never);
    renderWithProviders(
      <Routes>
        <Route path="/admin/sales/reservations" element={<ReservationAgreementsPage />} />
        <Route path="/admin/sales/reservations/:id" element={<p>reservation detail view</p>} />
      </Routes>,
      { route: '/admin/sales/reservations' },
    );
    await screen.findByText('RES-000001');
    await user.click(screen.getByRole('link', { name: 'Review reservation RES-000001' }));
    expect(await screen.findByText('reservation detail view')).toBeInTheDocument();
  });

  it('fetches 10-row pages and walks them with the shared pagination', async () => {
    vi.mocked(getReservationAgreementsPage).mockResolvedValue({
      data: [agreement],
      total: 25,
    } as never);
    renderWithProviders(<ReservationAgreementsPage />);
    await screen.findByText('RES-000001');
    expect(vi.mocked(getReservationAgreementsPage).mock.calls[0]![0]).toMatchObject({
      limit: 10,
      offset: 0,
    });
    expect(
      screen.getByRole('navigation', { name: 'Reservation agreements pagination' }),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(vi.mocked(getReservationAgreementsPage).mock.calls[1]![0]).toMatchObject({
        limit: 10,
        offset: 10,
      }),
    );
  });
});

describe('application private ID intake', () => {
  const customerId = '00000000-0000-4000-8000-000000000001';
  const documentId = '00000000-0000-4000-8000-000000000002';
  const document = (status: 'completed' | 'failed') =>
    identityDocumentSchema.parse({
      id: documentId,
      subjectType: 'customer',
      subjectId: customerId,
      originalFilename: 'qa.png',
      mime: 'image/png',
      sizeBytes: 9,
      hasFile: true,
      ocrStatus: status,
      ocrProvider: 'qa',
      verificationStatus: 'pending_review',
      isCurrent: true,
      extractedFields: {},
      warnings: [],
      reviewedFields: { idType: 'passport' },
      possibleDuplicate: null,
      uploadedAt: '2026-10-01',
      reviewedAt: null,
    });
  const PLAN_ID = '00000000-0000-4000-8000-000000000010';
  const QA_PLAN = {
    id: PLAN_ID,
    code: 'GOLD',
    name: 'Gold',
    discountPercent: 25,
    cardholderLimit: 2,
    yearlyPoints: 25000,
    annualPointsTranches: 20,
    baseValidityYears: 20,
    validityExtensionYears: 2,
    totalLoyaltyValue: '500000.00',
  };
  const setup = async (
    current: ReturnType<typeof document> | null = null,
    { pickCustomer = true }: { pickCustomer?: boolean } = {},
  ) => {
    const qaCustomer = customerSchema.parse({
      id: customerId,
      customerNumber: 'CUS-QA-1',
      fullName: 'QA Customer',
      email: 'qa@example.com',
      phone: '+639171234567',
      dateOfBirth: '1990-01-01',
      gender: null,
      address: null,
      governmentIdType: null,
      governmentIdMasked: null,
      status: 'prospect',
      createdBy: null,
      createdAt: '2026-10-01',
      updatedAt: '2026-10-01',
    });
    vi.mocked(getCustomersPage).mockResolvedValue({ data: [qaCustomer], total: 1 });
    vi.mocked(getCustomerById).mockResolvedValue(qaCustomer);
    vi.mocked(getCardProducts).mockResolvedValue([QA_PLAN] as never);
    vi.mocked(getCurrentDocument).mockResolvedValue(current as never);
    vi.mocked(requestUploadGrant).mockResolvedValue({
      documentId,
      bucket: 'afhomes-customer-ids',
      uploadUrl: 'https://safe-test.example/signed-upload',
      expiresAt: '2026-10-03T12:00:00Z',
    });
    vi.mocked(putUploadBytes).mockResolvedValue(undefined);
    vi.mocked(completeDocumentUpload).mockResolvedValue({
      ...document('completed'),
      originalFilename: 'qa.png',
    } as never);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    // New Register is the untouched default; only tests that need an existing
    // customer run the picker.
    if (pickCustomer)
      fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    // The editor is a wizard: pick a plan on step 1 so Next reaches Identity.
    fireEvent.change(screen.getByLabelText('VIP plan'), { target: { value: PLAN_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText('ID Type');
  };
  const chooseIdTypeAndFile = (name = 'qa.png', type = 'image/png') => {
    fireEvent.change(screen.getByLabelText('ID Type'), { target: { value: 'passport' } });
    fireEvent.change(screen.getByLabelText('Upload ID'), {
      target: { files: [new File(['synthetic'], name, { type })] },
    });
  };

  it('offers capture + type only, no separate upload button', async () => {
    await setup(document('completed'));
    expect(screen.queryByRole('button', { name: 'Detect fields' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload selected ID' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Selected ID:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload an ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeInTheDocument();
  });

  it('spins inside the Customer control while the list loads, never a skeleton beside it', async () => {
    // A skeleton standing in for the control shifted the form on every load and
    // left an empty box where the dropdown belonged. The control itself stays
    // put and reports the wait.
    vi.mocked(getCustomersPage).mockReturnValue(new Promise(() => {}));
    vi.mocked(getCardProducts).mockResolvedValue([QA_PLAN] as never);
    renderWithProviders(<CustomerApplicationEditorPage />);
    const customer = screen.getByLabelText('Customer');
    expect(customer).toHaveAttribute('aria-busy', 'true');
    expect(customer.closest('div')).toHaveAttribute('data-loading', 'true');
    // The spinner's own ring, inside the control rather than after it.
    expect(customer.parentElement?.querySelector('[class*="ring"]')).not.toBeNull();
    expect(screen.queryByRole('status', { name: 'Searching customers' })).not.toBeInTheDocument();
  });

  it('clears the Customer spinner once the list arrives', async () => {
    // Stays on step 1: the Application panel is the only place the picker is
    // rendered, and the wizard unmounts it once Next is clicked.
    vi.mocked(getCustomersPage).mockResolvedValue({
      data: [
        customerSchema.parse({
          id: customerId,
          customerNumber: 'CUS-QA-1',
          fullName: 'QA Customer',
          email: 'qa@example.com',
          phone: '+639171234567',
          dateOfBirth: '1990-01-01',
          gender: null,
          address: null,
          governmentIdType: null,
          governmentIdMasked: null,
          status: 'prospect',
          createdBy: null,
          createdAt: '2026-10-01',
          updatedAt: '2026-10-01',
        }),
      ],
      total: 1,
    });
    vi.mocked(getCardProducts).mockResolvedValue([QA_PLAN] as never);
    renderWithProviders(<CustomerApplicationEditorPage />);
    // The control renders before its options do, so the wait has to end on the
    // resolved list rather than on the control existing.
    await screen.findByRole('option', { name: 'QA Customer' });
    const customer = screen.getByLabelText('Customer');
    await waitFor(() => expect(customer).not.toHaveAttribute('aria-busy'));
    expect(customer.closest('div')).not.toHaveAttribute('data-loading');
    expect(customer.parentElement?.querySelector('[class*="ring"]')).toBeNull();
  });

  it('labels the ID types with the shared vocabulary, not slug-derived text', async () => {
    await setup(null);
    const labels = [...(screen.getByLabelText('ID Type') as HTMLSelectElement).options].map(
      (option) => option.textContent,
    );
    // Same map the member and OST ID-type dropdowns use. Deriving a label from
    // the slug produced "Philippine Id", "Drivers License" and "Tax Id".
    expect(labels).toContain('Philippine ID');
    expect(labels).toContain("Driver's License");
    expect(labels).toContain('Tax ID');
    expect(labels).not.toContain('Philippine Id');
    expect(labels).not.toContain('Drivers License');
    expect(labels).not.toContain('Tax Id');
  });

  it('shows a clickable thumbnail that opens a full preview modal', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock-id');
    URL.revokeObjectURL = vi.fn();
    await setup();
    chooseIdTypeAndFile();
    const thumbnail = await screen.findByAltText('ID preview thumbnail');
    expect(thumbnail).toHaveAttribute('src', 'blob:mock-id');
    expect(screen.getByText('Ready to upload on save.')).toBeInTheDocument();
    fireEvent.click(thumbnail);
    expect(await screen.findByAltText('Full ID preview')).toBeInTheDocument();
  });

  it('defers upload until Save, keeping pickers enabled meanwhile', async () => {
    await setup();
    chooseIdTypeAndFile();
    await screen.findByAltText('ID preview thumbnail');
    expect(requestUploadGrant).not.toHaveBeenCalled();
    expect(putUploadBytes).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Upload ID')).toBeEnabled();
  });

  it('routes Take a photo to the camera-capture input, never the ordinary picker', async () => {
    await setup();
    const picker = screen.getByLabelText('Upload ID');
    const camera = screen.getByLabelText('Scan / Take Photo');
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(camera).toHaveAttribute('accept', 'image/*');
    expect(camera).not.toBe(picker);
    const pickerClick = vi.spyOn(picker, 'click');
    const cameraClick = vi.spyOn(camera, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(cameraClick).toHaveBeenCalledTimes(1);
    expect(pickerClick).not.toHaveBeenCalled();
    const captured = new File(['cam'], 'capture.jpg', { type: 'image/jpeg' });
    fireEvent.change(camera, { target: { files: [captured] } });
    fireEvent.change(screen.getByLabelText('ID Type'), { target: { value: 'passport' } });
    await screen.findByAltText('ID preview thumbnail');
    expect(requestUploadGrant).not.toHaveBeenCalled();
  });

  it('cancels a pending selection without calling the server', async () => {
    await setup(document('completed'));
    await screen.findByText(/Current ID: qa\.png/);
    chooseIdTypeAndFile('replacement.png');
    await screen.findByAltText('ID preview thumbnail');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel selection' }));
    expect(screen.queryByAltText('ID preview thumbnail')).not.toBeInTheDocument();
    expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
    expect(requestUploadGrant).not.toHaveBeenCalled();
    expect(putUploadBytes).not.toHaveBeenCalled();
  });

  it('leaves Recommender unchecked until recommender details are entered', async () => {
    // acknowledgedAt ships pre-filled with today, so it must never mark the
    // step done on its own: a fresh form shows the step number, not a check.
    await setup();
    const nav = screen.getByRole('navigation', { name: 'Application steps' });
    const item = within(nav).getByText('Recommender').closest('li')!;
    expect(item).toHaveAttribute('data-done', 'false');
    expect(within(item).getByText('4')).toBeInTheDocument();
  });

  it('shows the recorded ID type by its shared label, never the raw slug', async () => {
    // The value is the stored slug (`drivers_license`); the shared label map is
    // the single display vocabulary, the same one the member and OST ID-type
    // dropdowns render. Deriving a label from the slug is what produced
    // "Drivers License" and "Tax Id" before.
    await setup({
      ...document('completed'),
      reviewedFields: { idType: 'drivers_license' },
    } as never);
    expect(await screen.findByText(/ID type: Driver's License/)).toBeInTheDocument();
    expect(screen.queryByText(/Drivers License/)).not.toBeInTheDocument();
    cleanup();
    await setup({ ...document('completed'), reviewedFields: { idType: 'passport' } } as never);
    expect(await screen.findByText(/ID type: Passport/)).toBeInTheDocument();
    cleanup();
    await setup({ ...document('completed'), reviewedFields: null } as never);
    expect(
      await screen.findByText(/Missing: choose the type and upload again/),
    ).toBeInTheDocument();
  });

  it('treats a rejected current document as missing', async () => {
    await setup({
      ...document('completed'),
      isCurrent: false,
      verificationStatus: 'rejected',
    } as never);
    expect(await screen.findByText('Valid ID: Required / Missing')).toBeInTheDocument();
    expect(screen.queryByText(/Current ID:/)).not.toBeInTheDocument();
  });

  const chooseAddress = async (box: HTMLElement, option: string | RegExp) => {
    // A real user cannot click a control that has not unlocked yet; waiting
    // here models that instead of racing the province -> city cascade.
    await waitFor(() => expect(box).toBeEnabled());
    fireEvent.click(box);
    // Options commit on pointerdown (before blur can revert the draft), so a
    // plain click models nothing a real browser does. pointerdown first is the
    // browser's own event order.
    fireEvent.pointerDown(await screen.findByRole('option', { name: option }));
  };

  it('registers a new customer on Save & Submit when New Register is selected', async () => {
    // Regression: the create contract was parsed before the register branch,
    // so New Register - which carries no customerId by design - was refused
    // with "Select a customer for this application." and never registered.
    vi.mocked(registerCustomerApplication).mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000aa',
      customerId: '00000000-0000-4000-8000-0000000000bb',
    } as never);
    // The service Zod-parses the proposal, so production data always carries
    // terms. After submit the screen refetches and renders the offer, so the
    // mock must be complete or the render crashes on `terms.tier`.
    vi.mocked(getPurchaseTermsProposal).mockResolvedValue(
      purchaseTermsProposalSchema.parse({
        applicationId: '00000000-0000-4000-8000-0000000000aa',
        expectedProposalHash: 'a'.repeat(64),
        asOf: '2026-10-07T00:00:00.000Z',
        offerKind: 'submission',
        sellerName: 'QA SELLER',
        terms: {
          applicationId: '00000000-0000-4000-8000-0000000000aa',
          customerId: '00000000-0000-4000-8000-0000000000bb',
          planId: PLAN_ID,
          sellerStaffId: customerId,
          captureKind: 'submission',
          tier: 'GOLD',
          paymentScheme: 'spot_cash',
          totalPrice: '60000.00',
          reservationFee: '10000.00',
          minimumDownPayment: '10000.00',
          requiredInitial: '10000.00',
          installmentMonths: null,
          monthlyAmount: null,
          spotCashDays: 7,
          validityMonths: 12,
          discountPercent: 10,
          yearlyPoints: 25000,
          annualPointsTranches: 1,
          holderLimit: 2,
          inclusions: [],
          commissionRuleId: null,
          commissionRate: '0.04',
          commissionBase: '60000.00',
          expectedCommission: '2400.00',
        },
      }),
    );
    vi.mocked(submitCustomerApplication).mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000aa',
    } as never);

    await setup(null, { pickCustomer: false });
    chooseIdTypeAndFile();
    await screen.findByText('Ready to upload on save.');

    // Identity is satisfied by the picked file; forward to Holders and fill
    // every field the register contract requires.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Santos' } });
    fireEvent.change(screen.getByLabelText('Birth date'), { target: { value: '1990-01-01' } });
    fireEvent.change(screen.getByLabelText('Permanent address line 1'), {
      target: { value: '1 QA Street' },
    });
    // Province -> city -> barangay is all three or none: a half-verified
    // hierarchy is refused, so all three are chosen.
    await chooseAddress(screen.getByRole('combobox', { name: /^Province/ }), 'Laguna');
    await chooseAddress(screen.getByRole('combobox', { name: /City \/ municipality/ }), /Calauan/);
    await chooseAddress(screen.getByRole('combobox', { name: /Barangay/ }), 'Dayap');
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '+639171234567' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Printed name'), { target: { value: 'Ana Santos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // Recommender
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // Channel
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // Certify
    fireEvent.click(
      screen.getByRole('checkbox', { name: /I certify the information and consent/ }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Save & Submit' })[1]!);

    await waitFor(() => expect(vi.mocked(registerCustomerApplication)).toHaveBeenCalledTimes(1));
    const registration = vi.mocked(registerCustomerApplication).mock.calls[0]![0];
    expect(registration).toMatchObject({ registerNewCustomer: true });
    // The register contract omits customerId by type: no linked id may travel.
    expect('customerId' in registration).toBe(false);
    // The create path belongs to a picked customer only.
    expect(vi.mocked(createCustomerApplication)).not.toHaveBeenCalled();
    expect(screen.queryByText(/Select a customer for this application/)).not.toBeInTheDocument();
  });
});

describe('IST commercial summary rendering', () => {
  it.each([
    ['BRONZE', false, 'received', null, 'Complete'],
    ['GOLD', false, 'received', null, 'Complete'],
    ['GOLD', true, 'received', 'received', 'Complete'],
    ['GOLD', true, 'received', null, 'Pending signature'],
    ['GOLD', true, 'received', 'pending', 'Pending signature'],
    ['SILVER', false, 'pending', null, 'Pending signature'],
  ])(
    'renders %s secondary=%s signatures %s/%s as %s',
    async (tier, hasSecondaryHolder, primarySignatureStatus, secondarySignatureStatus, label) => {
      vi.mocked(getReservationAgreementsPage).mockResolvedValue({
        data: [
          {
            ...agreement,
            tier,
            hasSecondaryHolder,
            primarySignatureStatus,
            secondarySignatureStatus,
          },
        ],
        total: 1,
      } as never);
      renderWithProviders(<ReservationAgreementsPage />);
      await screen.findByText('RES-000001');
      expect(screen.getByText('QA IST Applicant')).toBeInTheDocument();
      expect(screen.getByText('Spot Cash')).toBeInTheDocument();
      expect(screen.getByText('\u20b1312,000.00')).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});

it('renders application-origin reservations before a sale exists', async () => {
  vi.mocked(getReservationAgreementsPage).mockResolvedValue({
    data: [{ ...agreement, saleId: null }],
    total: 1,
  } as never);
  renderWithProviders(<ReservationAgreementsPage />);
  expect(await screen.findByText('RES-000001')).toBeInTheDocument();
  expect(screen.getByText('QA IST Applicant')).toBeInTheDocument();
  expect(screen.queryByText('Agreements could not be loaded')).not.toBeInTheDocument();
});

it('never renders a raw sale id in the queue table', async () => {
  vi.mocked(getReservationAgreementsPage).mockResolvedValue({
    data: [agreement],
    total: 1,
  } as never);
  renderWithProviders(<ReservationAgreementsPage />);
  await screen.findByText('RES-000001');
  expect(screen.queryByRole('columnheader', { name: 'Sale' })).not.toBeInTheDocument();
  expect(screen.queryByText('sale-1')).not.toBeInTheDocument();
  expect(screen.queryByText(/f8585910-8cd5-43a2-a6d4-8f703667c8fa/)).not.toBeInTheDocument();
});

/**
 * The status badge is a pipeline, not a flat chip: it must name the exact state,
 * say how far through draft -> submitted -> executed the contract is, and carry
 * an icon so the state survives color-blindness and a screen reader.
 */
it('labels the lifecycle state, its step, and an icon for every reservation status', async () => {
  vi.mocked(getReservationAgreementsPage).mockResolvedValue({
    data: [
      { ...agreement, id: 'res-d', reservationNumber: 'RES-D', status: 'draft' },
      { ...agreement, id: 'res-s', reservationNumber: 'RES-S', status: 'submitted' },
      { ...agreement, id: 'res-e', reservationNumber: 'RES-E', status: 'executed' },
      { ...agreement, id: 'res-c', reservationNumber: 'RES-C', status: 'cancelled' },
    ],
    total: 4,
  } as never);
  renderWithProviders(<ReservationAgreementsPage />);
  // Scoped to the table: the Status filter legitimately offers "Draft" too.
  const table = await screen.findByRole('region', { name: 'Reservation agreement records' });
  const row = (reservation: string) =>
    within(table).getByRole('link', { name: `Review reservation ${reservation}` });
  const rowText = (reservation: string) => row(reservation).textContent ?? '';
  expect(rowText('RES-D')).toContain('Draft');
  expect(rowText('RES-D')).toContain('Step 1 of 3.');
  expect(rowText('RES-S')).toContain('Submitted');
  expect(rowText('RES-S')).toContain('Step 2 of 3.');
  expect(rowText('RES-E')).toContain('Executed');
  expect(rowText('RES-E')).toContain('Step 3 of 3.');
  // Cancelled leaves the track entirely, so it carries no step at all.
  expect(rowText('RES-C')).toContain('Cancelled');
  expect(rowText('RES-C')).not.toContain('Step');
  // Every state carries a decorative icon, never color alone.
  for (const reservation of ['RES-D', 'RES-S', 'RES-E', 'RES-C']) {
    expect(row(reservation).querySelector('svg')).toBeTruthy();
  }
});
