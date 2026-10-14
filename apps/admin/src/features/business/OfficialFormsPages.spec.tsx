import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { customerSchema, identityDocumentSchema } from '@afhomes/contracts';
import {
  CustomerApplicationEditorPage,
  CustomerApplicationsPage,
  ReservationAgreementsPage,
} from './OfficialFormsPages';
import {
  getCardProducts,
  getCustomerApplication,
  getCustomerById,
  getCustomerApplicationsPage,
  getCustomersPage,
  getReservationAgreementsPage,
} from './services';
import {
  getCurrentDocument,
  completeDocumentUpload,
  putUploadBytes,
  requestUploadGrant,
} from '../documents/services';

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
  reopenCustomerApplication: vi.fn(),
  reopenReservationAgreement: vi.fn(),
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

beforeEach(() => {
  // Default: no current identity document. Tests that need one set it through
  // their own setup so the value is in place before the query first runs.
  vi.mocked(getCurrentDocument).mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

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
  const setup = async (current: ReturnType<typeof document> | null = null) => {
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
    vi.mocked(getCardProducts).mockResolvedValue([]);
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
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
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

  it('shows the recorded ID type of the current document and prompts when missing', async () => {
    await setup(document('completed'));
    expect(await screen.findByText(/ID type: passport/)).toBeInTheDocument();
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
