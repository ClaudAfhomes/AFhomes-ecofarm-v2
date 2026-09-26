import { useCallback, useId, useRef, useState } from 'react';

import { Button, Icon } from '@jad/ui';
import { getSupabaseClient } from '../../../lib/supabase';

import { CmsTextField } from './CmsFields';
import styles from './CmsImageField.module.css';
import type { CmsPhoto } from '@jad/contracts';

function photoUrl(id: string, w: number): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
}

function isBlobId(id: string): boolean {
  return id.startsWith('blob:') || id.startsWith('local:');
}

function isDirectSrc(id: string): boolean {
  return (
    id.startsWith('blob:') ||
    id.startsWith('data:') ||
    id.startsWith('http:') ||
    id.startsWith('https:')
  );
}

function resolveImageSrc(id: string, w: number): string | null {
  if (!id) return null;
  if (isBlobId(id) || isDirectSrc(id)) return id;
  return photoUrl(id, w);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? `.${parts.pop()}` : '';
}

export function CmsImageField({
  label,
  value,
  onChange,
  errorId,
  errorAlt,
  note = 'JPG, PNG or WebP · Max 20 MB · 1200 px wide recommended',
}: {
  label: string;
  value: CmsPhoto;
  onChange: (next: CmsPhoto) => void;
  errorId?: string;
  errorAlt?: string;
  note?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastObjectUrlRef = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{
    name: string;
    sizeLabel: string;
    dimensions?: string;
  } | null>(null);

  const displaySrc = resolveImageSrc(value.id, 400);
  const hasImage = Boolean(displaySrc);
  const ids = useId();
  const hintId = `${ids}-hint`;
  const [imgError, setImgError] = useState(false);

  const revokeLastObjectUrl = useCallback(() => {
    if (lastObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(lastObjectUrlRef.current);
      } catch {
        /* ignore revoke failure - URL may already be revoked */
      }
      lastObjectUrlRef.current = null;
    }
  }, []);

  const validateAndSetFile = useCallback(
    async (file: File) => {
      setFileError(null);
      setFileWarning(null);

      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
      const typeOk = file.type
        ? validTypes.includes(file.type)
        : validExts.includes(getExtension(file.name));
      if (!typeOk) {
        setFileError('Only JPG, PNG and WebP images are allowed.');
        return;
      }
      const maxSize = 20 * 1024 * 1024;
      if (file.size > maxSize) {
        setFileError('Image must be 20 MB or less.');
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      const { width, height, ok } = await new Promise<{
        width: number;
        height: number;
        ok: boolean;
      }>((resolve) => {
        img.onload = () => resolve({ width: img.width, height: img.height, ok: img.width >= 1200 });
        img.onerror = () => resolve({ width: 0, height: 0, ok: true });
        img.src = objectUrl;
      });

      if (!ok) {
        setFileWarning('For best quality, use an image at least 1200 px wide.');
      }

      // Direct browser-to-Supabase Storage upload via signed URL (bypasses Vercel 4.5 MB limit, supports 20 MB)
      let uploadError: string | null = null;
      let finalId: string | null = null;
      try {
        const supabase = getSupabaseClient();
        let token: string | undefined;
        try {
          const sess = await supabase?.auth.getSession();
          token = sess?.data?.session?.access_token ?? undefined;
        } catch {
          /* ignore auth session fetch failure - proceed without token */
        }
        // Request signed upload URL from Vercel (verified admin via service_role, no file data)
        const signRes = await fetch('/api/v1/cms/upload/sign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
        });
        if (!signRes.ok) {
          let msg = 'Upload failed - please try again.';
          try {
            const errJson = (await signRes.json()) as {
              error?: { code?: string; message?: string };
            };
            const code = errJson?.error?.code;
            const serverMsg = errJson?.error?.message;
            if (code === 'UNAUTHORIZED') msg = 'Please sign in again to upload images.';
            else if (code === 'FORBIDDEN') msg = 'You do not have permission to upload images.';
            else if (code === 'VALIDATION_ERROR' && serverMsg) msg = serverMsg;
            else if (signRes.status >= 500)
              msg = 'Upload failed due to a server issue - please try again.';
          } catch {
            if (signRes.status === 401) msg = 'Please sign in again to upload images.';
            else if (signRes.status === 403) msg = 'You do not have permission to upload images.';
            else if (signRes.status === 413) msg = 'Image must be 20 MB or less.';
          }
          uploadError = msg;
        } else {
          const signJson = (await signRes.json()) as {
            signedUrl: string;
            publicUrl: string;
            path: string;
          };
          const signedUrl = signJson.signedUrl;
          const publicUrl = signJson.publicUrl;
          if (!signedUrl || !publicUrl) {
            uploadError = 'Upload failed - please try again.';
          } else {
            // Direct PUT to Supabase Storage (bypasses Vercel, supports 20 MB)
            const putRes = await fetch(signedUrl, {
              method: 'PUT',
              headers: { 'Content-Type': file.type },
              body: file,
            });
            if (!putRes.ok) {
              let msg = 'Upload failed - please try again.';
              try {
                const txt = await putRes.text();
                if (putRes.status === 413) msg = 'Image must be 20 MB or less.';
                else if (txt) msg = txt.slice(0, 200);
              } catch {
                /* ignore putRes text read failure */
              }
              uploadError = msg;
            } else {
              finalId = publicUrl;
              try {
                URL.revokeObjectURL(objectUrl);
              } catch {
                /* ignore revoke failure for uploaded objectUrl */
              }
            }
          }
        }
      } catch {
        uploadError = 'Upload failed - please check your connection and try again.';
      }
      if (uploadError) {
        setFileError(uploadError);
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore revoke failure */
        }
        return;
      }
      // Success: update draft with persistent public URL
      lastObjectUrlRef.current = null;
      setFileMeta({
        name: file.name,
        sizeLabel: formatBytes(file.size),
        dimensions: width && height ? `${width}×${height}` : undefined,
      });
      onChange({ id: finalId!, alt: value.alt });
    },
    [onChange, value.alt],
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void validateAndSetFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void validateAndSetFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const onRemove = () => {
    // Revoke object URL if current value is the last created local URL
    if (lastObjectUrlRef.current && value.id === lastObjectUrlRef.current) {
      revokeLastObjectUrl();
    } else if (isBlobId(value.id)) {
      // Fallback: value is blob but not tracked (e.g., restored from storage after refresh - already revoked)
      try {
        URL.revokeObjectURL(value.id);
      } catch {
        /* ignore revoke failure - blob may already be revoked */
      }
    }
    setFileError(null);
    setFileWarning(null);
    setFileMeta(null);
    setImgError(false);
    onChange({ id: '', alt: '' });
  };

  const onReplaceClick = () => inputRef.current?.click();

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.stack}>
        <div className={styles.media}>
          {hasImage && displaySrc ? (
            <div
              className={`${styles.previewWrap} ${dragOver ? styles.previewWrapOver : ''}`}
              data-testid="image-dropzone"
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDragEnter={onDragOver}
            >
              <img
                className={styles.previewImg}
                src={displaySrc}
                alt={value.alt || ''}
                loading="lazy"
                onError={(e) => {
                  setImgError(true);
                  (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
                }}
              />
              <div className={styles.dropOverlay} aria-hidden>
                <span className={styles.dropText}>Drop image to replace</span>
              </div>
            </div>
          ) : (
            <div
              className={`${styles.dropZone} ${dragOver ? styles.dropZoneOver : ''} ${styles.dropZoneEmpty}`}
              data-testid="image-dropzone"
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDragEnter={onDragOver}
            >
              <div className={styles.emptyState}>
                <p className={styles.emptyTitle}>No image: upload to publish</p>
                <p className={styles.emptyHint}>Drag and drop an image here, or click to browse</p>
              </div>
              <div className={styles.dropOverlay} aria-hidden>
                <span className={styles.dropText}>Drop image to upload</span>
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onFileChange}
              style={{ display: 'none' }}
              aria-hidden
              tabIndex={-1}
            />
            <Button variant="secondary" onClick={onReplaceClick}>
              <Icon name={hasImage ? 'pencil' : 'plus'} size={16} />
              {hasImage ? 'Replace' : 'Upload'}
            </Button>
            {hasImage ? (
              <Button variant="danger" onClick={onRemove}>
                <Icon name="trash" size={16} /> Remove
              </Button>
            ) : null}
          </div>

          <p id={hintId} className={styles.note}>
            {note}
          </p>

          {fileMeta && hasImage ? (
            <span className={styles.fileMeta}>
              {fileMeta.name} · {fileMeta.sizeLabel}
              {fileMeta.dimensions ? ` · ${fileMeta.dimensions}` : ''}
            </span>
          ) : null}
          {fileError ? (
            <span role="alert" className={styles.error}>
              {fileError}
            </span>
          ) : null}
          {imgError ? (
            <span role="alert" className={styles.error}>
              This image could not be loaded. Check the source or upload a new file.
            </span>
          ) : null}
          {fileWarning ? (
            <span role="status" className={styles.warning}>
              {fileWarning}
            </span>
          ) : null}
          {errorId ? (
            <span role="alert" className={styles.error}>
              {errorId}
            </span>
          ) : null}
        </div>

        <CmsTextField
          label="Alt text"
          hint="Describe the image for accessibility"
          value={value.alt}
          error={errorAlt}
          onChange={(alt) => onChange({ ...value, alt })}
          maxLength={120}
          placeholder="A modern residence at dusk"
        />
      </div>
    </fieldset>
  );
}
