/**
 * Camera capture for an ID document.
 *
 * WHY THIS EXISTS INSTEAD OF A `<input capture>`.
 *
 * `capture="environment"` asks a MOBILE browser to open its camera app. On
 * desktop - and on any desktop-emulating browser - there is no camera app to
 * open, so the control silently degrades to the ordinary file picker. That was
 * the reported behaviour: "Take a photo" opened a Windows file dialog. A user
 * told to photograph an ID was handed a file browser instead.
 *
 * WHAT THIS DOES
 *  - Requests `getUserMedia` ONLY while the capture sheet is open, and stops
 *    EVERY track on capture, on cancel, on sheet close and on unmount. A stream
 *    left running keeps the camera indicator lit after the dialog is gone, which
 *    is both a privacy problem and a battery problem.
 *  - Prefers the rear camera (`facingMode: 'environment'`) and falls back to
 *    whatever camera exists, so a laptop webcam still works. A single device can
 *    expose more than one track, so cleanup stops all of them, not just the first.
 *  - Grabs one frame to a canvas and hands back a `File`, so the caller's
 *    EXISTING upload pipeline is used unchanged. There is deliberately no second
 *    upload path: a captured photo is a file like any other.
 *  - Never stores, logs or displays a frame beyond the preview the user is
 *    explicitly confirming.
 *
 * WHAT THIS IS NOT
 *  - Not a second identity-document pipeline, and not an OCR path.
 *  - Not NFC. There is no tag reader and none is planned.
 *
 * The decoder in `useQrScanner` is deliberately NOT generalised here. Scanning
 * runs a continuous `requestAnimationFrame` loop to find a code; capture runs
 * once, on demand. Sharing them would couple two unrelated lifecycles to save
 * about fifteen lines.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'live'
  | 'denied'
  | 'unavailable'
  | 'error';

export type CameraCapture = {
  status: CameraStatus;
  /** A human explanation for any non-live status. Safe to render. */
  message: string | null;
  /** Whether a `getUserMedia` camera exists at all, so the caller can show the
   *  file-input fallback instead of a button that cannot work. */
  supported: boolean;
  start: () => void;
  /** Stops the stream and returns to `idle` without capturing. */
  cancel: () => void;
  /**
   * Captures the current frame as a JPEG data URL, and stops the stream.
   * Returns null when there is nothing capturable (no frame, or no 2D context).
   */
  capture: () => string | null;
  videoRef: (element: HTMLVideoElement | null) => void;
  /** The captured frame as a JPEG data URL awaiting confirmation, or null. */
  preview: string | null;
  /** Publishes a captured frame for confirmation. Null clears it. */
  setPreview: (dataUrl: string | null) => void;
  /** Discards a captured preview and returns to the live view. */
  retake: () => void;
};

/** Frames are grabbed at this width; an ID needs no more and phones are slow. */
const CAPTURE_WIDTH = 1280;

export function useCameraCapture(): CameraCapture {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [preview, setPreviewState] = useState<string | null>(null);

  const videoElement = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);

  // `supported` is read during render to decide whether to offer the camera at
  // all. It is a capability check, not state, so it is computed rather than
  // stored: storing it would need an effect and would render one frame wrong.
  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const stop = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (videoElement.current) videoElement.current.srcObject = null;
  }, []);

  const start = useCallback(() => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setStatus('unavailable');
      return;
    }
    setPreviewState(null);
    setStatus('requesting');
    // 'ideal', not 'exact': an over-constrained request that demands the rear
    // camera FAILS on a laptop with only a webcam, which would be a worse
    // outcome than using the camera that does exist.
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
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
            // interacts. Not fatal, so it must not abort the capture.
          }
        }
        setStatus('live');
      })
      .catch((error: unknown) => {
        stop();
        const name = (error as { name?: string } | null)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('denied');
        else if (name === 'NotFoundError' || name === 'NotReadableError') {
          // NotReadableError is the "device busy" case: another app holds it.
          setStatus('unavailable');
        } else setStatus('error');
      });
  }, [stop]);

  const cancel = useCallback(() => {
    stop();
    setPreviewState(null);
    setStatus('idle');
  }, [stop]);

  /**
   * Grabs the current frame and shows it for confirmation.
   *
   * Returns the frame as a data URL rather than a `File`. `canvas.toBlob` is
   * asynchronous, and the caller needs the preview rendered before it can decide
   * to keep the photo - converting once, on confirm, is what lets "Retake"
   * discard the frame without ever having built a `File` for it.
   */
  const capture = useCallback((): string | null => {
    const video = videoElement.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement('canvas');
    const width = Math.min(CAPTURE_WIDTH, video.videoWidth);
    const height = Math.round((video.videoHeight / video.videoWidth) * width) || 1;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    // Stop BEFORE reading the frame back, so the camera light goes out the moment
    // the shutter fires rather than after the confirmation dialog is dismissed.
    stop();
    setStatus('idle');
    return canvas.toDataURL('image/jpeg', 0.92);
  }, [stop]);

  const retake = useCallback(() => {
    setPreviewState(null);
    start();
  }, [start]);

  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    videoElement.current = element;
    // Attaching after the stream resolved (a slow mount) still works.
    if (element && stream.current) {
      element.srcObject = stream.current;
      void element.play();
    }
  }, []);

  // Unmounting, or a route change that unmounts the sheet, must never leave a
  // track running.
  useEffect(() => stop, [stop]);

  const messages: Record<Exclude<CameraStatus, 'idle' | 'live'>, string> = {
    requesting: 'Requesting camera access…',
    denied: 'Camera access was declined. Allow camera permission, or use "Upload an ID".',
    unavailable:
      'No camera is available on this device. Use "Upload an ID" to choose a file instead.',
    error: 'The camera could not be started. Use "Upload an ID" to choose a file instead.',
  };

  const message =
    status === 'idle' || status === 'live'
      ? null
      : (messages[status as Exclude<CameraStatus, 'idle' | 'live'>] ?? null);

  const setPreview = useCallback((dataUrl: string | null) => setPreviewState(dataUrl), []);

  return {
    status,
    message,
    supported,
    start,
    cancel,
    capture,
    videoRef,
    preview,
    setPreview,
    retake,
  };
}
