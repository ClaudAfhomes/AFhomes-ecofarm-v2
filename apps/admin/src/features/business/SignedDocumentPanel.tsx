import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  REJECTION_REASON_MIN_LENGTH,
  SIGNED_DOCUMENT_CONTENT_TYPES,
  SIGNED_DOCUMENT_MAX_BYTES,
  signedDocumentUploadRequestSchema,
  type SignedDocument,
} from '@afhomes/contracts';
import { Button, TextField } from '@afhomes/ui';
import { putUploadBytes } from '../documents/services';
import {
  getSignedDocumentDownload,
  listSignedDocuments,
  registerSignedDocument,
  requestSignedDocumentUpload,
  reviewSignedDocument,
  sha256Hex,
  type SignedDocumentOwner,
} from './services-signed-documents';
import styles from './OfficialFormsPages.module.css';

/** A failure that names the step, so a retry knows where it stopped. */
export class SignedDocumentStepError extends Error {
  constructor(step: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'it did not complete';
    super(
      `Signed document step failed (${step}): ${detail} Earlier steps are kept; press the button again to retry.`,
    );
  }
}

const LABEL: Record<SignedDocumentOwner, string> = {
  applications: 'signed Customer Application',
  reservations: 'signed Reservation Agreement',
};

export function useSignedDocument(owner: SignedDocumentOwner, id: string | undefined, enabled = true) {
  const docs = useQuery({
    queryKey: ['signed-documents', owner, id],
    queryFn: () => listSignedDocuments(owner, id!),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
  const [fileState, setFileState] = useState<{ file: File | null; url: string }>({
    file: null,
    url: '',
  });
  const file = fileState.file;
  // The preview URL is made in the handler that swaps the file (never in an effect).
  const urlRef = useRef('');
  const setFile = (next: File | null) => {
    if (urlRef.current) URL.revokeObjectURL?.(urlRef.current);
    const url = next && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(next) : '';
    urlRef.current = url;
    setFileState({ file: next, url });
  };
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL?.(urlRef.current);
    },
    [],
  );
  const [fileError, setFileError] = useState('');
  // The document this action already registered: a retry reuses it, never uploads twice.
  const registeredId = useRef<string | null>(null);
  const live = docs.data?.find((d) => d.status === 'accepted' || d.status === 'pending_review');
  const ready = Boolean(file) || Boolean(live);

  const pick = (next: File | undefined) => {
    if (!next) return;
    const check = signedDocumentUploadRequestSchema.safeParse({
      contentType: next.type,
      byteSize: next.size,
    });
    if (!check.success) {
      setFile(null);
      setFileError(
        !(SIGNED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(next.type)
          ? 'The signed document must be a PDF, JPEG or PNG file.'
          : `The signed document must be larger than 0 bytes and at most ${Math.floor(SIGNED_DOCUMENT_MAX_BYTES / 1048576)} MB.`,
      );
      return;
    }
    setFileError('');
    registeredId.current = null;
    setFile(next);
  };

  /**
   * Make sure an ACCEPTED signed document exists: upload + register a picked
   * file, then accept the pending one. Each step is idempotent on retry.
   */
  const ensureAccepted = async (): Promise<void> => {
    if (!id) throw new Error('Save the record before reviewing its signed document.');
    let list: SignedDocument[];
    try {
      list = (await docs.refetch()).data ?? [];
    } catch (error) {
      throw new SignedDocumentStepError('loading the document status', error);
    }
    if (list.some((d) => d.status === 'accepted')) return;
    let pendingId = registeredId.current ?? list.find((d) => d.status === 'pending_review')?.id ?? null;
    if (file && !registeredId.current) {
      try {
        const grant = await requestSignedDocumentUpload(owner, id, {
          contentType: file.type,
          byteSize: file.size,
        });
        await putUploadBytes(grant.uploadUrl, file);
        const registered = await registerSignedDocument(owner, id, {
          storagePath: grant.storagePath,
          originalFilename: file.name,
          mimeType: file.type as (typeof SIGNED_DOCUMENT_CONTENT_TYPES)[number],
          sizeBytes: file.size,
          sha256: await sha256Hex(file),
        });
        pendingId = registered.id;
        registeredId.current = registered.id;
      } catch (error) {
        throw new SignedDocumentStepError('uploading the document', error);
      }
    }
    if (!pendingId)
      throw new Error(`Upload the ${LABEL[owner]} first; it must be accepted before continuing.`);
    try {
      await reviewSignedDocument(pendingId, { decision: 'accepted' });
    } catch (error) {
      throw new SignedDocumentStepError('accepting the document', error);
    }
    registeredId.current = null;
    setFile(null);
    await docs.refetch();
  };

  const reject = async (reason: string) => {
    const target =
      registeredId.current ?? docs.data?.find((d) => d.status === 'pending_review')?.id;
    if (!target) throw new Error('There is no pending signed document to reject.');
    await reviewSignedDocument(target, { decision: 'rejected', notes: reason.trim() });
    registeredId.current = null;
    setFile(null);
    await docs.refetch();
  };

  const accepted = docs.data?.some((d) => d.status === 'accepted') ?? false;
  return { owner, docs, live, accepted, file, previewUrl: fileState.url, fileError, pick, ready, ensureAccepted, reject };
}
export type SignedDocumentController = ReturnType<typeof useSignedDocument>;

/** Plain reason beside a disabled approve/execute button, or null when it can proceed. */
export const signedDocumentBlocker = (c: SignedDocumentController): string | null =>
  c.ready
    ? null
    : `Upload the ${LABEL[c.owner]} (PDF, JPEG or PNG) before ${c.owner === 'applications' ? 'approving' : 'executing'}.`;

export function SignedDocumentPanel({
  controller,
  disabled,
}: {
  controller: SignedDocumentController;
  disabled?: boolean;
}) {
  const { owner, docs, live, accepted, file, previewUrl, fileError, pick, reject } = controller;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  // An already-uploaded file previews through the 60 s download link.
  const download = useQuery({
    queryKey: ['signed-document-download', live?.id],
    queryFn: () => getSignedDocumentDownload(live!.id),
    enabled: Boolean(live) && !file,
    retry: false,
    staleTime: 30_000,
  });
  const shownUrl = file ? previewUrl : (download.data?.url ?? '');
  const shownType = file ? file.type : (live?.mimeType ?? '');
  const pending = live?.status === 'pending_review';
  const latest = docs.data?.[0];
  return (
    <section className={styles.panel} aria-label={`Signed document: ${LABEL[owner]}`}>
      <h2 className={styles.panelTitle}>Signed document</h2>
      {live ? (
        <p role="status">
          {live.originalFilename} — {live.status === 'accepted' ? 'Accepted' : 'Pending review'}
          {live.uploadedByName ? ` · uploaded by ${live.uploadedByName}` : ''}
          {live.reviewedByName ? ` · reviewed by ${live.reviewedByName}` : ''}
        </p>
      ) : latest?.status === 'rejected' ? (
        <p role="alert">
          The last {LABEL[owner]} was rejected
          {latest.reviewNotes ? `: ${latest.reviewNotes}` : ''}. Upload a replacement.
        </p>
      ) : docs.isSuccess ? (
        <p role="status">No {LABEL[owner]} has been uploaded yet.</p>
      ) : null}
      {!accepted ? (
        <div>
          <label htmlFor={`signed-${owner}`}>
            Signed document file (PDF, JPEG or PNG, max 10 MB)
          </label>
          <input
            id={`signed-${owner}`}
            type="file"
            accept={SIGNED_DOCUMENT_CONTENT_TYPES.join(',')}
            disabled={disabled}
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {fileError ? <p role="alert">{fileError}</p> : null}
          {file ? <p role="status">Selected: {file.name}</p> : null}
        </div>
      ) : null}
      {shownUrl ? (
        shownType === 'application/pdf' ? (
          <>
            <object
              data={shownUrl}
              type="application/pdf"
              aria-label="Signed document preview"
              width="100%"
              height="360"
            />
            <a href={shownUrl} target="_blank" rel="noreferrer">
              Open signed document
            </a>
          </>
        ) : (
          <img
            src={shownUrl}
            alt="Signed document preview"
            style={{ maxWidth: '100%', maxHeight: 360 }}
          />
        )
      ) : null}
      {pending && !file ? (
        <div>
          <Button
            variant="danger"
            size="sm"
            disabled={disabled}
            onClick={() => setRejecting((value) => !value)}
          >
            {rejecting ? 'Cancel' : 'Reject document'}
          </Button>
          {rejecting ? (
            <div>
              <TextField
                id={`signed-reject-${owner}`}
                name="reason"
                label={`Reason (at least ${REJECTION_REASON_MIN_LENGTH} characters)`}
                value={reason}
                onChange={setReason}
              />
              <Button
                variant="danger"
                size="sm"
                disabled={reason.trim().length < REJECTION_REASON_MIN_LENGTH}
                onClick={() => {
                  setError('');
                  reject(reason)
                    .then(() => {
                      setRejecting(false);
                      setReason('');
                    })
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : 'The document was not rejected.'),
                    );
                }}
              >
                Confirm reject document
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
