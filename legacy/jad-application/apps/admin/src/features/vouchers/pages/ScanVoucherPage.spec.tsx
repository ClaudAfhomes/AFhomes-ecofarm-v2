import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { ScanVoucherPage } from './ScanVoucherPage';

const decodeMock = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('../lib/qrDecode', () => ({ decodeQrImageData: decodeMock.decode }));

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined;

function makeImageFile(): File {
  return new File(['qr'], 'voucher-qr.png', { type: 'image/png' });
}

/** Stub Image + canvas so the upload decode path completes synchronously in jsdom. */
function stubImageDecode() {
  class FakeImage {
    naturalWidth = 4;
    naturalHeight = 4;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(16), width: 4, height: 4 }) as ImageData,
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

function uploadFile(upload: HTMLInputElement, file: File) {
  fireEvent.change(upload, { target: { files: [file] } });
}

async function selectTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('tab', { name }));
}

describe('ScanVoucherPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
    // Camera unavailable in jsdom - the manual/upload paths are what we test.
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    });
    decodeMock.decode.mockReset();
  });

  afterEach(() => {
    server.restore();
    vi.unstubAllGlobals();
    if (originalGetContext) HTMLCanvasElement.prototype.getContext = originalGetContext;
    originalGetContext = undefined;
  });

  it('renders the input-method switcher with the camera panel by default', async () => {
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Scan Voucher QR')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Voucher input method' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Camera' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Voucher QR camera view')).toBeInTheDocument();
    // Only the active mode renders - manual/upload appear after switching.
    expect(screen.queryByLabelText('Voucher code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Upload QR image')).not.toBeInTheDocument();
  });

  it('shows a camera-unsupported hint directing to Manual or Upload', async () => {
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText(/Camera is not supported/)).toBeInTheDocument();
    expect(screen.getByText(/Switch to Manual or Upload/)).toBeInTheDocument();
  });

  it('switches between Camera, Manual, and Upload modes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await screen.findByText('Scan Voucher QR');

    await selectTab(user, 'Upload');
    expect(await screen.findByLabelText('Upload QR image')).toBeInTheDocument();
    expect(screen.queryByLabelText('Voucher code')).not.toBeInTheDocument();

    await selectTab(user, 'Manual');
    expect(await screen.findByLabelText('Voucher code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Upload QR image')).not.toBeInTheDocument();

    await selectTab(user, 'Camera');
    expect(await screen.findByLabelText('Voucher QR camera view')).toBeInTheDocument();
    expect(screen.queryByLabelText('Voucher code')).not.toBeInTheDocument();
  });

  it('resolves a manually entered code and shows the voucher result', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Manual');
    const input = await screen.findByLabelText('Voucher code');
    await user.type(input, 'JAD-VCH-2026-101');
    await user.click(screen.getByText('Look up'));

    expect(await screen.findByTestId('scan-result')).toBeInTheDocument();
    expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('JAD-VCH-2026-101')).toBeInTheDocument();
    expect(screen.getByText('Redeem voucher')).toBeInTheDocument();
  });

  it('shows an error for an unknown code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Manual');
    const input = await screen.findByLabelText('Voucher code');
    await user.type(input, 'JAD-VCH-2026-999');
    await user.click(screen.getByText('Look up'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no voucher matches/i);
  });

  it('offers Try again after a failed lookup and restarts scanning', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Manual');
    const input = await screen.findByLabelText('Voucher code');
    await user.type(input, 'JAD-VCH-2026-999');
    await user.click(screen.getByText('Look up'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no voucher matches/i);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Waiting for a scan…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers Scan another next to Redeem on a verified result', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Manual');
    const input = await screen.findByLabelText('Voucher code');
    await user.type(input, 'JAD-VCH-2026-101');
    await user.click(screen.getByText('Look up'));

    expect(await screen.findByTestId('scan-result')).toBeInTheDocument();
    expect(screen.getByText('Redeem voucher')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Scan another' }));
    expect(await screen.findByText('Waiting for a scan…')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-result')).not.toBeInTheDocument();
  });

  it('redeems a verified voucher after confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Manual');
    const input = await screen.findByLabelText('Voucher code');
    await user.type(input, 'JAD-VCH-2026-101');
    await user.click(screen.getByText('Look up'));
    await screen.findByTestId('scan-result');

    await user.click(screen.getByText('Redeem voucher'));
    await user.click(screen.getByText('Confirm redeem'));

    expect(await screen.findByText('Fully redeemed')).toBeInTheDocument();
    expect(screen.queryByText('Redeem voucher')).not.toBeInTheDocument();
  });

  it('shows a success toast and resets via Scan another after redemption', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Manual');
    const input = await screen.findByLabelText('Voucher code');
    await user.type(input, 'JAD-VCH-2026-105');
    await user.click(screen.getByText('Look up'));
    await screen.findByTestId('scan-result');

    await user.click(screen.getByText('Redeem voucher'));
    await user.click(screen.getByText('Confirm redeem'));

    expect(await screen.findByText('Voucher redeemed')).toBeInTheDocument();
    expect(await screen.findByText('Scan another')).toBeInTheDocument();

    await user.click(screen.getByText('Scan another'));
    expect(await screen.findByText('Waiting for a scan…')).toBeInTheDocument();
    expect(screen.queryByTestId('scan-result')).not.toBeInTheDocument();
  });

  it('rejects a scan of an already-redeemed voucher', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Manual');
    const input = await screen.findByLabelText('Voucher code');
    await user.type(input, 'JAD-VCH-2026-104');
    await user.click(screen.getByText('Look up'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already been redeemed/i);
  });

  it('decodes an uploaded QR image and shows the voucher result', async () => {
    stubImageDecode();
    decodeMock.decode.mockReturnValueOnce('JAD-VCH-2026-102');
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Upload');
    const upload = (await screen.findByLabelText('Upload QR image')) as HTMLInputElement;
    uploadFile(upload, makeImageFile());

    expect(await screen.findByTestId('scan-result')).toBeInTheDocument();
    expect(screen.getByText('Pedro Reyes')).toBeInTheDocument();
    expect(screen.getByText('JAD-VCH-2026-102')).toBeInTheDocument();
    expect(screen.getByText('Redeem voucher')).toBeInTheDocument();
  });

  it('shows an inline error when the uploaded image has no QR code', async () => {
    stubImageDecode();
    decodeMock.decode.mockReturnValueOnce(null);
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Upload');
    const upload = (await screen.findByLabelText('Upload QR image')) as HTMLInputElement;
    uploadFile(upload, makeImageFile());

    expect(await screen.findByRole('alert')).toHaveTextContent(/no QR code was found/i);
    expect(screen.queryByTestId('scan-result')).not.toBeInTheDocument();
  });

  it('rejects a non-image upload', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScanVoucherPage />, { user: MOCK_ADMIN });
    await selectTab(user, 'Upload');
    const upload = (await screen.findByLabelText('Upload QR image')) as HTMLInputElement;
    uploadFile(upload, new File(['x'], 'note.txt', { type: 'text/plain' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/jpg, png or webp/i);
  });
});
