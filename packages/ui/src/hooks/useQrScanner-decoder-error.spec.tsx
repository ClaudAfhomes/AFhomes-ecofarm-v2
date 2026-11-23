import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./qr-decoder.js', () => { throw new Error('Decoder download failed'); });
import { useQrScanner } from './useQrScanner';

afterEach(() => vi.unstubAllGlobals());

it('releases the camera and keeps the typed-code fallback when the decoder cannot load', async () => {
  const stop = vi.fn();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
  });
  const { result, unmount } = renderHook(() => useQrScanner(vi.fn()));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(stop).toHaveBeenCalledOnce();
  expect(result.current.message).toMatch(/typed code/i);
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});
