import jsQR from 'jsqr';

/**
 * Decode a voucher code from an image's pixel data via jsQR. Mirrors the exact
 * options used by the camera scanner (`useQrScanner`) so an uploaded QR decodes
 * identically to a live scan. Pure - unit-testable without a canvas.
 */
export function decodeQrImageData(imageData: ImageData): string | null {
  const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  });
  const data = decoded?.data?.trim();
  return data ? data : null;
}
