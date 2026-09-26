import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import jsQR from 'jsqr';

import { useQrScanner } from './useQrScanner';

vi.mock('jsqr', () => ({ default: vi.fn(() => null) }));

const decodeMock = jsQR as unknown as ReturnType<typeof vi.fn>;

function Harness({ active, onDecode }: { active: boolean; onDecode: (code: string) => void }) {
  const { videoRef, status } = useQrScanner(onDecode, active);
  return (
    <>
      <video ref={videoRef} data-testid="cam" />
      <span data-testid="scanner-status">{status.kind}</span>
    </>
  );
}

/** jsdom has no camera - emulate enough of the platform for the hook. */
describe('useQrScanner', () => {
  let stopTrack: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let originalMediaDevices: PropertyDescriptor | undefined;
  let originalPlay: typeof HTMLVideoElement.prototype.play | undefined;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext | undefined;
  let rafCallbacks: FrameRequestCallback[];

  const runFrames = () => {
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const cb of pending) cb(0);
  };

  const readyVideo = () => {
    const video = screen.getByTestId('cam') as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 4, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 4, configurable: true });
    return video;
  };

  beforeEach(() => {
    stopTrack = vi.fn();
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = vi.fn(async () => {}) as never;
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ({
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(64), width: 4, height: 4 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    decodeMock.mockReset();
    decodeMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    if (originalPlay) HTMLVideoElement.prototype.play = originalPlay;
    if (originalGetContext) HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('starts the camera and reports running when active', async () => {
    const onDecode = vi.fn();
    render(<Harness active onDecode={onDecode} />);
    const video = readyVideo();

    expect(await screen.findByText('running')).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeDefined();
  });

  it('never touches the camera when initially inactive', () => {
    render(<Harness active={false} onDecode={vi.fn()} />);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId('scanner-status')).toHaveTextContent('idle');
  });

  it('stops the stream and reports idle when deactivated', async () => {
    const onDecode = vi.fn();
    const { rerender } = render(<Harness active onDecode={onDecode} />);
    const video = readyVideo();
    expect(await screen.findByText('running')).toBeInTheDocument();

    rerender(<Harness active={false} onDecode={onDecode} />);

    await waitFor(() =>
      expect(screen.getByTestId('scanner-status')).toHaveTextContent('idle'),
    );
    expect(stopTrack).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });

  it('restarts the camera when reactivated', async () => {
    const onDecode = vi.fn();
    const { rerender } = render(<Harness active={false} onDecode={onDecode} />);
    expect(getUserMedia).not.toHaveBeenCalled();

    rerender(<Harness active onDecode={onDecode} />);
    readyVideo();
    expect(await screen.findByText('running')).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('reports decoded frames while active', async () => {
    const onDecode = vi.fn();
    decodeMock.mockReturnValue({ data: '  JAD-VCH-2026-101  ' } as never);
    render(<Harness active onDecode={onDecode} />);
    readyVideo();
    expect(await screen.findByText('running')).toBeInTheDocument();

    runFrames();

    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('JAD-VCH-2026-101'));
  });

  it('reports a camera error when getUserMedia rejects', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('denied'));
    render(<Harness active onDecode={vi.fn()} />);
    expect(await screen.findByText('error')).toBeInTheDocument();
  });
});
