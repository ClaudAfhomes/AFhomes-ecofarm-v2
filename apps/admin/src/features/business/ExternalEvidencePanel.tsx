import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Select, StatusChip, TextAreaField, TextField } from '@afhomes/ui';
import type {
  ExternalEvidence,
  ExternalEvidenceType,
  ExternalPaymentSubject,
  RecordExternalEvidenceRequest,
} from '@afhomes/contracts';

import { formatDate } from '../../lib/format';
import { formatMoney } from './format';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  getExternalEvidence,
  recordExternalEvidence,
  reviewCommissionEvidenceException,
  uploadExternalEvidence,
} from './services-external-evidence';
import styles from './BusinessCommissionsPage.module.css';

const TYPE_LABEL: Record<ExternalEvidenceType, string> = {
  external_transaction_reference: 'Bank / e-wallet transaction reference',
  official_receipt: 'Official receipt (OR) number',
  uploaded_document: 'Upload a document',
};
const FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;
const MONEY_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;

const evidenceKey = (subject: ExternalPaymentSubject, id: string) =>
  ['external-evidence', subject, id] as const;

function describe(item: ExternalEvidence): string {
  if (item.evidenceType === 'uploaded_document') return 'Document on file';
  if (item.evidenceType === 'official_receipt') return `OR ${item.orNumber ?? ''}`;
  return `Ref ${item.transactionReference ?? ''}`;
}

function transferNote(item: ExternalEvidence): string {
  if (!item.transferAmount) return '';
  const shared = item.sharedWith
    ? ` (also covers ${item.sharedWith} other payment${item.sharedWith === 1 ? '' : 's'})`
    : '';
  return ` · transfer ${formatMoney(item.transferAmount)}${shared}`;
}

/**
 * Verifiable evidence for a payment made outside AF Homes. A typed description
 * alone is never proof: each piece needs a document, a transaction reference
 * or an OR number. Missing evidence keeps the payment on record, flagged.
 */
export function ExternalEvidencePanel({
  subject,
  id,
  canRecord,
  canReviewException = false,
  paymentAmount,
  onChanged,
}: {
  subject: ExternalPaymentSubject;
  id: string;
  canRecord: boolean;
  /** Prefills the transfer amount; one reference may cover several payments up to it. */
  paymentAmount?: string;
  /** Commission payouts only; payroll uses the disbursement reconciliation review. */
  canReviewException?: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const client = useQueryClient();
  const key = evidenceKey(subject, id);
  const query = useQuery({ queryKey: key, queryFn: () => getExternalEvidence(subject, id) });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
    await onChanged?.();
  };

  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  if (query.isPending) return <p className={styles.formNote}>Loading evidence…</p>;
  const { status, items, exceptionReview } = query.data;
  const exception = status === 'EVIDENCE_EXCEPTION';
  return (
    <div className={`${styles.fullRow} ${styles.formGrid}`}>
      <span className={styles.fullRow}>
        <StatusChip
          label={
            !exception
              ? 'Evidence on file'
              : exceptionReview
                ? 'No evidence — exception reviewed'
                : 'No verifiable evidence'
          }
          tone={!exception ? 'success' : exceptionReview ? 'info' : 'warning'}
        />
      </span>
      {items.length > 0 ? (
        <ul className={styles.fullRow}>
          {items.map((item) => (
            <li key={item.id} className={styles.secondary}>
              {describe(item)}
              {transferNote(item)} · {item.source} · recorded {formatDate(item.recordedAt)}
              {item.description ? ` · ${item.description}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {exceptionReview ? (
        <p className={`${styles.fullRow} ${styles.secondary}`}>
          Exception review {formatDate(exceptionReview.reviewedAt)}: {exceptionReview.note}
        </p>
      ) : null}
      {canRecord ? (
        <EvidenceForm subject={subject} id={id} paymentAmount={paymentAmount} onDone={refresh} />
      ) : null}
      {canReviewException && exception && !exceptionReview ? (
        <ExceptionReviewForm id={id} onDone={refresh} />
      ) : null}
    </div>
  );
}

function EvidenceForm({
  subject,
  id,
  paymentAmount,
  onDone,
}: {
  subject: ExternalPaymentSubject;
  id: string;
  paymentAmount?: string;
  onDone: () => Promise<void>;
}) {
  const [type, setType] = useState<ExternalEvidenceType>('external_transaction_reference');
  const [source, setSource] = useState('');
  const [value, setValue] = useState('');
  const [transfer, setTransfer] = useState(paymentAmount ?? '');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const mutation = useBusinessMutation({
    mutationFn: async () => {
      const common = {
        source: source.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      let input: RecordExternalEvidenceRequest;
      if (type === 'uploaded_document') {
        const storagePath = await uploadExternalEvidence(subject, id, file!);
        input = { evidenceType: type, storagePath, ...common };
      } else if (type === 'official_receipt') {
        input = {
          evidenceType: type,
          orNumber: value.trim(),
          transferAmount: transfer.trim(),
          ...common,
        };
      } else {
        input = {
          evidenceType: type,
          transactionReference: value.trim(),
          transferAmount: transfer.trim(),
          ...common,
        };
      }
      return recordExternalEvidence(subject, id, input);
    },
    onSuccess: async () => {
      setValue('');
      setDescription('');
      setFile(null);
      await onDone();
    },
  });
  const valueOk =
    type === 'uploaded_document'
      ? file !== null
      : type === 'official_receipt'
        ? value.trim().length >= 1
        : value.trim().length >= 3;
  const transferOk =
    type === 'uploaded_document' || (MONEY_RE.test(transfer.trim()) && /[1-9]/.test(transfer));
  const valid = source.trim().length >= 2 && valueOk && transferOk;
  const fieldId = `evidence-${subject}-${id}`;
  return (
    <>
      <label className={styles.filterLabel}>
        Evidence type
        <Select
          aria-label="Evidence type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as ExternalEvidenceType);
            setValue('');
            setFile(null);
          }}
          options={Object.entries(TYPE_LABEL).map(([v, label]) => ({ value: v, label }))}
        />
      </label>
      <TextField
        id={`${fieldId}-source`}
        name="evidenceSource"
        label="Issued by"
        hint="Bank, e-wallet or OR booklet, e.g. BDO, GCash."
        value={source}
        onChange={setSource}
      />
      {type === 'uploaded_document' ? (
        <div className={styles.fullRow}>
          <label htmlFor={`${fieldId}-file`}>Document (PDF, JPEG or PNG, max 10 MB)</label>
          <input
            id={`${fieldId}-file`}
            type="file"
            accept={FILE_TYPES.join(',')}
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              event.target.value = '';
              if (next && (!FILE_TYPES.includes(next.type) || next.size > MAX_BYTES)) {
                setFile(null);
                setFileError('Choose a PDF, JPEG or PNG up to 10 MB.');
                return;
              }
              setFileError('');
              setFile(next);
            }}
          />
          {fileError ? <p role="alert">{fileError}</p> : null}
          {file ? <p role="status">Selected: {file.name}</p> : null}
        </div>
      ) : (
        <TextField
          id={`${fieldId}-value`}
          name="evidenceValue"
          label={type === 'official_receipt' ? 'OR number' : 'Transaction reference'}
          value={value}
          onChange={setValue}
        />
      )}
      {type !== 'uploaded_document' ? (
        <TextField
          id={`${fieldId}-transfer`}
          name="evidenceTransferAmount"
          label="Transfer amount on the statement / OR"
          hint={
            type === 'official_receipt'
              ? 'One OR may cover several payments to the same payee, up to this amount. A scanned OR is stronger proof.'
              : 'One bulk transfer may cover several payments, up to this amount. A statement scan is stronger proof.'
          }
          inputMode="decimal"
          value={transfer}
          onChange={setTransfer}
        />
      ) : null}
      <TextAreaField
        id={`${fieldId}-description`}
        name="evidenceDescription"
        label="Description"
        optional
        hint="Context only — a description is not proof."
        value={description}
        onChange={setDescription}
      />
      <div className={styles.fullRow}>
        <Button
          size="sm"
          variant="secondary"
          disabled={!valid || mutation.isPending}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Attach evidence
        </Button>
      </div>
      {mutation.error ? (
        <p role="alert" className={styles.formAlert}>
          {mutation.error.message}
        </p>
      ) : null}
    </>
  );
}

function ExceptionReviewForm({ id, onDone }: { id: string; onDone: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const mutation = useBusinessMutation({
    mutationFn: () => reviewCommissionEvidenceException(id, note.trim()),
    onSuccess: async () => {
      setNote('');
      await onDone();
    },
  });
  return (
    <>
      <TextAreaField
        id={`evidence-exception-${id}`}
        name="exceptionNote"
        label="Why no evidence exists"
        hint="At least 10 characters. Recorded with your identity; the payment is not verified by this."
        value={note}
        onChange={setNote}
      />
      <div className={styles.fullRow}>
        <Button
          size="sm"
          variant="secondary"
          disabled={note.trim().length < 10 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Record exception review
        </Button>
      </div>
      {mutation.error ? (
        <p role="alert" className={styles.formAlert}>
          {mutation.error.message}
        </p>
      ) : null}
    </>
  );
}
