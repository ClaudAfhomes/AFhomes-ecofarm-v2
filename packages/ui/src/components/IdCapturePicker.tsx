import { useRef, useState } from 'react';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';
import { useCameraCapture } from './useCameraCapture';

/**
 * Chooses an identity document, either from a file or from the real camera.
 *
 * "Take a photo" opens a live `getUserMedia` sheet wherever the browser has a
 * camera, and falls back to the native `capture="environment"` input where it
 * does not - which is what a desktop browser actually needs, since it has no
 * camera app to hand off to. Either way the result is a single `File` handed to
 * ONE `onFile`, so the caller's upload pipeline is unchanged and there is no
 * second path to keep in step.
 */
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = useCameraCapture();

  /**
   * Turns the confirmed frame into a `File` and hands it to the one `onFile`.
   *
   * This is deliberately the same hand-off the file input uses, so the caller's
   * upload pipeline sees no difference between a chosen file and a taken photo.
   * `atob` is the browser's own decoder; a data URL needs no library.
   */
  function confirmPreview(): void {
    const dataUrl = view.preview;
    if (!dataUrl) return;
    const binary = atob(dataUrl.split(',')[1] ?? '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    setSheetOpen(false);
    onFile(new File([bytes], 'id-photo.jpg', { type: 'image/jpeg' }));
  }

  function closeSheet(): void {
    view.cancel();
    setSheetOpen(false);
  }

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
        onClick={() => {
          // With no camera API there is nothing to preview or confirm, so the
          // native input is used directly instead of opening an empty sheet.
          if (!view.supported) {
            camera.current?.click();
            return;
          }
          setSheetOpen(true);
          view.start();
        }}
      >
        Take a photo
      </Button>

      <Dialog
        open={sheetOpen}
        onClose={closeSheet}
        title="Take a photo of the ID"
        closeLabel="Close camera"
      >
        <video
          ref={view.videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          style={{ width: '100%', maxHeight: '60vh', objectFit: 'cover' }}
        />
        {view.message ? <p role="status">{view.message}</p> : null}
        {view.preview ? (
          <img
            src={view.preview}
            alt="Captured ID photo awaiting confirmation"
            style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain' }}
          />
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {view.preview ? (
            <>
              <Button type="button" onClick={confirmPreview}>
                Use this photo
              </Button>
              <Button type="button" variant="secondary" onClick={view.retake}>
                Retake
              </Button>
              <Button type="button" variant="secondary" onClick={closeSheet}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                disabled={view.status !== 'live'}
                onClick={() => view.setPreview(view.capture())}
              >
                Capture
              </Button>
              <Button type="button" variant="secondary" onClick={closeSheet}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}
