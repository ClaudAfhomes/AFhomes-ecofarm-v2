import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQrScanner } from './useQrScanner';

afterEach(() => vi.unstubAllGlobals());

describe('shared camera lifecycle', () => {
  it.each(['cancel', 'unmount'])('stops a delayed camera stream after %s', async (action) => {
    const stop = vi.fn();
    const media = { getTracks: () => [{ stop }] };
    let resolve: (value: typeof media) => void = () => {
      throw new Error('Camera request not started');
    };
    const getUserMedia = vi.fn(
      () =>
        new Promise<typeof media>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const { result, unmount } = renderHook(() => useQrScanner(vi.fn()));
    act(() => result.current.start());
    expect(result.current.status).toBe('requesting');
    if (action === 'cancel') act(() => result.current.stop());
    else unmount();
    await act(async () => resolve(media));
    expect(stop).toHaveBeenCalledOnce();
    if (action === 'cancel') expect(result.current.status).toBe('idle');
  });

  it('requests the chosen camera with no audio and gives a manual fallback on denial', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Denied'), { name: 'NotAllowedError' }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const { result } = renderHook(() => useQrScanner(vi.fn()));
    act(() => result.current.start('user'));
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'user' } },
      audio: false,
    });
    expect(result.current.message).toMatch(/typed code/i);
  });
});
