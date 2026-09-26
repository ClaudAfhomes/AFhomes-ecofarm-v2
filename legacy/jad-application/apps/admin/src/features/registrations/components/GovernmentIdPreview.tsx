import { useEffect, useRef, useState } from 'react';

import { Button, Dialog, Skeleton } from '@jad/ui';

import { getGovernmentIdUrl } from '../repositories/registrationRepository';

type Props = {
  registrationId: string;
  fileName: string;
  mimeType: string;
  /** False for rows captured before file upload (metadata only). */
  hasFile: boolean;
};

/**
 * Government ID preview - shared by the registration detail page and the
 * member application card. Fetches the short-lived signed URL lazily on
 * open; images render inline, PDFs embed, anything else links out.
 */
export function GovernmentIdPreview({ registrationId, fileName, mimeType, hasFile }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const startedRef = useRef(false);

  const close = () => {
    setOpen(false);
    setUrl(null);
    setError(undefined);
    setPending(false);
    startedRef.current = false;
  };

  const retry = () => {
    setError(undefined);
    setUrl(null);
    startedRef.current = false;
    setNonce((n) => n + 1);
  };

  // Signed URLs live ~60s - fetch lazily on open. The started ref (not
  // state) guards re-entry: a state flag would rerender, run cleanup, and
  // cancel its own fetch.
  useEffect(() => {
    if (!open || !hasFile || startedRef.current) return;
    startedRef.current = true;
    setPending(true);
    setError(undefined);
    getGovernmentIdUrl(registrationId)
      .then((signedUrl) => {
        setUrl(signedUrl);
      })
      .catch((e: unknown) => {
        setError((e as Error).message || 'Could not load the document.');
      })
      .finally(() => {
        setPending(false);
      });
  }, [open, nonce, hasFile, registrationId]);

  if (!hasFile) {
    return (
      <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
        No file on record - only metadata was captured for this application.
      </span>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setError(undefined);
          setUrl(null);
          setOpen(true);
        }}
      >
        Preview
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Government ID ${fileName}`.trim()}
        footer={
          url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open in new tab
            </a>
          ) : undefined
        }
      >
        {pending || (!url && !error) ? (
          <Skeleton style={{ height: 320 }} />
        ) : error || !url ? (
          <div>
            <p role="alert" style={{ color: 'var(--color-danger)', margin: '0 0 12px' }}>
              {error ?? 'Could not load the document.'}
            </p>
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : mimeType.startsWith('image/') ? (
          <img
            src={url}
            alt={`Government ID ${fileName}`}
            style={{
              maxWidth: '100%',
              maxHeight: '70vh',
              objectFit: 'contain',
              display: 'block',
              margin: '0 auto',
            }}
          />
        ) : mimeType === 'application/pdf' ? (
          <iframe
            title={`Government ID ${fileName}`}
            src={url}
            style={{
              width: '100%',
              height: '70vh',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
            }}
          />
        ) : (
          <p style={{ margin: 0 }}>
            Preview isn&apos;t available for this file type ({mimeType}).{' '}
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open in new tab
            </a>{' '}
            instead.
          </p>
        )}
      </Dialog>
    </>
  );
}
