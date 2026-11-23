import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const loading = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { started: false, ready, release };
});
vi.mock('./qr-decoder.js', async () => {
  loading.started = true;
  await loading.ready;
  return { defaultDecoder: vi.fn(() => null) };
});

import { useQrScanner } from './useQrScanner';

afterEach(() => vi.unstubAllGlobals());

it('stops the camera immediately when cancelled during the decoder download', async () => {
  const stop = vi.fn();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
  });
  const { result, unmount } = renderHook(() => useQrScanner(vi.fn()));
  act(() => result.current.start());
  await waitFor(() => expect(loading.started).toBe(true));
  expect(result.current.status).toBe('requesting');
  act(() => result.current.stop());
  expect(stop).toHaveBeenCalledOnce();
  await act(async () => { loading.release(); });
  expect(result.current.status).toBe('idle');
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});
