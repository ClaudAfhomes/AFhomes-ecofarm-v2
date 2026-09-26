import { useCallback, useEffect, useRef, useState } from 'react';

import { decodeQrImageData } from '../lib/qrDecode';

export type QrUploadStatus = 'idle' | 'decoding' | 'error';

/** Largest edge (px) before an uploaded image is downscaled for jsQR. */
const MAX_DIMENSION = 1024;

/**
 * Decode a voucher code from an uploaded QR image. Reads the file into an
 * <img>, draws it to an offscreen canvas (downscaled to keep jsQR fast), and
 * decodes the pixels. Reports the code via `onDecode` or an inline error.
 * Revokes object URLs on reset/unmount.
 */
export function useQrImageUpload(onDecode: (code: string) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<QrUploadStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  const reset = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setPreviewUrl(null);
    setStatus('idle');
    setError(undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, []);

  const handleFile = useCallback((file: File | undefined) => {
    setError(undefined);
    setStatus('idle');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('error');
      setError('Upload a JPG, PNG or WebP image.');
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);
    setStatus('decoding');
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(
          1,
          MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          setStatus('error');
          setError('This image could not be read.');
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const code = decodeQrImageData(imageData);
        if (code) {
          setStatus('idle');
          onDecodeRef.current(code);
        } else {
          setStatus('error');
          setError('No QR code was found in that image.');
        }
      } catch {
        setStatus('error');
        setError('This image could not be read.');
      }
    };
    image.onerror = () => {
      setStatus('error');
      setError('This image could not be read.');
    };
    image.src = objectUrl;
  }, []);

  return { inputRef, previewUrl, status, error, handleFile, reset };
}
