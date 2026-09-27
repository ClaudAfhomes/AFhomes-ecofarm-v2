/**
 * Camera QR scanning for the redemption till.
 *
 * WHAT THIS DOES
 *  - Asks for the camera ONLY when the scan panel is open, and stops every track
 *    the moment it closes, a scan succeeds, or the component unmounts. A till that
 *    keeps the camera light on after the member walks away is both a privacy
 *    problem and a battery problem.
 *  - Decodes the frame IN THE BROWSER with `jsqr`. No frame, no image and no
 *    screenshot is ever uploaded. The only thing that leaves the device is the
 *    decoded opaque token - the same string the member's card already carries.
 *  - Never stores, logs or displays a captured frame.
 *
 * WHAT THIS IS NOT
 *  - Not NFC. There is no tag reader, no tag id and no WebNFC. A QR code is an
 *    image, and this reads images.
 *
 * The frame loop is driven by an EFFECT keyed on the scanning status rather than
 * by a self-referencing `requestAnimationFrame` callback. That keeps the loop
 * honest: there is exactly one place a frame can be scheduled, React tears it down
 * when scanning stops, and the loop never has to reference itself.
 *
 * The decoder is injectable so the workflow can be tested without a camera. jsdom
 * has no `getUserMedia` and no video decoding, and a test that pretended
 * otherwise would be testing nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export type ScannerStatus = 'idle' | 'requesting' | 'scanning' | 'denied' | 'unavailable' | 'error';

/** The injected decoder, so a test can supply a known value. */
export type FrameDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

export const defaultDecoder: FrameDecoder = (data, width, height) =>
  jsQR(data, width, height, { inversionAttempts: 'dontInvert' });

/** Suppresses re-firing the same code while it stays in view. */
const REPEAT_SUPPRESS_MS = 1500;

/** Frames are decoded at this width. 1080p is far more than a QR code needs, and
 *  decoding every frame at full size is what makes a scanner stutter. */
const FRAME_WIDTH = 480;

export type QrScannerControls = {
  start: () => void;
  stop: () => void;
  videoRef: (element: HTMLVideoElement | null) => void;
};

export type UseQrScannerResult = {
  status: ScannerStatus;
  /** The human explanation for a non-scanning status, safe to render. */
  message: string | null;
} & QrScannerControls;

export function useQrScanner(
  onDecoded: (value: string) => void,
  decoder: FrameDecoder = defaultDecoder,
): UseQrScannerResult {
  const [status, setStatus] = useState<ScannerStatus>('idle');

  const videoElement = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const frameHandle = useRef<number | null>(null);
  const lastValue = useRef<{ value: string; at: number } | null>(null);
  // The decode callback is held in a ref so the frame effect never has to be
  // torn down and rebuilt when the parent re-renders with a new closure. It is
  // synced in an effect, never written during render: a ref written during
  // render is invisible to React and breaks under concurrent rendering.
  const decodeSink = useRef(onDecoded);
  useEffect(() => {
    decodeSink.current = onDecoded;
  }, [onDecoded]);

  const stop = useCallback(() => {
    if (frameHandle.current !== null) {
      cancelAnimationFrame(frameHandle.current);
      frameHandle.current = null;
    }
    // Stop EVERY track, not just the first: a device can expose more than one,
    // and a leftover track keeps the camera indicator lit.
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (videoElement.current) videoElement.current.srcObject = null;
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return;
    }
    setStatus('requesting');
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (media) => {
        stream.current = media;
        const video = videoElement.current;
        if (video) {
          video.srcObject = media;
          video.setAttribute('playsinline', 'true');
          try {
            await video.play();
          } catch {
            // Autoplay can be refused; the stream still works once the user
            // interacts. Not fatal, so it must not abort the scan.
          }
        }
        lastValue.current = null;
        setStatus('scanning');
      })
      .catch((error: unknown) => {
        stop();
        const name = (error as { name?: string } | null)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('unavailable');
        } else setStatus('error');
      });
  }, [stop]);

  // The frame loop. One schedule point, torn down whenever scanning stops.
  useEffect(() => {
    if (status !== 'scanning') return;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const video = videoElement.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        if (!canvas.current) canvas.current = document.createElement('canvas');
        const target = canvas.current;
        const width = FRAME_WIDTH;
        const height = Math.round((video.videoHeight / video.videoWidth) * width) || 1;
        target.width = width;
        target.height = height;
        const context = target.getContext('2d', { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, width, height);
          const frame = context.getImageData(0, 0, width, height);
          const decoded = decoder(frame.data, width, height);
          if (decoded?.data) {
            const now = Date.now();
            const previous = lastValue.current;
            const isRepeat =
              previous?.value === decoded.data && now - previous.at <= REPEAT_SUPPRESS_MS;
            if (!isRepeat) {
              lastValue.current = { value: decoded.data, at: now };
              // Stop BEFORE handing the value up, so the caller can navigate away
              // without the camera staying live behind the new screen.
              stop();
              setStatus('idle');
              decodeSink.current(decoded.data);
              return;
            }
          }
        }
      }
      frameHandle.current = requestAnimationFrame(tick);
    };

    frameHandle.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (frameHandle.current !== null) {
        cancelAnimationFrame(frameHandle.current);
        frameHandle.current = null;
      }
    };
  }, [status, decoder, stop]);

  // Unmounting must never leave a track running.
  useEffect(() => stop, [stop]);

  const messages: Record<Exclude<ScannerStatus, 'idle' | 'scanning'>, string> = {
    requesting: 'Requesting camera access…',
    denied: 'Camera access was declined. Enter the fallback member code instead.',
    unavailable: 'No camera is available on this device. Enter the fallback member code instead.',
    error: 'The camera could not be started. Enter the fallback member code instead.',
  };

  const message =
    status === 'idle' || status === 'scanning'
      ? null
      : (messages[status as Exclude<ScannerStatus, 'idle' | 'scanning'>] ?? null);

  return { status, message, start, stop, videoRef: setVideoElement };

  function setVideoElement(element: HTMLVideoElement | null): void {
    videoElement.current = element;
    // Attaching after the stream resolved (a slow mount) still works.
    if (element && stream.current) {
      element.srcObject = stream.current;
      void element.play();
    }
  }
}
