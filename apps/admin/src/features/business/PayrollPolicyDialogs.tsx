import { useState } from 'react';
import { IST_POLICY_REFERENCE, IST_POLICY_TEMPLATES } from '@afhomes/shared';
import {
  policyDraftInputSchema,
  type PayrollPolicy,
  type PayrollRank,
  type PolicyDraftInput,
} from '@afhomes/contracts';
import { Alert, Button, DateField, Dialog, TextAreaField, TextField } from '@afhomes/ui';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { RANK_LABEL, errorMessage, manilaToday } from './payroll-utils';
import { percentToRate, rateToPercent } from './format';
import {
  approvePayrollPolicy,
  createPayrollPolicyDraft,
  endPayrollPolicy,
  returnPayrollPolicy,
  updatePayrollPolicyDraft,
} from './services-payroll';
import styles from './IstPayrollPage.module.css';

const MIN_NOTE = 5;
const MIN_EVIDENCE = 10;

interface DoneProps {
  onClose: () => void;
  onDone: (title: string) => Promise<void>;
}

type Form = Record<
  | 'rank'
  | 'monthlyBa'
  | 'baTarget'
  | 'monthlyPa'
  | 'paTarget'
  | 'pbTarget'
  | 'pbRate'
  | 'collectionGate'
  | 'effectiveFrom'
  | 'effectiveUntil'
  | 'basisNote'
  | 'qpEpRuleReference'
  | 'kpiCollectionPolicyReference'
  | 'limitExceptionRule'
  | 'baReviewLimit'
  | 'paReviewLimit'
  | 'pbReviewLimit'
  | 'netReviewLimit',
  string
>;

const blank = (): Form => ({
  rank: 'SM',
  monthlyBa: '',
  baTarget: '',
  monthlyPa: '',
  paTarget: '',
  pbTarget: '',
  pbRate: '',
  collectionGate: '',
  effectiveFrom: '',
  effectiveUntil: '',
  basisNote: '',
  qpEpRuleReference: '',
  kpiCollectionPolicyReference: '',
  limitExceptionRule: '',
  baReviewLimit: '',
  paReviewLimit: '',
  pbReviewLimit: '',
  netReviewLimit: '',
});

const groupedAmount = (value: string) =>
  value.replace(
    /^(\d+)(.*)$/,
    (_match, whole: string, rest: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + rest,
  );
const ungroupAmount = (value: string) =>
  /^(?:[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value.trim())
    ? value.trim().replaceAll(',', '')
    : value.trim();

const fromPolicy = (p: PayrollPolicy): Form => ({
  rank: p.rank,
  monthlyBa: groupedAmount(p.monthlyBa),
  baTarget: groupedAmount(p.baTarget),
  monthlyPa: groupedAmount(p.monthlyPa),
  paTarget: groupedAmount(p.paTarget),
  pbTarget: groupedAmount(p.pbTarget),
  pbRate: rateToPercent(p.pbRate),
  collectionGate: rateToPercent(p.collectionGate),
  effectiveFrom: p.effectiveFrom,
  effectiveUntil: p.effectiveUntil ?? '',
  basisNote: p.basisNote,
  qpEpRuleReference: p.qpEpRuleReference ?? '',
  kpiCollectionPolicyReference: p.kpiCollectionPolicyReference ?? '',
  limitExceptionRule: p.limitExceptionRule ?? '',
  baReviewLimit: p.baReviewLimit ?? '',
  paReviewLimit: p.paReviewLimit ?? '',
  pbReviewLimit: p.pbReviewLimit ?? '',
  netReviewLimit: p.netReviewLimit ?? '',
});

const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** Exact-decimal strings only; the contract schema is the validator, nothing is parsed to float. */
function toInput(f: Form): { input?: PolicyDraftInput; error?: string } {
  const pbRate = percentToRate(f.pbRate);
  const collectionGate = percentToRate(f.collectionGate);
  if (pbRate === null || collectionGate === null)
    return { error: 'Check percentages: enter 0 to 100, with up to two decimal places.' };
  const parsed = policyDraftInputSchema.safeParse({
    rank: f.rank,
    monthlyBa: ungroupAmount(f.monthlyBa),
    baTarget: ungroupAmount(f.baTarget),
    monthlyPa: ungroupAmount(f.monthlyPa),
    paTarget: ungroupAmount(f.paTarget),
    pbTarget: ungroupAmount(f.pbTarget),
    pbRate,
    collectionGate,
    effectiveFrom: f.effectiveFrom,
    effectiveUntil: opt(f.effectiveUntil),
    basisNote: f.basisNote.trim(),
    qpEpRuleReference: opt(f.qpEpRuleReference),
    kpiCollectionPolicyReference: opt(f.kpiCollectionPolicyReference),
    limitExceptionRule: opt(f.limitExceptionRule),
    baReviewLimit: opt(ungroupAmount(f.baReviewLimit)),
    paReviewLimit: opt(ungroupAmount(f.paReviewLimit)),
    pbReviewLimit: opt(ungroupAmount(f.pbReviewLimit)),
    netReviewLimit: opt(ungroupAmount(f.netReviewLimit)),
  });
  if (parsed.success) return { input: parsed.data };
  const issue = parsed.error.issues[0];
  const field = String(issue?.path[0] ?? 'form');
  return {
    error: `Check ${field.replace(/([a-z])([A-Z])/g, '$1 $2')}: use nonnegative amounts, valid percentages and dates, and the permitted note length.`,
  };
}

const MONEY_FIELDS: [keyof Form, string][] = [
  ['monthlyBa', 'Monthly BA'],
  ['baTarget', 'BA target'],
  ['monthlyPa', 'Monthly PA'],
  ['paTarget', 'PA target'],
  ['pbTarget', 'PB target'],
];
const LIMIT_FIELDS: [keyof Form, string][] = [
  ['baReviewLimit', 'BA review limit'],
  ['paReviewLimit', 'PA review limit'],
  ['pbReviewLimit', 'PB review limit'],
  ['netReviewLimit', 'Net review limit'],
];

export function PolicyDraftDialog({
  policy,
  copyFrom,
  initialRank = 'SM',
  onClose,
  onDone,
}: DoneProps & {
  policy: PayrollPolicy | null;
  copyFrom?: PayrollPolicy;
  initialRank?: PayrollRank;
}) {
  const referenceValues = (rank: PayrollRank) => {
    const source = IST_POLICY_TEMPLATES[rank];
    return {
      rank,
      monthlyBa: groupedAmount(source.monthlyBa),
      baTarget: groupedAmount(source.baTarget),
      monthlyPa: groupedAmount(source.monthlyPa),
      paTarget: groupedAmount(source.paTarget),
      pbTarget: groupedAmount(source.pbTarget),
      pbRate: rateToPercent(source.pbRate),
      collectionGate: rateToPercent(source.collectionGate),
    };
  };
  const [f, setF] = useState<Form>(() =>
    policy
      ? fromPolicy(policy)
      : copyFrom
        ? { ...fromPolicy(copyFrom), effectiveFrom: '', effectiveUntil: '', basisNote: '' }
        : { ...blank(), ...referenceValues(initialRank) },
  );
  const [reference, setReference] = useState<PayrollRank | null>(
    policy || copyFrom ? null : initialRank,
  );
  const [error, setError] = useState<string | null>(null);
  const request = useMutationRequest();
  const set = (key: keyof Form) => (value: string) => setF((state) => ({ ...state, [key]: value }));
  const save = useBusinessMutation({
    mutationFn: (input: PolicyDraftInput) =>
      policy
        ? updatePayrollPolicyDraft(policy.id, input)
        : createPayrollPolicyDraft(input, request.forPayload(input)),
    onSuccess: async () => {
      request.complete();
      await onDone(policy ? 'Draft updated' : 'Draft saved');
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = () => {
    if (f.basisNote.trim().length < MIN_NOTE)
      return setError('Check basis note: give a reason or source note of at least 5 characters.');
    const origin = [
      copyFrom
        ? `Previous policy: ${copyFrom.id}; version ${copyFrom.policyVersion ?? 'legacy'}.`
        : '',
      reference
        ? `[Reference ${reference} ${IST_POLICY_REFERENCE.version}] ${IST_POLICY_REFERENCE.source}`
        : '',
      copyFrom?.basisNote.split('\n').find((line) => line.startsWith('[Reference ')) ?? '',
    ].filter((line) => line && !f.basisNote.includes(line));
    const { input, error: invalid } = toInput({
      ...f,
      basisNote: [...origin, f.basisNote.trim()].join('\n'),
    });
    if (!input) return setError(invalid ?? 'Check the form.');
    setError(null);
    save.mutate(input);
  };
  const loadReference = (rank: PayrollRank) => {
    setF((state) => ({ ...state, ...referenceValues(rank) }));
    setReference(rank);
    setError(null);
  };
  return (
    <Dialog
      open
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      title={
        policy ? 'Edit draft policy' : copyFrom ? 'Create new policy version' : 'New draft policy'
      }
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Save draft
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <fieldset className={styles.rankChoices}>
          <legend>Rank</legend>
          {(Object.keys(RANK_LABEL) as PayrollRank[]).map((rank) => (
            <label key={rank} className={styles.rankChoice}>
              <input
                type="radio"
                name="policy-rank"
                value={rank}
                checked={f.rank === rank}
                disabled={Boolean(copyFrom) || save.isPending}
                onChange={() => (policy ? set('rank')(rank) : loadReference(rank))}
              />
              <span>
                <strong>{rank}</strong> {RANK_LABEL[rank]}
              </span>
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <p className={styles.muted}>
            {reference
              ? 'Prefilled from historical AFHomes reference. Review before approval.'
              : copyFrom
                ? `Copied from ${copyFrom.rank} v${copyFrom.policyVersion ?? 'legacy'}. Set new dates and a change reason.`
                : 'Saved draft values are preserved when changing rank.'}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={save.isPending}
            onClick={() => loadReference(f.rank as PayrollRank)}
          >
            Restore reference values
          </Button>
        </div>
        {reference ? (
          <small className={styles.muted}>
            {IST_POLICY_REFERENCE.version} - {IST_POLICY_REFERENCE.source}
          </small>
        ) : null}
        <fieldset className={styles.fieldset}>
          <legend>Compensation</legend>
          <div className={styles.grid}>
            {MONEY_FIELDS.map(([key, label]) => (
              <TextField
                key={key}
                id={`policy-${key}`}
                name={key}
                label={`${label} (PHP)`}
                value={f[key]}
                onChange={set(key)}
                normalize={groupedAmount}
                inputMode="decimal"
              />
            ))}
            <TextField
              id="policy-pbRate"
              name="pbRate"
              label="PB rate (%)"
              value={f.pbRate}
              onChange={set('pbRate')}
              inputMode="decimal"
              hint="Enter 1 for 1%. Up to two decimal places."
            />
          </div>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend>Qualification</legend>
          <div className={styles.grid}>
            <TextField
              id="policy-collectionGate"
              name="collectionGate"
              label="Collection gate (%)"
              value={f.collectionGate}
              onChange={set('collectionGate')}
              inputMode="decimal"
              hint="Enter 40 for 40%. Above 0 and at most 100%."
            />
            <TextField
              id="policy-qpEp"
              name="qpEpRuleReference"
              label="QP/EP rule reference"
              value={f.qpEpRuleReference}
              onChange={set('qpEpRuleReference')}
              optional
            />
            <TextField
              id="policy-kpi"
              name="kpiCollectionPolicyReference"
              label="KPI/collection policy reference"
              value={f.kpiCollectionPolicyReference}
              onChange={set('kpiCollectionPolicyReference')}
              optional
            />
          </div>
          <p className={styles.muted}>
            QP BA follows the approved engagement decision. Production and collection rules are
            configured in Engagements &amp; rules.
          </p>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend>Validity</legend>
          <div className={styles.grid}>
            <DateField
              id="policy-effectiveFrom"
              name="effectiveFrom"
              label="Effective from"
              value={f.effectiveFrom}
              onChange={set('effectiveFrom')}
            />
            <DateField
              id="policy-effectiveUntil"
              name="effectiveUntil"
              label="Effective until"
              value={f.effectiveUntil}
              onChange={set('effectiveUntil')}
              optional
            />
          </div>
          <p className={styles.muted}>
            Policy version:{' '}
            {policy?.policyVersion
              ? `v${policy.policyVersion}`
              : 'assigned by the server when saved'}
            . Overlapping approved dates and unapproved mid-month transitions are refused.
          </p>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend>Approval</legend>
          <TextAreaField
            id="policy-basisNote"
            name="basisNote"
            label="Basis note / change reason"
            value={f.basisNote}
            onChange={set('basisNote')}
            hint="Explain the source or reason for these values. At least 5 characters."
          />
          <p className={styles.muted}>
            Saving creates a draft. The authorized approver supplies the approval evidence reference
            after submission.
          </p>
          <details>
            <summary>Review limits and exceptions</summary>
            <div className={styles.grid}>
              {LIMIT_FIELDS.map(([key, label]) => (
                <TextField
                  key={key}
                  id={`policy-${key}`}
                  name={key}
                  label={`${label} (PHP)`}
                  value={f[key]}
                  onChange={set(key)}
                  normalize={groupedAmount}
                  inputMode="decimal"
                  optional
                />
              ))}
              <TextField
                id="policy-exception"
                name="limitExceptionRule"
                label="Limit exception rule"
                value={f.limitExceptionRule}
                onChange={set('limitExceptionRule')}
                optional
              />
            </div>
          </details>
        </fieldset>
        {error ? (
          <Alert variant="danger" title="Not saved">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ApprovePolicyDialog({
  policy,
  onClose,
  onDone,
}: DoneProps & { policy: PayrollPolicy }) {
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () =>
      approvePayrollPolicy(policy.id, { evidenceReference: evidence.trim(), note: note.trim() }),
    onSuccess: () => onDone('Policy approved'),
    onError: (e) => setError(errorMessage(e)),
  });
  const invalid = evidence.trim().length < MIN_EVIDENCE || note.trim().length < MIN_NOTE;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Approve ${policy.rank} policy`}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={run.isPending} disabled={invalid} onClick={() => run.mutate()}>
            Approve policy
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <TextField
          id="policy-evidence"
          name="evidenceReference"
          label="Evidence reference"
          value={evidence}
          onChange={setEvidence}
          hint={`The signed document or approval record (at least ${MIN_EVIDENCE} characters). Placeholders are refused.`}
        />
        <TextAreaField
          id="policy-approve-note"
          name="note"
          label="Note"
          value={note}
          onChange={setNote}
          hint={`At least ${MIN_NOTE} characters.`}
        />
        {error ? (
          <Alert variant="danger" title="Not done">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ReturnPolicyDialog({
  policy,
  onClose,
  onDone,
}: DoneProps & { policy: PayrollPolicy }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () => returnPayrollPolicy(policy.id, reason.trim()),
    onSuccess: () => onDone('Policy returned to draft'),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Return ${policy.rank} policy`}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={run.isPending}
            disabled={reason.trim().length < MIN_NOTE}
            onClick={() => run.mutate()}
          >
            Return policy
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <TextField
          id="policy-return-reason"
          name="reason"
          label="Reason"
          value={reason}
          onChange={setReason}
          hint={`At least ${MIN_NOTE} characters.`}
        />
        {error ? (
          <Alert variant="danger" title="Not done">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

export function EndPolicyDialog({
  policy,
  onClose,
  onDone,
}: DoneProps & { policy: PayrollPolicy }) {
  const [until, setUntil] = useState(manilaToday());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () => endPayrollPolicy(policy.id, { effectiveUntil: until, note: note.trim() }),
    onSuccess: () => onDone('Policy ended'),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`End ${policy.rank} policy`}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={run.isPending}
            disabled={!until || note.trim().length < MIN_NOTE}
            onClick={() => run.mutate()}
          >
            End policy
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <DateField
          id="policy-end-date"
          name="effectiveUntil"
          label="Effective until"
          value={until}
          onChange={setUntil}
        />
        <TextAreaField
          id="policy-end-note"
          name="note"
          label="Note"
          value={note}
          onChange={setNote}
          hint={`At least ${MIN_NOTE} characters.`}
        />
        {error ? (
          <Alert variant="danger" title="Not done">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
