import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const decoderModule = vi.hoisted(() => ({ loaded: false }));
vi.mock('jsqr', () => {
  decoderModule.loaded = true;
  return { default: vi.fn(() => null) };
});

import { useQrScanner } from './useQrScanner';

afterEach(() => vi.unstubAllGlobals());

it('does not load the camera decoder while viewing the page or using an injected decoder', async () => {
  const stop = vi.fn();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
  });
  const decoder = vi.fn(() => null);
  const { result, unmount } = renderHook(() => useQrScanner(vi.fn(), decoder));
  expect(decoderModule.loaded).toBe(false);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.status).toBe('scanning'));
  expect(decoderModule.loaded).toBe(false);
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it('loads the default decoder when the camera is used and still releases the stream', async () => {
  const stop = vi.fn();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) },
  });
  const { result, unmount } = renderHook(() => useQrScanner(vi.fn()));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.status).toBe('scanning'));
  expect(decoderModule.loaded).toBe(true);
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});
