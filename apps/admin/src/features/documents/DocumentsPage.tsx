import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  StatusChip,
} from '@afhomes/ui';

import { formatDateTime } from '../../lib/format';
import {
  ACCEPTED_MIME,
  MAX_BYTES,
  getDocuments,
  completeDocumentUpload,
  putUploadBytes,
  requestUploadGrant,
  runDocumentOcr,
} from './services';

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
    queryKey: ['documents', subjectType, appliedId],
    queryFn: () =>
      getDocuments(appliedId ? { subjectType, subjectId: appliedId } : { subjectType }),
  });

  const upload = useMutation({
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
      void client.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Upload failed.'),
  });

  const ocr = useMutation({
    mutationFn: (id: string) => runDocumentOcr(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  return (
    <section>
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
            />
          }
          actions={
            <Button type="submit" variant="secondary">
              Show
            </Button>
          }
        />
      </form>

      <div
        style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label>
          Scan to upload (JPEG, PNG or PDF, max 10 MiB)
          <input
            type="file"
            accept={ACCEPTED_MIME.join(',')}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
          {upload.isPending ? 'Uploading…' : 'Upload scan'}
        </Button>
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {uploadedId ? (
        <p role="status">
          Uploaded. <Link to={`/admin/documents/${uploadedId}`}>Review it now</Link> — nothing is
          final until a human confirms it.
        </p>
      ) : null}

      {docs.isPending ? (
        <p role="status">Loading documents…</p>
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={docs.refetch} />
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState
          title="No documents"
          description="Upload a scan above, or pick a different record."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>OCR</th>
                <th>Verification</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(docs.data ?? []).map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.originalFilename}</td>
                  <td>
                    <StatusChip
                      label={doc.ocrStatus.replace(/_/g, ' ')}
                      tone={doc.ocrStatus === 'completed' ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>
                    <StatusChip
                      label={doc.verificationStatus.replace(/_/g, ' ')}
                      tone={doc.verificationStatus === 'confirmed' ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>{formatDateTime(doc.uploadedAt)}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
