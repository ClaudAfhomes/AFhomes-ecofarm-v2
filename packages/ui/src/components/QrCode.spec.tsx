import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadQrImage, QrCode } from '../index';

/**
 * QrCode renders the matrix as a data-URL image locally - no external
 * service. Generation is async (qrcode lib), so the img src resolves after
 * the promise. The download helper writes a PNG from the generated matrix.
 */
describe('QrCode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an image whose src is a generated data URL', async () => {
    render(<QrCode value="AFH-CARD-2026-101" size={120} alt="QR code for AFH-CARD-2026-101" />);
    const img = (await screen.findByRole('img', {
      name: 'QR code for AFH-CARD-2026-101',
    })) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    await waitFor(() => {
      expect(img?.src.startsWith('data:image/png')).toBe(true);
    });
    expect(img?.getAttribute('width')).toBe('120');
  });

  it('respects the requested size', async () => {
    render(<QrCode value="ABC-1" size={240} alt="QR code for ABC-1" />);
    const img = await screen.findByRole('img', { name: 'QR code for ABC-1' });
    expect(img.getAttribute('width')).toBe('240');
  });

  it('downloads a PNG for the value', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadQrImage('AFH-CARD-2026-101', 'voucher.png');
    expect(click).toHaveBeenCalled();
  });
});
