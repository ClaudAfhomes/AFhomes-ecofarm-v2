import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, renderWithProviders, screen, waitFor } from '../../test/utils';
import {
  SignedDocumentPanel,
  signedDocumentBlocker,
  useSignedDocument,
} from './SignedDocumentPanel';
import * as api from './services-signed-documents';
import * as documents from '../documents/services';

vi.mock('./services-signed-documents', async (original) => ({
  ...(await original<typeof import('./services-signed-documents')>()),
  listSignedDocuments: vi.fn(),
  requestSignedDocumentUpload: vi.fn(),
  registerSignedDocument: vi.fn(),
  reviewSignedDocument: vi.fn(),
  getSignedDocumentDownload: vi.fn(),
  sha256Hex: vi.fn(async () => 'a'.repeat(64)),
}));
vi.mock('../documents/services', async (original) => ({
  ...(await original<typeof import('../documents/services')>()),
  putUploadBytes: vi.fn(async () => undefined),
}));

const APP_ID = '00000000-0000-4000-8000-000000000001';
const DOC_ID = '00000000-0000-4000-8000-0000000000d1';
const doc = (over: Record<string, unknown> = {}) => ({
  id: DOC_ID,
  kind: 'signed_customer_application',
  status: 'pending_review',
  applicationId: APP_ID,
  reservationId: null,
  originalFilename: 'signed.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 10,
  uploadedBy: '00000000-0000-4000-8000-0000000000d2',
  uploadedByName: 'Uploader',
  uploadedAt: '2026-11-11T00:00:00.000Z',
  reviewedBy: null,
  reviewedByName: null,
  reviewedAt: null,
  reviewNotes: null,
  ...over,
});

function Host() {
  const signed = useSignedDocument('applications', APP_ID);
  const [message, setMessage] = useState('');
  return (
    <>
      <SignedDocumentPanel controller={signed} />
      <button
        disabled={signedDocumentBlocker(signed) !== null}
        onClick={() => signed.ensureAccepted().then(
          () => setMessage('accepted'),
          (e: Error) => setMessage(e.message),
        )}
      >
        Review and approve
      </button>
      <output>{signedDocumentBlocker(signed)}</output>
      <output data-testid="message">{message}</output>
    </>
  );
}
const png = () => new File(['signed-bytes'], 'signed.png', { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:signed');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(api.listSignedDocuments).mockResolvedValue([]);
  vi.mocked(api.requestSignedDocumentUpload).mockResolvedValue({
    storagePath: `applications/${APP_ID}/signed.png`,
    uploadUrl: 'https://storage.test/upload',
    expiresAt: '2026-11-11T02:00:00.000Z',
  });
  vi.mocked(api.registerSignedDocument).mockResolvedValue({ id: DOC_ID });
  vi.mocked(api.reviewSignedDocument).mockResolvedValue({ id: DOC_ID });
  vi.mocked(api.getSignedDocumentDownload).mockResolvedValue({
    url: 'https://files.test/signed.pdf',
    expiresAt: '2026-11-11T02:00:00.000Z',
  });
});

describe('signed document: review and approve', () => {
  it('blocks with a plain reason until a document is uploaded or picked', async () => {
    renderWithProviders(<Host />);
    expect(await screen.findByText(/No signed Customer Application has been uploaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and approve' })).toBeDisabled();
    expect(screen.getByText(/Upload the signed Customer Application .* before approving/)).toBeInTheDocument();
    await userEvent.setup().upload(screen.getByLabelText(/Signed document file/), png());
    expect(screen.getByRole('button', { name: 'Review and approve' })).toBeEnabled();
    expect(screen.getByRole('img', { name: 'Signed document preview' })).toHaveAttribute('src', 'blob:signed');
  });

  it('uploads, registers with the hash, then accepts - in that order', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    await user.upload(await screen.findByLabelText(/Signed document file/), png());
    await user.click(screen.getByRole('button', { name: 'Review and approve' }));
    await waitFor(() => expect(screen.getByTestId('message')).toHaveTextContent('accepted'));
    expect(api.requestSignedDocumentUpload).toHaveBeenCalledWith('applications', APP_ID, {
      contentType: 'image/png',
      byteSize: 12,
    });
    expect(documents.putUploadBytes).toHaveBeenCalledWith('https://storage.test/upload', expect.any(File));
    expect(api.registerSignedDocument).toHaveBeenCalledWith('applications', APP_ID, {
      storagePath: `applications/${APP_ID}/signed.png`,
      originalFilename: 'signed.png',
      mimeType: 'image/png',
      sizeBytes: 12,
      sha256: 'a'.repeat(64),
    });
    expect(api.reviewSignedDocument).toHaveBeenCalledWith(DOC_ID, { decision: 'accepted' });
    const order = [
      vi.mocked(api.requestSignedDocumentUpload).mock.invocationCallOrder[0]!,
      vi.mocked(documents.putUploadBytes).mock.invocationCallOrder[0]!,
      vi.mocked(api.registerSignedDocument).mock.invocationCallOrder[0]!,
      vi.mocked(api.reviewSignedDocument).mock.invocationCallOrder[0]!,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('names the failed step and a retry does not upload or register again', async () => {
    const user = userEvent.setup();
    vi.mocked(api.reviewSignedDocument).mockRejectedValueOnce(new Error('Server busy.'));
    renderWithProviders(<Host />);
    await user.upload(await screen.findByLabelText(/Signed document file/), png());
    await user.click(screen.getByRole('button', { name: 'Review and approve' }));
    await waitFor(() =>
      expect(screen.getByTestId('message')).toHaveTextContent(/step failed \(accepting the document\): Server busy\./),
    );
    await user.click(screen.getByRole('button', { name: 'Review and approve' }));
    await waitFor(() => expect(screen.getByTestId('message')).toHaveTextContent('accepted'));
    expect(api.requestSignedDocumentUpload).toHaveBeenCalledTimes(1);
    expect(api.registerSignedDocument).toHaveBeenCalledTimes(1);
    expect(api.reviewSignedDocument).toHaveBeenCalledTimes(2);
  });

  it('accepts an already-uploaded pending document without uploading', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listSignedDocuments).mockResolvedValue([doc() as never]);
    renderWithProviders(<Host />);
    await screen.findByText(/signed\.pdf — Pending review/);
    expect(await screen.findByLabelText('Signed document preview')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review and approve' }));
    await waitFor(() => expect(screen.getByTestId('message')).toHaveTextContent('accepted'));
    expect(api.requestSignedDocumentUpload).not.toHaveBeenCalled();
    expect(api.reviewSignedDocument).toHaveBeenCalledWith(DOC_ID, { decision: 'accepted' });
  });

  it('an already accepted document skips every step', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listSignedDocuments).mockResolvedValue([doc({ status: 'accepted' }) as never]);
    renderWithProviders(<Host />);
    await screen.findByText(/signed\.pdf — Accepted/);
    await user.click(screen.getByRole('button', { name: 'Review and approve' }));
    await waitFor(() => expect(screen.getByTestId('message')).toHaveTextContent('accepted'));
    expect(api.reviewSignedDocument).not.toHaveBeenCalled();
  });

  it('refuses a wrong file type before any request', async () => {
    renderWithProviders(<Host />);
    const input = await screen.findByLabelText(/Signed document file/);
    fireEvent.change(input, { target: { files: [new File(['x'], 'x.gif', { type: 'image/gif' })] } });
    expect(await screen.findByText('The signed document must be a PDF, JPEG or PNG file.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and approve' })).toBeDisabled();
    expect(api.requestSignedDocumentUpload).not.toHaveBeenCalled();
  });

  it('rejecting the document needs a reason of at least 5 characters', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listSignedDocuments).mockResolvedValue([doc() as never]);
    renderWithProviders(<Host />);
    await user.click(await screen.findByRole('button', { name: 'Reject document' }));
    await user.type(screen.getByLabelText(/Reason/), 'bad');
    expect(screen.getByRole('button', { name: 'Confirm reject document' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'dly');
    await user.click(screen.getByRole('button', { name: 'Confirm reject document' }));
    await waitFor(() =>
      expect(api.reviewSignedDocument).toHaveBeenCalledWith(DOC_ID, {
        decision: 'rejected',
        notes: 'baddly',
      }),
    );
  });
});
