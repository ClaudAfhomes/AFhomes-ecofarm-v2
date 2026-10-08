import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
  Button,
  ErrorState,
  PageHeader,
  StatusChip,
  notifySuccess,
  notifyError,
} from '@afhomes/ui';
import { documentConfirmSchema } from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { confirmDocument, getDocument, getDocumentAccessUrl, runDocumentOcr } from './services';

/**
 * Human review for one identity document.
 *
 * Three visually distinct states, enforced by the layout, not just copy:
 *
 * - OCR SUGGESTION: read-only values with confidence, shown first.
 * - WORKING COPY: editable inputs prefilled from the suggestions.
 * - CONFIRMED: the saved record, shown after an explicit decision.
 *
 * Nothing here writes to a customer or application record. Confirmation
 * records the reviewer's decision on the document only; onboarding forms
 * remain the place where identity becomes authoritative.
 */
export function DocumentReviewPage() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const doc = useQuery({ queryKey: ['documents', id], queryFn: () => getDocument(id) });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [notes, setNotes] = useState('');

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['documents', id] });
    void client.invalidateQueries({ queryKey: ['documents'] });
  };

  const ocr = useMutation({
    mutationFn: () => runDocumentOcr(id, true),
    onSuccess: (next) => {
      client.setQueryData(['documents', id], next);
      refresh();
    },
    onError: (cause) =>
      notifyError({
        title: 'Extraction failed',
        message: cause instanceof Error ? cause.message : 'OCR failed.',
      }),
  });

  const preview = useQuery({
    queryKey: ['documents', id, 'access-url', doc.data?.uploadedAt],
    queryFn: () => getDocumentAccessUrl(id),
    enabled: doc.isSuccess,
    staleTime: 45_000,
  });

  const decide = useMutation({
    mutationFn: (decision: 'confirmed' | 'rejected') => {
      const payload = {
        decision,
        fields: Object.fromEntries(
          Object.entries(draft ?? {}).map(([key, value]) => [
            key,
            value.trim() === '' ? null : value,
          ]),
        ),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      if (!documentConfirmSchema.safeParse(payload).success)
        throw new Error(
          'Add at least one reviewed field, such as idType, and keep reviewer notes within 500 characters.',
        );
      return confirmDocument(id, payload);
    },
    onSuccess: (next) => {
      client.setQueryData(['documents', id], next);
      notifySuccess({
        title: 'Review saved',
        message:
          next.verificationStatus === 'confirmed'
            ? `Confirmed${next.possibleDuplicate ? ' — flagged as a possible duplicate, not rejected.' : '.'}`
            : 'Rejected.',
      });
      setDraft(null);
      refresh();
    },
    onError: (cause) =>
      notifyError({
        title: 'Review could not be saved',
        message: cause instanceof Error ? cause.message : 'Review failed.',
      }),
  });

  if (doc.isPending) return <p role="status">Loading document…</p>;
  if (doc.isError) return <ErrorState error={doc.error} onRetry={doc.refetch} />;
  const data = doc.data;
  const suggestions = data.extractedFields;
  const working: Record<string, string> =
    draft ??
    Object.fromEntries(Object.entries(suggestions).map(([key, field]) => [key, field.value ?? '']));

  const startReview = () => {
    setDraft(
      Object.fromEntries([
        ...Object.entries(suggestions).map(([key, field]) => [key, field.value ?? '']),
        ...(data.reviewedFields?.idType ? [['idType', data.reviewedFields.idType]] : []),
      ]),
    );
  };

  const isPdf = data.mime === 'application/pdf';

  return (
    <section>
      <PageHeader title={data.originalFilename} description="Identity document review" />
      <p>
        <Link to="/admin/documents">← Back to documents</Link>
      </p>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <div>
          <dt>OCR</dt>
          <dd>
            <StatusChip
              label={data.ocrStatus.replace(/_/g, ' ')}
              tone={data.ocrStatus === 'completed' ? 'success' : 'neutral'}
            />
          </dd>
        </div>
        <div>
          <dt>Verification</dt>
          <dd>
            <StatusChip
              label={data.verificationStatus.replace(/_/g, ' ')}
              tone={data.verificationStatus === 'confirmed' ? 'success' : 'neutral'}
            />
          </dd>
        </div>
        <div>
          <dt>Current ID</dt>
          <dd>
            {data.isCurrent === true && data.verificationStatus !== 'rejected'
              ? 'Yes — current ID for this subject'
              : 'No — retained record'}
          </dd>
        </div>
        <div>
          <dt>Uploaded</dt>
          <dd>{formatDateTime(data.uploadedAt)}</dd>
        </div>
        {data.reviewedAt ? (
          <div>
            <dt>Reviewed</dt>
            <dd>{formatDateTime(data.reviewedAt)}</dd>
          </div>
        ) : null}
      </dl>

      <h2>Scan preview</h2>
      {preview.isPending ? (
        <p role="status">Preparing a short-lived preview…</p>
      ) : preview.isError ? (
        <p role="alert">The preview is unavailable right now. The metadata below is unaffected.</p>
      ) : isPdf ? (
        <p>
          <a href={preview.data.url} target="_blank" rel="noreferrer">
            Open the PDF in a new tab (link expires shortly)
          </a>
        </p>
      ) : (
        <img
          src={preview.data.url}
          alt={`Scan of ${data.originalFilename}`}
          style={{
            maxWidth: '100%',
            maxHeight: 480,
            border: '1px solid var(--color-border-default)',
          }}
        />
      )}

      <h2>OCR suggestions (not authoritative)</h2>
      {data.ocrStatus === 'unavailable' ? (
        <p>
          OCR is not configured, so continue with manual entry below. Onboarding never blocks on
          extraction.
        </p>
      ) : null}
      {Object.keys(suggestions).length === 0 ? (
        <p>No fields were extracted. Enter the values manually below.</p>
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Suggested value</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(suggestions).map(([key, field]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{field.value ?? '—'}</td>
                  <td>
                    {field.confidence === null
                      ? 'unknown'
                      : field.confidence < 0.6
                        ? `low (${field.confidence.toFixed(2)})`
                        : field.confidence.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.warnings.length > 0 ? (
        <p role="note">Extraction notes: {data.warnings.join(', ').replace(/_/g, ' ')}.</p>
      ) : null}
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <Button variant="secondary" onClick={() => ocr.mutate()} disabled={ocr.isPending}>
          {ocr.isPending ? 'Extracting…' : 'Re-run extraction'}
        </Button>
        {draft === null ? (
          <Button variant="secondary" onClick={startReview}>
            Review and edit
          </Button>
        ) : null}
      </div>

      {draft !== null ? (
        <div style={{ marginTop: 24, maxWidth: 640 }}>
          <h2>Working copy (your edits)</h2>
          {Object.keys(working).length === 0 ? (
            <p>No suggested fields — add the values manually:</p>
          ) : null}
          <WorkingCopyFields working={working} onChange={setDraft} />
          <label>
            Reviewer notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ width: '100%' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <Button
              onClick={() => {
                decide.mutate('confirmed');
              }}
              disabled={decide.isPending}
            >
              {decide.isPending ? 'Saving…' : 'Confirm reviewed values'}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                decide.mutate('rejected');
              }}
              disabled={decide.isPending}
            >
              Reject document
            </Button>
          </div>
        </div>
      ) : null}

      {data.reviewedFields ? (
        <div style={{ marginTop: 24 }}>
          <h2>Confirmed record</h2>
          <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Confirmed value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.reviewedFields).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{value ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkingCopyFields({
  working,
  onChange,
}: {
  working: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState('');
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {Object.entries(working).map(([key, value]) => (
        <label key={key} style={{ display: 'grid', gap: 4 }}>
          {key} (editable copy — the suggestion above is unchanged)
          <input value={value} onChange={(e) => onChange({ ...working, [key]: e.target.value })} />
        </label>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label>
          Add a field
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="middleName"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            const key = newKey.trim();
            if (key && !(key in working)) onChange({ ...working, [key]: '' });
            setNewKey('');
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
