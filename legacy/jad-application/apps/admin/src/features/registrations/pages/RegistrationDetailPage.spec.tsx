import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/utils';
import { RegistrationDetailPage } from './RegistrationDetailPage';

const { mockGetRegistrationById, mockGetGovernmentIdUrl, mockApproveRegistration } = vi.hoisted(
  () => ({
    mockGetRegistrationById: vi.fn(),
    mockGetGovernmentIdUrl: vi.fn(),
    mockApproveRegistration: vi.fn(),
  }),
);

vi.mock('../repositories/registrationRepository', () => ({
  getRegistrationById: (...args: unknown[]) => mockGetRegistrationById(...args),
  getGovernmentIdUrl: (...args: unknown[]) => mockGetGovernmentIdUrl(...args),
  approveRegistration: (...args: unknown[]) => mockApproveRegistration(...args),
  rejectRegistration: vi.fn(),
}));

vi.mock('../hooks/useRegistration', () => ({
  useRegistration: () => ({
    data: mockGetRegistrationById(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

function registration(governmentId: Record<string, unknown>) {
  return {
    id: 'reg-001',
    status: 'PENDING',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    phone: '+639171234567',
    dateOfBirth: '1990-01-01',
    gender: 'Male',
    countryCode: 'PH',
    countryName: 'Philippines',
    programId: 'prg-domestic',
    programCode: 'DOMESTIC',
    qualificationAnswers: [],
    governmentId,
    submittedAt: '2026-08-01T00:00:00.000Z',
  };
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/registrations/:id" element={<RegistrationDetailPage />} />
    </Routes>,
    { route: '/admin/registrations/reg-001' },
  );
}

describe('RegistrationDetailPage government ID preview', () => {
  beforeEach(() => {
    mockGetRegistrationById.mockReturnValue(
      registration({ fileName: 'id.png', mimeType: 'image/png', sizeBytes: 70 }),
    );
    mockGetGovernmentIdUrl.mockReset();
  });

  it('shows the no-file state when no storage path is on record', () => {
    renderDetail();
    expect(screen.getByText(/No file on record/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('renders without crashing when no government ID was ever captured', () => {
    mockGetRegistrationById.mockReturnValue({
      ...registration({ fileName: 'id.png', mimeType: 'image/png', sizeBytes: 70 }),
      governmentId: null,
    });
    renderDetail();
    expect(screen.getByText(/No document on record/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('previews images in a dialog', async () => {
    mockGetRegistrationById.mockReturnValue(
      registration({
        fileName: 'id.png',
        mimeType: 'image/png',
        sizeBytes: 70,
        storagePath: 'reg-001/id.png',
      }),
    );
    mockGetGovernmentIdUrl.mockResolvedValue('https://signed.test/id.png');
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(mockGetGovernmentIdUrl).toHaveBeenCalled());
    const img = (await screen.findByAltText('Government ID id.png')) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.src).toBe('https://signed.test/id.png');
    expect(mockGetGovernmentIdUrl).toHaveBeenCalledWith('reg-001');
  });

  it('embeds PDFs with a new-tab fallback', async () => {
    mockGetRegistrationById.mockReturnValue(
      registration({
        fileName: 'id.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 80,
        storagePath: 'reg-001/id.pdf',
      }),
    );
    mockGetGovernmentIdUrl.mockResolvedValue('https://signed.test/id.pdf');
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const frame = await screen.findByTitle('Government ID id.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute(
      'href',
      'https://signed.test/id.pdf',
    );
  });

  it('shows friendly placeholders for blank applicant details', () => {
    renderDetail();
    expect(screen.getByText('No address provided')).toBeInTheDocument();
    expect(screen.getByText('No email provided')).toBeInTheDocument();
    expect(screen.getByText('No sponsor code provided')).toBeInTheDocument();
    expect(screen.getAllByText('Not yet reviewed').length).toBeGreaterThan(0);
  });

  it('locks the accept confirm while approving so double-click sends one request', async () => {
    mockGetRegistrationById.mockReturnValue(
      registration({ fileName: 'id.png', mimeType: 'image/png', sizeBytes: 70 }),
    );
    let resolveApprove!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      resolveApprove = resolve;
    });
    mockApproveRegistration.mockReturnValueOnce(gate);
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Accept Registration' }));
    const confirm = await screen.findByRole('button', { name: 'Accept' });
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    // Second click while pending must not fire again.
    fireEvent.click(confirm);
    resolveApprove(undefined);
    await waitFor(() => expect(mockApproveRegistration).toHaveBeenCalledTimes(1));
  });

  it('shows an error with retry when the signed URL fails', async () => {
    mockGetRegistrationById.mockReturnValue(
      registration({
        fileName: 'id.png',
        mimeType: 'image/png',
        sizeBytes: 70,
        storagePath: 'reg-001/id.png',
      }),
    );
    mockGetGovernmentIdUrl.mockRejectedValueOnce(new Error('Bucket gone'));
    mockGetGovernmentIdUrl.mockResolvedValue('https://signed.test/id.png');
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Bucket gone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByAltText('Government ID id.png');
    expect(mockGetGovernmentIdUrl).toHaveBeenCalledTimes(2);
  });
});
