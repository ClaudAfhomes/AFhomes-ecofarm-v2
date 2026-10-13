import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  FileField,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { formatDateTime } from '../../lib/format';
import { humanizeCode } from '../business/format';
import { documentKeys } from '../business/queryKeys';
import {
  ACCEPTED_MIME,
  MAX_BYTES,
  getDocuments,
  completeDocumentUpload,
  putUploadBytes,
  requestUploadGrant,
  runDocumentOcr,
} from './services';
import styles from './DocumentsPage.module.css';

/**
 * Identity document intake and review queue.
 *
 * Upload here never finalizes anything: the file lands in a private bucket,
 * OCR (when configured) produces suggestions only, and a human reviews and
 * confirms on the detail screen. Without OCR the same screen is a manual
 * entry workflow - onboarding never blocks on extraction.
 */
export function DocumentsPage() {
  const client = useQueryClient();
  const [subjectType, setSubjectType] = useState<'customer' | 'ost_application'>('customer');
  const [subjectId, setSubjectId] = useState('');
  const [appliedId, setAppliedId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  const docs = useQuery({
    queryKey: documentKeys.list(subjectType, appliedId),
    queryFn: () =>
      getDocuments(appliedId ? { subjectType, subjectId: appliedId } : { subjectType }),
    // The list stays on screen while a subject change or a background refresh
    // reloads; only the very first load skeletonizes the page.
    placeholderData: keepPreviousData,
  });

  const upload = useBusinessMutation({
    mutationFn: async () => {
      setError(null);
      setUploadedId(null);
      if (!file) throw new Error('Choose a file first.');
      if (!ACCEPTED_MIME.includes(file.type as (typeof ACCEPTED_MIME)[number])) {
        throw new Error('Only JPEG, PNG or PDF files are accepted.');
      }
      if (file.size === 0 || file.size > MAX_BYTES) {
        throw new Error('The file must be non-empty and at most 10 MiB.');
      }
      if (!appliedId) throw new Error('Enter the customer or application ID first.');
      const grant = await requestUploadGrant({
        subjectType,
        subjectId: appliedId,
        mime: file.type as (typeof ACCEPTED_MIME)[number],
        sizeBytes: file.size,
        originalFilename: file.name.slice(0, 255),
      });
      await putUploadBytes(grant.uploadUrl, file);
      await completeDocumentUpload(grant.documentId);
      return grant.documentId;
    },
    onSuccess: (documentId) => {
      setUploadedId(documentId);
      setFile(null);
      void client.invalidateQueries({ queryKey: documentKeys.scope });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Upload failed.'),
  });

  const ocr = useBusinessMutation({
    mutationFn: (id: string) => runDocumentOcr(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: documentKeys.scope });
    },
  });

  // First load skeletonizes the whole page so no static content flashes
  // before the list it describes. Refetches keep the list visible and never
  // reach this branch. The sr-only line keeps the exact pending copy.
  if (docs.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading documents"
        >
          <span className="sr-only">Loading documents…</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 480 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="ID Documents"
        description="Upload identity scans to private storage, extract suggestions with OCR where available, and confirm them by human review."
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedId(subjectId.trim());
        }}
      >
        <FilterBar
          filters={
            <Select
              aria-label="Records for"
              value={subjectType}
              onChange={(e) => {
                setSubjectType(e.target.value as 'customer' | 'ost_application');
                setAppliedId('');
                setSubjectId('');
              }}
              options={[
                { value: 'customer', label: 'Customer' },
                { value: 'ost_application', label: 'OST application' },
              ]}
            />
          }
          search={
            <SearchField
              label={subjectType === 'customer' ? 'Customer ID' : 'Application ID'}
              placeholder="UUID of the record"
              value={subjectId}
              onChange={setSubjectId}
              busy={docs.isFetching}
            />
          }
          actions={
            <Button type="submit" variant="secondary">
              Show
            </Button>
          }
        />
      </form>

      <div className={styles.uploadPanel}>
        <FileField
          id="document-scan"
          name="scan"
          label="Scan to upload (JPEG, PNG or PDF, max 10 MiB)"
          optional
          accept={ACCEPTED_MIME.join(',')}
          onSelect={(file) => setFile(file)}
        />
        <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
          {upload.isPending ? 'Uploading…' : 'Upload scan'}
        </Button>
      </div>
      {error ? (
        <Alert variant="danger" title="Upload failed">
          {error}
        </Alert>
      ) : null}
      {uploadedId ? (
        <p role="status" className={styles.statusLine}>
          Uploaded. <Link to={`/admin/documents/${uploadedId}`}>Review it now</Link> — nothing is
          final until a human confirms it.
        </p>
      ) : null}

      {docs.isError ? (
        <ErrorState
          error={docs.error}
          title="Documents could not be loaded"
          message={describeDocumentsLoadError(docs.error)}
          onRetry={() => void docs.refetch()}
        />
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState
          title="No documents"
          description="Upload a scan above, or pick a different record."
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>OCR</th>
                <th>Verification</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(docs.data ?? []).map((doc) => (
                <tr key={doc.id}>
                  <td data-label="File" className={styles.fileCell}>
                    {doc.originalFilename}
                  </td>
                  <td data-label="OCR">
                    <StatusChip label={humanizeCode(doc.ocrStatus)} />
                  </td>
                  <td data-label="Verification">
                    <StatusChip label={humanizeCode(doc.verificationStatus)} />
                  </td>
                  <td data-label="Uploaded">{formatDateTime(doc.uploadedAt)}</td>
                  <td data-label="Actions">
                    <span className={styles.rowActions}>
                      <Link to={`/admin/documents/${doc.id}`}>Review</Link>
                      {doc.ocrStatus !== 'completed' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={ocr.isPending}
                          onClick={() => ocr.mutate(doc.id)}
                        >
                          Run OCR
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ocr.isError ? (
        <Alert variant="danger" title="Extraction could not start">
          {ocr.error instanceof Error ? ocr.error.message : 'OCR failed.'}
        </Alert>
      ) : null}
    </section>
  );
}

/**
 * Actionable list-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeDocumentsLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open documents right now. Contact an administrator.';
  return undefined;
}
