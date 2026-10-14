import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Button,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  TextAreaField,
  TextField,
  notifySuccess,
  notifyError,
} from '@afhomes/ui';
import { documentConfirmSchema } from '@afhomes/contracts';

import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { formatDateTime } from '../../lib/format';
import { humanizeCode } from '../business/format';
import { documentKeys } from '../business/queryKeys';
import { confirmDocument, getDocument, getDocumentAccessUrl, runDocumentOcr } from './services';
import styles from './DocumentReviewPage.module.css';

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
  const doc = useQuery({
    queryKey: documentKeys.detail(id),
    queryFn: () => getDocument(id),
    // A confirmed review updates this view in place without blanking it.
    placeholderData: keepPreviousData,
  });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [notes, setNotes] = useState('');

  const refresh = () => {
    void client.invalidateQueries({ queryKey: documentKeys.detail(id) });
    void client.invalidateQueries({ queryKey: documentKeys.scope });
  };

  const ocr = useBusinessMutation({
    mutationFn: () => runDocumentOcr(id, true),
    onSuccess: (next) => {
      client.setQueryData(documentKeys.detail(id), next);
      refresh();
    },
    onError: (cause) =>
      notifyError({
        title: 'Extraction failed',
        message: cause instanceof Error ? cause.message : 'OCR failed.',
      }),
  });

  const preview = useQuery({
    queryKey: documentKeys.accessUrl(id, doc.data?.uploadedAt),
    queryFn: () => getDocumentAccessUrl(id),
    enabled: doc.isSuccess,
    placeholderData: keepPreviousData,
    staleTime: 45_000,
  });

  const decide = useBusinessMutation({
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
      client.setQueryData(documentKeys.detail(id), next);
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

  // First load skeletonizes the whole page so no static content flashes
  // before the document it describes. Refetches keep the review visible and
  // never reach this branch. The sr-only line keeps the exact pending copy.
  if (doc.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading document"
        >
          <span className="sr-only">Loading document…</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 320 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 200 }} />
            <Skeleton style={{ height: 160 }} />
          </div>
        </div>
      </section>
    );
  if (doc.isError)
    return (
      <section className={styles.page}>
        <PageHeader
          title="Document Review"
          description="The requested document could not be opened."
          actions={
            <Button variant="secondary" onClick={() => window.history.back()}>
              Back to documents
            </Button>
          }
        />
        <ErrorState
          error={doc.error}
          title="Document could not be loaded"
          message={describeDocumentLoadError(doc.error)}
          onRetry={() => void doc.refetch()}
        />
      </section>
    );
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
    <section className={styles.page}>
      <PageHeader title="Document Review" description={data.originalFilename} />
      <p className={styles.backRow}>
        <Link to="/admin/documents">← Back to documents</Link>
      </p>

      <section className={styles.panel} aria-label="Document status">
        <dl className={styles.facts}>
          <div>
            <dt>OCR</dt>
            <dd>
              <StatusChip label={humanizeCode(data.ocrStatus)} />
            </dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>
              <StatusChip label={humanizeCode(data.verificationStatus)} />
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
      </section>

      <section className={styles.panel} aria-label="Scan preview">
        <h2 className={styles.panelTitle}>Scan preview</h2>
        {preview.isPending ? (
          <p role="status">
            <Skeleton style={{ height: 120 }} />
            <span className="sr-only">Preparing a short-lived preview…</span>
          </p>
        ) : preview.isError ? (
          <Alert variant="warning" title="Preview unavailable">
            The preview is unavailable right now. The metadata below is unaffected.
          </Alert>
        ) : isPdf ? (
          <p>
            <a href={preview.data.url} target="_blank" rel="noreferrer">
              Open the PDF in a new tab (link expires shortly)
            </a>
          </p>
        ) : (
          <img
            className={styles.preview}
            src={preview.data.url}
            alt={`Scan of ${data.originalFilename}`}
          />
        )}
      </section>

      <section className={styles.panel} aria-label="OCR suggestions">
        <h2 className={styles.panelTitle}>OCR suggestions (not authoritative)</h2>
        {data.ocrStatus === 'unavailable' ? (
          <Alert variant="info" title="Manual entry">
            OCR is not configured, so continue with manual entry below. Onboarding never blocks on
            extraction.
          </Alert>
        ) : null}
        {Object.keys(suggestions).length === 0 ? (
          <p className={styles.panelNote}>
            No fields were extracted. Enter the values manually below.
          </p>
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
                  <th>Field</th>
                  <th>Suggested value</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(suggestions).map(([key, field]) => (
                  <tr key={key}>
                    <td data-label="Field">{key}</td>
                    <td data-label="Suggested value">{field.value ?? '—'}</td>
                    <td data-label="Confidence">
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
          <p role="note" className={styles.panelNote}>
            Extraction notes: {data.warnings.join(', ').replace(/_/g, ' ')}.
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => ocr.mutate()} disabled={ocr.isPending}>
            {ocr.isPending ? 'Extracting…' : 'Re-run extraction'}
          </Button>
          {draft === null ? (
            <Button variant="secondary" onClick={startReview}>
              Review and edit
            </Button>
          ) : null}
        </div>
      </section>

      {draft !== null ? (
        <section className={styles.panel} aria-label="Working copy">
          <h2 className={styles.panelTitle}>Working copy (your edits)</h2>
          {Object.keys(working).length === 0 ? (
            <p className={styles.panelNote}>No suggested fields — add the values manually:</p>
          ) : null}
          <div className={styles.workingCopy}>
            <WorkingCopyFields working={working} onChange={setDraft} />
            <TextAreaField
              id="document-reviewer-notes"
              name="reviewerNotes"
              label="Reviewer notes"
              optional
              value={notes}
              onChange={setNotes}
              rows={2}
            />
            <div className={styles.actions}>
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
        </section>
      ) : null}

      {data.reviewedFields ? (
        <section className={styles.panel} aria-label="Confirmed record">
          <h2 className={styles.panelTitle}>Confirmed record</h2>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
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
                    <td data-label="Field">{key}</td>
                    <td data-label="Confirmed value">{value ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}

/**
 * Actionable document-load guidance per failure cause. Raw server internals
 * are never rendered (see `ErrorState`); each branch names the next step
 * instead. Returns `undefined` for unknown errors so the shared generic
 * message applies.
 */
function describeDocumentLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open documents right now. Contact an administrator.';
  if (error instanceof ApiError && error.status === 404)
    return 'No document exists at this link. Check the address, or open the record from the documents list.';
  if (error instanceof ApiParseError)
    return 'The saved record contains values this screen cannot display. Note the file name and ask an administrator to review the record.';
  return undefined;
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
        <TextField
          key={key}
          id={`working-copy-${key}`}
          name={key}
          label={`${key} (editable copy — the suggestion above is unchanged)`}
          optional
          value={value}
          onChange={(next) => onChange({ ...working, [key]: next })}
        />
      ))}
      <div className={styles.addFieldRow}>
        <TextField
          id="working-copy-new-key"
          name="newKey"
          label="Add a field"
          optional
          value={newKey}
          onChange={setNewKey}
          placeholder="middleName"
        />
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
