import { useEffect, useState } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import QRCode from 'qrcode';

/**
 * QR-code renderer - generates the matrix locally (no external service, no
 * privacy leak) and shows it as a data-URL image. Used for member voucher
 * codes that an admin scans at the point of redemption.
 */
export interface QrCodeProps extends Omit<HTMLAttributes<HTMLImageElement>, 'src'> {
  /** The payload encoded into the matrix (e.g. a unique voucher code). */
  value: string;
  /** Square dimension in px. Default 120. */
  size?: number;
  /** Accessible name for the image. */
  alt: string;
  /** ECMA error-correction level. Default 'M'. */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  style?: CSSProperties;
}

export function QrCode({
  value,
  size = 120,
  alt,
  errorCorrectionLevel = 'M',
  style,
  ...rest
}: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      width: size,
      // Spec-grade quiet zone: 4 modules of white margin baked into the
      // image itself, so scanning never depends on surrounding page padding
      // (or none at all, for downloaded/printed codes). Payload, size and
      // error correction are unchanged.
      margin: 4,
      errorCorrectionLevel,
    })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => {
        if (alive) setDataUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [value, size, errorCorrectionLevel]);

  return (
    <img
      src={dataUrl ?? undefined}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      role="img"
      aria-label={alt}
      style={{
        ...style,
        width: size,
        height: size,
        objectFit: 'contain',
        background: '#fff',
        borderRadius: 4,
      }}
      {...rest}
    />
  );
}

/** Download the QR for the value as a PNG (client-side only). */
export async function downloadQrImage(value: string, filename: string): Promise<void> {
  const dataUrl = await QRCode.toDataURL(value, { width: 360, margin: 4 });
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
