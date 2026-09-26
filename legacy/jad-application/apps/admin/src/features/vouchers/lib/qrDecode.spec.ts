import { describe, expect, it, vi } from 'vitest';

import { decodeQrImageData } from './qrDecode';

const jsQrMock = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('jsqr', () => ({ default: jsQrMock.decode }));

const imageData = (): ImageData =>
  ({ data: new Uint8ClampedArray(16), width: 4, height: 4 }) as ImageData;

describe('decodeQrImageData', () => {
  it('returns the trimmed decoded payload', () => {
    jsQrMock.decode.mockReturnValueOnce({ data: ' JAD-VCH-2026-101 ' });
    expect(decodeQrImageData(imageData())).toBe('JAD-VCH-2026-101');
  });

  it('returns null when no QR is detected', () => {
    jsQrMock.decode.mockReturnValueOnce(null);
    expect(decodeQrImageData(imageData())).toBeNull();
  });

  it('returns null for an empty payload', () => {
    jsQrMock.decode.mockReturnValueOnce({ data: '   ' });
    expect(decodeQrImageData(imageData())).toBeNull();
  });
});
