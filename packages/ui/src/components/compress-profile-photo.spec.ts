import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compressProfilePhoto } from './compress-profile-photo';
const drawImage = vi.fn(),
  fillRect = vi.fn(),
  revoke = vi.fn(),
  encode = vi.fn();
beforeEach(() => {
  vi.restoreAllMocks();
  drawImage.mockClear();
  fillRect.mockClear();
  revoke.mockClear();
  encode.mockReset();
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 2400;
      naturalHeight = 1200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        if (value) queueMicrotask(() => this.onload?.());
      }
    },
  );
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:synthetic'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage, fillRect, fillStyle: '' }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(encode);
  encode.mockImplementation((callback: BlobCallback) =>
    callback(new Blob(['jpeg'], { type: 'image/jpeg' })),
  );
});
describe('profile photo compression', () => {
  it('reencodes to JPEG within limits, preserves aspect ratio and releases the source URL', async () => {
    const result = await compressProfilePhoto(
      new File(['png'], 'photo.png', { type: 'image/png' }),
    );
    expect(result.type).toBe('image/jpeg');
    expect(result.size).toBeLessThanOrEqual(500000);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 512, 256);
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  });
  it('reduces quality when the first encoding exceeds the saved limit', async () => {
    encode.mockImplementationOnce((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array(500001)], { type: 'image/jpeg' })),
    );
    await compressProfilePhoto(new File(['png'], 'p.png', { type: 'image/png' }));
    expect(encode).toHaveBeenLastCalledWith(expect.any(Function), 'image/jpeg', 0.7);
  });
  it('reduces dimensions and eventually rejects encodings that cannot fit', async () => {
    encode.mockImplementation((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array(500001)], { type: 'image/jpeg' })),
    );
    await expect(
      compressProfilePhoto(new File(['png'], 'p.png', { type: 'image/png' })),
    ).rejects.toThrow('0.5 MB');
    expect(drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 128, 64);
    expect(revoke).toHaveBeenCalled();
  });
  it.each(['image/svg+xml', 'image/gif', 'application/pdf'])(
    'rejects unsupported source %s',
    async (type) => {
      await expect(compressProfilePhoto(new File(['x'], 'p', { type }))).rejects.toThrow(
        'JPEG, PNG or WebP',
      );
      expect(drawImage).not.toHaveBeenCalled();
    },
  );
  it('rejects excessive original size before decoding', async () => {
    await expect(
      compressProfilePhoto(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'p.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow('10 MB');
  });
  it('reports encoder failure and releases the source URL', async () => {
    encode.mockImplementation((callback: BlobCallback) => callback(null));
    await expect(
      compressProfilePhoto(new File(['x'], 'p.png', { type: 'image/png' })),
    ).rejects.toThrow('compress');
    expect(revoke).toHaveBeenCalled();
  });
});
