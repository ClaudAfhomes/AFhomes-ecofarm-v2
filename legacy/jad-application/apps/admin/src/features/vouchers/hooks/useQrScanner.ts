import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export type ScannerStatus =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'running' }
  | { kind: 'error'; message: string };

const IDLE_STATUS: ScannerStatus = { kind: 'idle' };

/**
 * Camera QR scanner. Requests `getUserMedia`, streams to a hidden canvas,
 * decodes frames with jsQR, and reports the first stable decode. Cleans up
 * the stream + RAF on unmount.
 *
 * `active` gates the stream: flipping it to `false` stops the camera (tracks
 * + RAF released, status back to idle) so a successful decode can freeze the
 * viewfinder while the result is displayed; flipping back to `true` restarts
 * scanning. Falls back to a manual code entry when the camera is denied or
 * unavailable (caller supplies the input).
 */
export function useQrScanner(onDecode: (code: string) => void, active = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const [status, setStatus] = useState<ScannerStatus>({ kind: 'idle' });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const stop = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'error', message: 'Camera is not supported in this browser.' });
        return;
      }
      setStatus({ kind: 'requesting' });
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        setStatus({ kind: 'error', message: 'Camera access was denied or is unavailable.' });
        return;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stop();
        setStatus({ kind: 'error', message: 'Camera view unavailable.' });
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (cancelled) return;
      setStatus({ kind: 'running' });
      const scanCanvas = document.createElement('canvas');
      const ctx2d = scanCanvas.getContext('2d', { willReadFrequently: true });

      const tick = () => {
        if (cancelled) return;
        rafRef.current = requestAnimationFrame(tick);
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h || !ctx2d) return;
        scanCanvas.width = w;
        scanCanvas.height = h;
        ctx2d.drawImage(video, 0, 0, w, h);
        const imageData = ctx2d.getImageData(0, 0, w, h);
        const decoded = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
        if (decoded?.data) {
          onDecodeRef.current(decoded.data.trim());
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [active]);

  // While paused the viewfinder reports idle (derived, not state - the live
  // status resumes when scanning restarts).
  return { videoRef, status: active ? status : IDLE_STATUS };
}
