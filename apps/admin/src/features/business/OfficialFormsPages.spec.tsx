import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { customerSchema, identityDocumentSchema } from '@afhomes/contracts';
import type { IdentityDocument } from '@afhomes/contracts';
import {
  CustomerApplicationEditorPage,
  CustomerApplicationsPage,
  ReservationAgreementsPage,
} from './OfficialFormsPages';
import {
  createCustomerApplication,
  getCardProducts,
  getCustomers,
  getCustomerApplications,
  getReservationAgreements,
} from './services';
import {
  getDocuments,
  getCurrentDocument,
  completeDocumentUpload,
  confirmDocument,
  putUploadBytes,
  requestUploadGrant,
  runDocumentOcr,
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
  getCustomers: vi.fn(),
  getOfficialFormTemplate: vi.fn(),
  getReservationAgreement: vi.fn(),
  getReservationAgreements: vi.fn(),
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
  getDocuments: vi.fn(),
  getCurrentDocument: vi.fn(),
  completeDocumentUpload: vi.fn(),
  confirmDocument: vi.fn(),
  putUploadBytes: vi.fn(),
  requestUploadGrant: vi.fn(),
  runDocumentOcr: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(getCurrentDocument).mockImplementation(async () => {
    const response = vi.mocked(getDocuments).mock.results.at(-1);
    const rows = response?.type === 'return' ? await response.value : [];
    return rows?.find((doc) => doc.isCurrent && doc.verificationStatus !== 'rejected') ?? null;
  });
});
afterEach(() => vi.clearAllMocks());
async function dismissNotice() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
}

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
  it('shows loading - never a phantom empty state - on first load', () => {
    vi.mocked(getCustomerApplications).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CustomerApplicationsPage />);
    expect(screen.getByText('Loading applications…')).toBeInTheDocument();
    expect(screen.queryByText('No customer applications')).not.toBeInTheDocument();
  });

  it('shows the real empty state only after an empty response', async () => {
    vi.mocked(getCustomerApplications).mockResolvedValue([]);
    renderWithProviders(<CustomerApplicationsPage />);
    expect(await screen.findByText('No customer applications')).toBeInTheDocument();
  });

  it('renders rows in the shared filter toolbar with a clearable search', async () => {
    vi.mocked(getCustomerApplications).mockResolvedValue([application] as never);
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
    vi.mocked(getCustomerApplications).mockResolvedValue([application] as never);
    renderWithProviders(<CustomerApplicationsPage />);
    await screen.findByText('APP-000001');
    expect(getCustomerApplications).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'application_work' }),
    );
  });

  it('drops the queue filter when Include progressed is selected', async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomerApplications).mockResolvedValue([application] as never);
    renderWithProviders(<CustomerApplicationsPage />);
    await screen.findByText('APP-000001');
    vi.mocked(getCustomerApplications).mockClear();
    await user.selectOptions(screen.getByLabelText('Queue'), 'all');
    await waitFor(() =>
      expect(getCustomerApplications).toHaveBeenCalledWith(
        expect.not.objectContaining({ queue: expect.anything() }),
      ),
    );
  });
});

describe('ReservationAgreementsPage list states', () => {
  it('shows loading - never a phantom empty state - on first load', () => {
    vi.mocked(getReservationAgreements).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ReservationAgreementsPage />);
    expect(screen.getByText('Loading reservation agreements…')).toBeInTheDocument();
    expect(screen.queryByText('No reservation agreements')).not.toBeInTheDocument();
  });

  it('renders rows with a clearable search after load', async () => {
    vi.mocked(getReservationAgreements).mockResolvedValue([agreement] as never);
    renderWithProviders(<ReservationAgreementsPage />);
    expect(await screen.findByText('RES-000001')).toBeInTheDocument();
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: 'Search reservation agreements' }),
    ).toBeInTheDocument();
  });
});

describe('application private ID intake and review', () => {
  const customerId = '00000000-0000-4000-8000-000000000001';
  const documentId = '00000000-0000-4000-8000-000000000002';
  const setup = async (withExisting = false) => {
    vi.mocked(getCustomers).mockResolvedValue([
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
    ]);
    vi.mocked(getCardProducts).mockResolvedValue([]);
    vi.mocked(getDocuments).mockResolvedValue(withExisting ? [document('completed')] : []);
    vi.mocked(requestUploadGrant).mockResolvedValue({
      documentId,
      bucket: 'afhomes-customer-ids',
      uploadUrl: 'https://safe-test.example/signed-upload',
      expiresAt: '2026-10-03T12:00:00Z',
    });
    vi.mocked(putUploadBytes).mockResolvedValue(undefined);
    // One flow: "Detect fields" uploads the selected file and then runs OCR, so
    // OCR is mocked by default. Tests that exercise OCR failure or timing
    // override it.
    vi.mocked(runDocumentOcr).mockResolvedValue(document('completed'));
    vi.mocked(confirmDocument).mockImplementation(async () => document('completed'));
    vi.mocked(completeDocumentUpload).mockImplementation(async () => {
      const transfer = vi.mocked(putUploadBytes).mock.calls.at(-1);
      const doc = { ...document('completed'), originalFilename: transfer?.[1].name ?? 'qa.png' };
      vi.mocked(getDocuments).mockResolvedValue([doc]);
      return doc;
    });
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    fireEvent.change(screen.getByLabelText('ID Type'), { target: { value: 'passport' } });
    fireEvent.change(screen.getByLabelText('Upload ID'), {
      target: { files: [new File(['synthetic'], 'qa.png', { type: 'image/png' })] },
    });
  };
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
      extractedFields: {
        firstName: { value: 'Ana', confidence: 0.95 },
        lastName: { value: 'Uncertain', confidence: 0.4 },
      },
      warnings: [],
      reviewedFields: null,
      possibleDuplicate: null,
      uploadedAt: '2026-10-01',
      reviewedAt: null,
    });
  // Regression: the picker and a legacy standalone "Upload ID" button used to
  // both exist, so there were two controls over one selected file. "Detect
  // fields" performs the upload, so the picker is the only entry point.
  it('offers one upload entry point and no duplicate Upload ID button', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: 'Upload ID' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload an ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeInTheDocument();
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
    // A desktop browser ignores `capture`, so the same input still accepts a
    // chosen file. That captured file must join the one secure pipeline.
    const captured = new File(['cam'], 'capture.jpg', { type: 'image/jpeg' });
    fireEvent.change(camera, { target: { files: [captured] } });
    expect(await screen.findByText(/Selected ID: capture\.jpg/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await waitFor(() => expect(putUploadBytes).toHaveBeenCalledTimes(1));
    expect(putUploadBytes).toHaveBeenCalledWith(
      'https://safe-test.example/signed-upload',
      captured,
    );
    expect(requestUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({ mime: 'image/jpeg', originalFilename: 'capture.jpg' }),
    );
  });
  it('keeps Detect fields disabled until an ID file is selected', async () => {
    await setup(true);
    expect(await screen.findByText(/Current ID: qa\.png/)).toBeInTheDocument();
    cleanup();
    vi.mocked(getDocuments).mockResolvedValue([]);
    vi.mocked(getCurrentDocument).mockResolvedValue(null);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    expect(await screen.findByRole('button', { name: 'Detect fields' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Upload ID'), {
      target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] },
    });
    expect(screen.getByRole('button', { name: 'Detect fields' })).toBeEnabled();
  });
  // Regression: Submit is gated on an ID type recorded on the identity
  // document, and that field was only ever writable from /admin/documents, so
  // from this screen the requirement was unreachable and Submit stayed
  // permanently disabled with no indication of the missing step.
  it('makes the missing ID-type review reachable in place and persists it server-side', async () => {
    await setup(true);
    fireEvent.change(screen.getByLabelText('ID Type'), { target: { value: 'passport' } });
    expect(await screen.findByText(/Submit needs the ID type recorded/)).toBeInTheDocument();

    // The action is offered, and it is only enabled once an ID type is chosen.
    cleanup();
    vi.mocked(getDocuments).mockResolvedValue([document('completed')]);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    await screen.findByRole('button', { name: 'Record ID type on this ID' });
    expect(screen.getByRole('button', { name: 'Record ID type on this ID' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('ID Type'), { target: { value: 'passport' } });
    expect(screen.getByRole('button', { name: 'Record ID type on this ID' })).toBeEnabled();

    vi.mocked(getDocuments).mockResolvedValue([
      { ...document('completed'), reviewedFields: { idType: 'passport' } },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Record ID type on this ID' }));
    await screen.findByText(/ID type recorded on the identity document/);
    // Only the ID type leaves this screen; document numbers stay write-only, and
    // the record is written by the server, never optimistically in the browser.
    expect(confirmDocument).toHaveBeenCalledWith(documentId, {
      decision: 'confirmed',
      fields: { idType: 'passport' },
    });
    await waitFor(() => expect(screen.queryByText(/Submit needs the ID type recorded/)).toBeNull());
  });
  it('uploads to the selected customer, autofills confident suggestions, and preserves manual corrections', async () => {
    await setup();
    vi.mocked(runDocumentOcr).mockResolvedValue(document('completed'));
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await dismissNotice();
    await screen.findByText('Valid ID: Uploaded ✓');
    expect(requestUploadGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: 'customer',
        subjectId: customerId,
        mime: 'image/png',
      }),
    );
    expect(putUploadBytes).toHaveBeenCalledWith(
      'https://safe-test.example/signed-upload',
      expect.any(File),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await screen.findByText(/OCR completed/);
    await dismissNotice();
    expect(screen.getByLabelText('First name')).toHaveValue('Ana');
    expect(screen.getByLabelText('Last name')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'McDonald' } });
    fireEvent.blur(screen.getByLabelText('First name'));
    expect(screen.getByLabelText('First name')).toHaveValue('McDonald');
    expect(requestUploadGrant).toHaveBeenCalledTimes(1);
    expect(createCustomerApplication).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Review identity document' })).toHaveAttribute(
      'href',
      `/admin/documents/${documentId}`,
    );
  });
  it('retains the private upload when OCR fails and leaves manual entry available', async () => {
    await setup();
    vi.mocked(runDocumentOcr).mockRejectedValue(
      new Error('OCR failed; continue with manual entry.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await screen.findByText('OCR failed; continue with manual entry.');
    await dismissNotice();
    expect(screen.getByText('Valid ID: Uploaded ✓')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Anne-Marie' } });
    expect(screen.getByLabelText('First name')).toHaveValue('Anne-Marie');
    expect(createCustomerApplication).not.toHaveBeenCalled();
  });
  it('preserves deliberate edits made while OCR is still running', async () => {
    await setup();
    let complete!: (value: IdentityDocument) => void;
    vi.mocked(runDocumentOcr).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await waitFor(() => expect(runDocumentOcr).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Manual' } });
    complete(document('completed'));
    await screen.findByText(/OCR completed/);
    expect(screen.getByLabelText('First name')).toHaveValue('Manual');
  });
  it('shows existing customer documents as current while a new selection stays pending', async () => {
    await setup(true);
    expect(await screen.findByText(/Current ID:.*qa.png/)).toBeInTheDocument();
    expect(screen.getByText(/Pending replacement/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replacement' }));
    expect(screen.getByText(/Current ID:.*qa.png/)).toBeInTheDocument();
    expect(requestUploadGrant).not.toHaveBeenCalled();
  });
  const selectReplacement = () =>
    fireEvent.change(screen.getByLabelText('Upload ID'), {
      target: { files: [new File(['replacement'], 'replacement.png', { type: 'image/png' })] },
    });
  const uploadCurrent = async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await dismissNotice();
    await screen.findByText(/Current ID: qa\.png/);
  };
  it('keeps the current ID authoritative while replacement is pending and cancelled', async () => {
    await uploadCurrent();
    selectReplacement();
    expect(screen.getByText(/replacement.png.*Pending replacement/)).toBeInTheDocument();
    expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replacement' }));
    expect(screen.queryByText(/Pending replacement/)).not.toBeInTheDocument();
    expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
    expect(requestUploadGrant).toHaveBeenCalledTimes(1);
  });
  it('switches current ID only after replacement bytes persist and locks both pickers', async () => {
    await uploadCurrent();
    selectReplacement();
    let finish!: () => void;
    vi.mocked(putUploadBytes).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await waitFor(() => expect(putUploadBytes).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Upload ID')).toBeDisabled();
    expect(screen.getByLabelText('Scan / Take Photo')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel replacement' })).toBeDisabled();
    expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
    expect(screen.queryByText('Current ID: replacement.png')).not.toBeInTheDocument();
    finish();
    await screen.findByText('Current ID: replacement.png');
    expect(screen.queryByText(/Pending replacement/)).not.toBeInTheDocument();
    expect(screen.getByLabelText<HTMLInputElement>('Upload ID').files).toHaveLength(0);
  });
  it.each(['grant', 'bytes'])(
    'retains the old current ID when replacement %s fails',
    async (stage) => {
      await uploadCurrent();
      selectReplacement();
      if (stage === 'grant')
        vi.mocked(requestUploadGrant).mockRejectedValueOnce(new Error('Grant failed'));
      else vi.mocked(putUploadBytes).mockRejectedValueOnce(new Error('Bytes failed'));
      fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
      await screen.findByText(stage === 'grant' ? 'Grant failed' : 'Bytes failed');
      await dismissNotice();
      expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
      expect(screen.queryByText('Current ID: replacement.png')).not.toBeInTheDocument();
      expect(screen.getByText(/Pending replacement/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Review identity document' })).toHaveAttribute(
        'href',
        '/admin/documents/' + documentId,
      );
      expect(createCustomerApplication).not.toHaveBeenCalled();
    },
  );
  it('locks ID selection throughout OCR and retains the uploaded ID on OCR failure', async () => {
    await uploadCurrent();
    let fail!: (error: Error) => void;
    vi.mocked(runDocumentOcr).mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await waitFor(() => expect(runDocumentOcr).toHaveBeenCalledWith(documentId));
    expect(screen.getByLabelText('Upload ID')).toBeDisabled();
    expect(screen.getByLabelText('Scan / Take Photo')).toBeDisabled();
    fail(new Error('OCR unavailable'));
    await screen.findByText('OCR unavailable');
    await dismissNotice();
    expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
    expect(screen.getByLabelText('Upload ID')).toBeEnabled();
  });
  it('reopens with the old ID current and incomplete replacement metadata explicitly pending', async () => {
    await uploadCurrent();
    selectReplacement();
    vi.mocked(putUploadBytes).mockRejectedValueOnce(new Error('Bytes failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await screen.findByText('Bytes failed');
    cleanup();
    vi.mocked(getDocuments).mockResolvedValue([
      {
        ...document('completed'),
        id: '00000000-0000-4000-8000-000000000003',
        originalFilename: 'replacement.png',
        hasFile: false,
        isCurrent: false,
        ocrStatus: 'not_requested',
      },
      document('completed'),
    ]);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    expect(await screen.findByText(/Pending ID upload: replacement.png/)).toBeInTheDocument();
    expect(screen.getByText(/Current ID:.*qa.png/)).toBeInTheDocument();
    expect(screen.queryByText(/Current ID:.*replacement.png/)).not.toBeInTheDocument();
    vi.mocked(runDocumentOcr).mockResolvedValue(document('completed'));
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await waitFor(() => expect(runDocumentOcr).toHaveBeenCalledWith(documentId));
  });
  it('keeps replacement pending if server finalization fails after its bytes arrive', async () => {
    await uploadCurrent();
    selectReplacement();
    vi.mocked(completeDocumentUpload).mockRejectedValueOnce(
      new Error('Verification could not be saved'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await screen.findByText('Verification could not be saved');
    expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
    expect(screen.queryByText('Current ID: replacement.png')).not.toBeInTheDocument();
    expect(screen.getByText(/Pending replacement/)).toBeInTheDocument();
  });
  it('does not promote replacement while server verification is still pending', async () => {
    await uploadCurrent();
    selectReplacement();
    let finish!: (doc: ReturnType<typeof document>) => void;
    vi.mocked(completeDocumentUpload).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await waitFor(() => expect(completeDocumentUpload).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Current ID: qa\.png/)).toBeInTheDocument();
    expect(screen.getByLabelText('Upload ID')).toBeDisabled();
    vi.mocked(getDocuments).mockResolvedValue([
      { ...document('completed'), originalFilename: 'replacement.png' },
    ]);
    finish({ ...document('completed'), originalFilename: 'replacement.png' });
    await screen.findByText('Current ID: replacement.png');
  });
  it('verifies a saved pending upload and adopts the server current on refetch', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replacement' }));
    const pending = { ...document('completed'), hasFile: false, isCurrent: false };
    const current = { ...document('completed'), hasFile: true, isCurrent: true };
    vi.mocked(getDocuments).mockResolvedValueOnce([pending]).mockResolvedValue([current]);
    cleanup();
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    fireEvent.click(await screen.findByRole('button', { name: 'Verify saved upload' }));
    await screen.findByText(/Current ID: qa\.png/);
    expect(completeDocumentUpload).toHaveBeenCalledWith(documentId);
    expect(requestUploadGrant).not.toHaveBeenCalled();
    expect(putUploadBytes).not.toHaveBeenCalled();
  });

  it('A. verifying the older pending ID keeps the newer server current immediately', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replacement' }));
    const older: IdentityDocument = {
      ...document('completed'),
      id: '00000000-0000-4000-8000-000000000003',
      originalFilename: 'a-old.png',
      hasFile: false,
      isCurrent: false,
      verificationStatus: 'pending_review',
    };
    const newer: IdentityDocument = {
      ...document('completed'),
      id: '00000000-0000-4000-8000-000000000004',
      originalFilename: 'b-new.png',
      hasFile: true,
      isCurrent: true,
      verificationStatus: 'confirmed',
    };
    const olderVerified: IdentityDocument = { ...older, hasFile: true, isCurrent: false };
    vi.mocked(getDocuments)
      .mockResolvedValueOnce([newer, older])
      .mockResolvedValue([newer, olderVerified]);
    vi.mocked(completeDocumentUpload).mockResolvedValue(olderVerified as never);
    cleanup();
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    expect(await screen.findByText('Current ID: b-new.png')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify saved upload' }));
    // The write response and the refetched read agree: B stays current.
    await waitFor(() => expect(completeDocumentUpload).toHaveBeenCalledWith(older.id));
    expect(screen.getByText('Current ID: b-new.png')).toBeInTheDocument();
    expect(screen.queryByText('Current ID: a-old.png')).not.toBeInTheDocument();
    expect(requestUploadGrant).not.toHaveBeenCalled();
    expect(putUploadBytes).not.toHaveBeenCalled();
  });

  it('B. reopening shows the same server current, never the verified older ID', async () => {
    const olderVerified: IdentityDocument = {
      ...document('completed'),
      id: '00000000-0000-4000-8000-000000000003',
      originalFilename: 'a-old.png',
      hasFile: true,
      isCurrent: false,
      verificationStatus: 'pending_review',
    };
    const newer: IdentityDocument = {
      ...document('completed'),
      id: '00000000-0000-4000-8000-000000000004',
      originalFilename: 'b-new.png',
      hasFile: true,
      isCurrent: true,
      verificationStatus: 'confirmed',
    };
    vi.mocked(getDocuments).mockResolvedValue([newer, olderVerified]);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    expect(await screen.findByText('Current ID: b-new.png')).toBeInTheDocument();
    expect(screen.queryByText('Current ID: a-old.png')).not.toBeInTheDocument();
  });

  it('I. shows Verified-but-not-Current distinctly from the current ID', async () => {
    const olderVerified: IdentityDocument = {
      ...document('completed'),
      id: '00000000-0000-4000-8000-000000000003',
      originalFilename: 'a-old.png',
      hasFile: true,
      isCurrent: false,
      verificationStatus: 'pending_review',
    };
    const newer: IdentityDocument = {
      ...document('completed'),
      id: '00000000-0000-4000-8000-000000000004',
      originalFilename: 'b-new.png',
      hasFile: true,
      isCurrent: true,
      verificationStatus: 'confirmed',
    };
    vi.mocked(getDocuments).mockResolvedValue([newer, olderVerified]);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    expect(await screen.findByText('Current ID: b-new.png')).toBeInTheDocument();
    // The older verified document is listed as retained with its own status,
    // never merged into the current-ID display.
    expect(screen.getByText(/Retained ID:.*a-old\.png/)).toBeInTheDocument();
    expect(screen.queryByText('Current ID: a-old.png')).not.toBeInTheDocument();
  });
  it('never calls a rejected-only history current and disables current OCR', async () => {
    await setup();
    cleanup();
    vi.mocked(getDocuments).mockResolvedValue([
      { ...document('completed'), isCurrent: false, verificationStatus: 'rejected' },
    ]);
    vi.mocked(getCurrentDocument).mockResolvedValue(null);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    await screen.findByText(/Retained ID:.*qa.png/);
    expect(screen.queryByText(/Current ID:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Detect fields' })).toBeDisabled();
    expect(runDocumentOcr).not.toHaveBeenCalled();
  });
  it('uses the separate current response even when the loaded history page has no current row', async () => {
    await setup();
    cleanup();
    vi.mocked(getDocuments).mockResolvedValue([
      {
        ...document('completed'),
        isCurrent: false,
        id: '00000000-0000-4000-8000-000000000006',
        originalFilename: 'previous.png',
      },
    ]);
    vi.mocked(getCurrentDocument).mockResolvedValue(document('completed'));
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    await screen.findByText(/Current ID: qa\.png/);
    expect(screen.getByText(/Retained ID:.*previous.png/)).toBeInTheDocument();
    vi.mocked(runDocumentOcr).mockResolvedValue(document('completed'));
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await waitFor(() => expect(runDocumentOcr).toHaveBeenCalledWith(documentId));
  });
  it('switches to the server replacement after rejection without a local upload override', async () => {
    await setup();
    cleanup();
    const older = {
      ...document('completed'),
      id: '00000000-0000-4000-8000-000000000005',
      originalFilename: 'older.png',
    };
    const rejected = {
      ...document('completed'),
      originalFilename: 'rejected.png',
      isCurrent: false,
      verificationStatus: 'rejected' as const,
    };
    vi.mocked(getDocuments).mockResolvedValue([rejected, older]);
    vi.mocked(getCurrentDocument).mockResolvedValue(older);
    renderWithProviders(<CustomerApplicationEditorPage />);
    await screen.findByRole('option', { name: 'QA Customer' });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: customerId } });
    await screen.findByText(/Current ID: older\.png/);
    expect(screen.queryByText(/Current ID: rejected\.png/)).not.toBeInTheDocument();
    expect(screen.getByText(/Retained ID:.*rejected.png/)).toBeInTheDocument();
  });
  it('does not optimistically promote a completed upload when the server keeps another current', async () => {
    await setup(true);
    vi.mocked(completeDocumentUpload).mockResolvedValue({
      ...document('completed'),
      originalFilename: 'qa.png',
      isCurrent: false,
    });
    vi.mocked(getCurrentDocument).mockResolvedValue({
      ...document('completed'),
      originalFilename: 'other-current.png',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Detect fields' }));
    await screen.findByText(/Current ID: other-current\.png/);
    expect(screen.queryByText(/Current ID: qa\.png/)).not.toBeInTheDocument();
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
      vi.mocked(getReservationAgreements).mockResolvedValue([
        {
          ...agreement,
          tier,
          hasSecondaryHolder,
          primarySignatureStatus,
          secondarySignatureStatus,
        },
      ] as never);
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
  vi.mocked(getReservationAgreements).mockResolvedValue([{ ...agreement, saleId: null }] as never);
  renderWithProviders(<ReservationAgreementsPage />);
  expect(await screen.findByText('RES-000001')).toBeInTheDocument();
  expect(screen.getByText('Not finalized')).toBeInTheDocument();
  expect(screen.queryByText('Agreements could not be loaded')).not.toBeInTheDocument();
});
