import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdCapturePicker } from './IdCapturePicker';

describe('ID capture browser invocation', () => {
  it('opens the secure file picker and passes the selected file', () => {
    const onFile = vi.fn();
    render(<IdCapturePicker onFile={onFile} />);
    const input = screen.getByLabelText('Upload ID');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Upload an ID' }));
    expect(click).toHaveBeenCalledOnce();
    const file = new File(['synthetic ID'], 'qa-id.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
  });
  it('requests the rear camera through the supported native capture attributes', () => {
    render(<IdCapturePicker onFile={vi.fn()} />);
    const input = screen.getByLabelText('Scan / Take Photo');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(click).toHaveBeenCalledOnce();
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
  });
  it('keeps both capture actions unavailable before a persisted subject exists', () => {
    render(<IdCapturePicker disabled onFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Upload an ID' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeDisabled();
  });
});

/**
 * The real-camera path.
 *
 * jsdom has no `getUserMedia` and no video decoding, so every test below
 * INJECTS a fake stream. That is honest about what it proves: that the sheet
 * opens, that the frame becomes a `File`, that the stream is torn down, and that
 * the captured file reaches the SAME `onFile` the file input uses. It does not
 * prove that a physical camera produces a correct image - only a device can do
 * that, and that check is reported separately as PHYSICAL CAMERA UAT.
 */
describe('ID capture real camera path', () => {
  let stopTrack: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  const original = globalThis.navigator;

  beforeEach(() => {
    stopTrack = vi.fn();
    getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: stopTrack }, { stop: vi.fn() }],
    }));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia } },
    });
  });

  /**
   * jsdom ships no canvas implementation, so `getContext('2d')` returns null and
   * a real frame can never be drawn. That is a fixture gap, not a product gap,
   * so it is filled the same way `getUserMedia` is: an injected stub. Without
   * this, `capture()` returns null by design and the preview never appears.
   */
  function stubCanvas(): void {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      `data:image/jpeg;base64,${btoa('SYNTHETIC-FRAME-BYTES')}`,
    );
  }

  /** jsdom reports a zero-sized video, so the frame dimensions must be faked. */
  function stubVideoFrame(width = 1280, height = 720): HTMLVideoElement {
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
    return video;
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: original,
    });
    vi.restoreAllMocks();
  });

  it('asks for the rear camera with no audio when the sheet opens', async () => {
    render(<IdCapturePicker onFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('produces a File from the captured frame and hands it to the same onFile', async () => {
    const onFile = vi.fn();
    stubCanvas();
    render(<IdCapturePicker onFile={onFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    const capture = await screen.findByRole('button', { name: 'Capture' });

    stubVideoFrame();
    fireEvent.click(capture);
    fireEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));

    expect(onFile).toHaveBeenCalledTimes(1);
    const file = onFile.mock.calls[0]?.[0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/jpeg');
    // One upload path: the same callback the <input type="file"> uses, so the
    // caller's MIME/size validation and upload are unchanged.
    expect(file.size).toBeGreaterThan(0);
  });

  it('stops every track when the shutter fires', async () => {
    stubCanvas();
    render(<IdCapturePicker onFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    const capture = await screen.findByRole('button', { name: 'Capture' });
    stubVideoFrame(640, 480);
    fireEvent.click(capture);
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it('stops the stream when the sheet is cancelled, and uploads nothing', async () => {
    const onFile = vi.fn();
    render(<IdCapturePicker onFile={onFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    await screen.findByRole('button', { name: 'Capture' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
    expect(onFile).not.toHaveBeenCalled();
  });

  it('stops the stream when the component unmounts mid-session', async () => {
    const { unmount } = render(<IdCapturePicker onFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    await screen.findByRole('button', { name: 'Capture' });
    unmount();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('explains a denied permission and keeps the upload fallback available', async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    render(<IdCapturePicker onFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(await screen.findByText(/Camera access was declined/)).toBeInTheDocument();
    // The file picker is still right there, so the user is never stuck.
    expect(screen.getByRole('button', { name: 'Upload an ID' })).toBeEnabled();
  });

  it('reports a busy or absent camera without crashing', async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('busy'), { name: 'NotReadableError' }),
    );
    render(<IdCapturePicker onFile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(await screen.findByText(/No camera is available/)).toBeInTheDocument();
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('falls back to the native capture input when getUserMedia is missing', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: undefined },
    });
    render(<IdCapturePicker onFile={vi.fn()} />);
    const input = screen.getByLabelText('Scan / Take Photo');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(click).toHaveBeenCalledOnce();
  });
});
