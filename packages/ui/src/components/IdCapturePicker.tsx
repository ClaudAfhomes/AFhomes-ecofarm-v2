import { useRef } from 'react';
import { Button } from './Button.js';

export function IdCapturePicker({
  onFile,
  disabled = false,
  resetVersion = 0,
}: {
  onFile: (file: File | null) => void;
  disabled?: boolean;
  resetVersion?: number;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        key={`upload-${resetVersion}`}
        ref={upload}
        hidden
        aria-label="Upload ID"
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <input
        key={`camera-${resetVersion}`}
        ref={camera}
        hidden
        aria-label="Scan / Take Photo"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => upload.current?.click()}
      >
        Upload an ID
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => camera.current?.click()}
      >
        Take a photo
      </Button>
    </div>
  );
}
