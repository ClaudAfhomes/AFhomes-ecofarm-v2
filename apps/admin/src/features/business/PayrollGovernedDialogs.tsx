import { useState } from 'react';
import {
  approvePolicyInputSchema,
  engagementDraftInputSchema,
  engagementEndInputSchema,
  performanceRuleDraftInputSchema,
  performanceRuleEndInputSchema,
  type EngagementDraftInput,
  type IstEngagement,
  type IstPerformanceRule,
  type PayrollRank,
  type PerformanceRuleDraftInput,
} from '@afhomes/contracts';
import { Alert, Button, DateField, Dialog, Select, TextAreaField, TextField } from '@afhomes/ui';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { ATTRIBUTION_LABEL, COUNT_DATE_LABEL, RANK_LABEL, errorMessage } from './payroll-utils';
import { PayrollStaffPicker } from './PayrollStaffPicker';
import {
  approveGoverned,
  createGovernedDraft,
  endGoverned,
  returnGoverned,
  updateGovernedDraft,
  type GovernedKind,
} from './services-payroll';
import styles from './IstPayrollPage.module.css';

const MIN_NOTE = 5;
const MIN_EVIDENCE = 10;

interface DoneProps {
  onClose: () => void;
  onDone: (title: string) => Promise<void>;
}

const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const NO_STAFF = new Set<string>();

function Footer({
  onClose,
  label,
  loading,
  disabled,
  onClick,
}: {
  onClose: () => void;
  label: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className={styles.actions}>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button loading={loading} disabled={disabled} onClick={onClick}>
        {label}
      </Button>
    </div>
  );
}

function Failure({ message, title = 'Not done' }: { message: string | null; title?: string }) {
  return message ? (
    <Alert variant="danger" title={title}>
      {message}
    </Alert>
  ) : null;
}

/* ---------------------------------- shared decisions --------------------------------- */

export function GovernedApproveDialog({
  kind,
  id,
  subject,
  onClose,
  onDone,
}: DoneProps & { kind: GovernedKind; id: string; subject: string }) {
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () =>
      approveGoverned(kind, id, { evidenceReference: evidence.trim(), note: note.trim() }),
    onSuccess: () => onDone(`${subject} approved`),
    onError: (e) => setError(errorMessage(e)),
  });
  const valid = approvePolicyInputSchema.safeParse({
    evidenceReference: evidence,
    note,
  }).success;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Approve ${subject}`}
      footer={
        <Footer
          onClose={onClose}
          label={`Approve ${subject}`}
          loading={run.isPending}
          disabled={!valid}
          onClick={() => run.mutate()}
        />
      }
    >
      <div className={styles.form}>
        <TextField
          id={`${kind}-evidence`}
          name="evidenceReference"
          label="Evidence reference"
          value={evidence}
          onChange={setEvidence}
          hint={`The signed document or approval record (at least ${MIN_EVIDENCE} characters). Placeholders are refused.`}
        />
        <TextAreaField
          id={`${kind}-approve-note`}
          name="note"
          label="Note"
          value={note}
          onChange={setNote}
          hint={`At least ${MIN_NOTE} characters.`}
        />
        <Failure message={error} />
      </div>
    </Dialog>
  );
}

export function GovernedReturnDialog({
  kind,
  id,
  subject,
  onClose,
  onDone,
}: DoneProps & { kind: GovernedKind; id: string; subject: string }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () => returnGoverned(kind, id, reason.trim()),
    onSuccess: () => onDone(`${subject} returned to draft`),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Return ${subject}`}
      footer={
        <Footer
          onClose={onClose}
          label={`Return ${subject}`}
          loading={run.isPending}
          disabled={reason.trim().length < MIN_NOTE}
          onClick={() => run.mutate()}
        />
      }
    >
      <div className={styles.form}>
        <TextField
          id={`${kind}-return-reason`}
          name="reason"
          label="Reason"
          value={reason}
          onChange={setReason}
          hint={`At least ${MIN_NOTE} characters.`}
        />
        <Failure message={error} />
      </div>
    </Dialog>
  );
}

/* ---------------------------------- engagements --------------------------------- */

interface EngagementForm {
  staffId: string;
  staffName: string;
  rank: string;
  contractStart: string;
  contractEnd: string;
  evidenceReference: string;
  qpBaApproved: string;
  qpDecisionReference: string;
}

export function EngagementDraftDialog({
  engagement,
  onClose,
  onDone,
}: DoneProps & { engagement: IstEngagement | null }) {
  const [f, setF] = useState<EngagementForm>(() => ({
    staffId: engagement?.staffId ?? '',
    staffName: engagement?.staffName ?? '',
    rank: engagement?.rank ?? 'SM',
    contractStart: engagement?.contractStart ?? '',
    contractEnd: engagement?.contractEnd ?? '',
    evidenceReference: engagement?.evidenceReference ?? '',
    qpBaApproved: engagement?.qpBaApproved == null ? '' : String(engagement.qpBaApproved),
    qpDecisionReference: engagement?.qpDecisionReference ?? '',
  }));
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof EngagementForm) => (value: string) =>
    setF((s) => ({ ...s, [key]: value }));

  const save = useBusinessMutation({
    mutationFn: (input: EngagementDraftInput) =>
      engagement
        ? updateGovernedDraft('engagements', engagement.id, input)
        : createGovernedDraft('engagements', input),
    onSuccess: () => onDone(engagement ? 'Engagement draft updated' : 'Engagement draft saved'),
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    if (!f.staffId) return setError('Choose the staff member first.');
    const parsed = engagementDraftInputSchema.safeParse({
      staffId: f.staffId,
      rank: f.rank,
      contractStart: f.contractStart,
      contractEnd: opt(f.contractEnd),
      evidenceReference: f.evidenceReference.trim(),
      ...(f.qpBaApproved === '' ? {} : { qpBaApproved: f.qpBaApproved === 'true' }),
      ...(f.qpDecisionReference.trim() ? { qpDecisionReference: f.qpDecisionReference.trim() } : {}),
    });
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'form');
      return setError(
        `Check ${field}: dates must be real days and the evidence reference needs at least ${MIN_EVIDENCE} characters.`,
      );
    }
    setError(null);
    save.mutate(parsed.data);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={engagement ? 'Edit engagement draft' : 'New engagement draft'}
      footer={
        <Footer onClose={onClose} label="Save draft" loading={save.isPending} onClick={submit} />
      }
    >
      <div className={styles.form}>
        <Alert variant="info" title="Draft only">
          Saving a draft does not approve it. An engagement only counts once it is approved.
        </Alert>
        {engagement ? (
          <p>
            Staff: <strong>{engagement.staffName ?? 'Unnamed staff'}</strong>{' '}
            <span className={styles.muted}>(cannot change; create a new draft instead)</span>
          </p>
        ) : (
          <>
            {f.staffId ? (
              <p>
                Staff: <strong>{f.staffName || 'Unnamed staff'}</strong>
              </p>
            ) : null}
            <PayrollStaffPicker
              selectedIds={f.staffId ? new Set([f.staffId]) : NO_STAFF}
              onSelect={(entry) =>
                setF((s) => ({
                  ...s,
                  staffId: entry.id,
                  staffName: entry.name ?? '',
                  rank: entry.rank,
                }))
              }
            />
          </>
        )}
        <label className={styles.field}>
          Rank
          <Select
            aria-label="Rank"
            value={f.rank}
            onChange={(e) => set('rank')(e.target.value)}
            options={(Object.keys(RANK_LABEL) as PayrollRank[]).map((r) => ({
              value: r,
              label: `${r} — ${RANK_LABEL[r]}`,
            }))}
          />
        </label>
        <div className={styles.grid}>
          <DateField
            id="engagement-contractStart"
            name="contractStart"
            label="Contract start"
            value={f.contractStart}
            onChange={set('contractStart')}
          />
          <DateField
            id="engagement-contractEnd"
            name="contractEnd"
            label="Contract end"
            value={f.contractEnd}
            onChange={set('contractEnd')}
            optional
          />
        </div>
        <TextField
          id="engagement-evidence"
          name="evidenceReference"
          label="Evidence reference"
          value={f.evidenceReference}
          onChange={set('evidenceReference')}
          hint={`Signed contract or record (at least ${MIN_EVIDENCE} characters).`}
        />
        <label className={styles.field}>
          QP Basic Allowance decision
          <Select
            aria-label="QP Basic Allowance decision"
            value={f.qpBaApproved}
            onChange={(e) => set('qpBaApproved')(e.target.value)}
            options={[
              { value: '', label: 'Not decided' },
              { value: 'true', label: 'Qualified under the authorized QP rule' },
              { value: 'false', label: 'Not qualified under the authorized QP rule' },
            ]}
          />
        </label>
        <TextField
          id="engagement-qp-reference"
          name="qpDecisionReference"
          label="QP authorization reference"
          value={f.qpDecisionReference}
          onChange={set('qpDecisionReference')}
          optional={f.qpBaApproved === ''}
          hint="Identify the approved QP rule and attendance or compliance decision. Takes effect only after engagement approval."
        />
        <Failure message={error} title="Not saved" />
      </div>
    </Dialog>
  );
}

export function EngagementEndDialog({
  engagement,
  onClose,
  onDone,
}: DoneProps & { engagement: IstEngagement }) {
  const [contractEnd, setContractEnd] = useState('');
  const [suspendedFrom, setSuspendedFrom] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () => {
      const parsed = engagementEndInputSchema.safeParse({
        contractEnd: opt(contractEnd),
        suspendedFrom: opt(suspendedFrom),
        note: note.trim(),
      });
      if (!parsed.success)
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? 'Check the dates and the note.'),
        );
      return endGoverned('engagements', engagement.id, parsed.data);
    },
    onSuccess: () => onDone('Engagement updated'),
    onError: (e) => setError(errorMessage(e)),
  });
  const noDate = !contractEnd && !suspendedFrom;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`End or suspend ${engagement.staffName ?? 'engagement'}`}
      footer={
        <Footer
          onClose={onClose}
          label="Save end / suspension"
          loading={run.isPending}
          disabled={noDate || note.trim().length < MIN_NOTE}
          onClick={() => run.mutate()}
        />
      }
    >
      <div className={styles.form}>
        <p className={styles.muted}>
          Give a contract end date, a suspension date, or both. Each is set once.
        </p>
        <div className={styles.grid}>
          <DateField
            id="engagement-end-contractEnd"
            name="contractEnd"
            label="Contract end"
            value={engagement.contractEnd ?? contractEnd}
            onChange={setContractEnd}
            disabled={Boolean(engagement.contractEnd)}
            optional
            hint={engagement.contractEnd ? 'Already set.' : undefined}
          />
          <DateField
            id="engagement-end-suspendedFrom"
            name="suspendedFrom"
            label="Suspended from"
            value={engagement.suspendedFrom ?? suspendedFrom}
            onChange={setSuspendedFrom}
            disabled={Boolean(engagement.suspendedFrom)}
            optional
            hint={engagement.suspendedFrom ? 'Already set.' : undefined}
          />
        </div>
        <TextAreaField
          id="engagement-end-note"
          name="note"
          label="Note"
          value={note}
          onChange={setNote}
          hint={`At least ${MIN_NOTE} characters.`}
        />
        <Failure message={error} />
      </div>
    </Dialog>
  );
}

/* ---------------------------------- performance rules --------------------------------- */

interface RuleForm {
  effectiveFrom: string;
  effectiveUntil: string;
  attributionBasis: string;
  closedDealThresholdPct: string;
  countDateBasis: string;
  assumedCreditRate: string;
  adjustmentTreatment: string;
  sourceReference: string;
}

/** Every value starts empty: nothing here is approved or defaulted. */
const blankRule = (): RuleForm => ({
  effectiveFrom: '',
  effectiveUntil: '',
  attributionBasis: '',
  closedDealThresholdPct: '',
  countDateBasis: '',
  assumedCreditRate: '',
  adjustmentTreatment: '',
  sourceReference: '',
});

const fromRule = (r: IstPerformanceRule): RuleForm => ({
  effectiveFrom: r.effectiveFrom,
  effectiveUntil: r.effectiveUntil ?? '',
  attributionBasis: r.attributionBasis ?? '',
  closedDealThresholdPct: r.closedDealThresholdPct ?? '',
  countDateBasis: r.countDateBasis ?? '',
  assumedCreditRate: r.assumedCreditRate ?? '',
  adjustmentTreatment: r.adjustmentTreatment ?? '',
  sourceReference: r.sourceReference,
});

const NOT_DECIDED = { value: '', label: 'Not decided' };

export function RuleDraftDialog({
  rule,
  onClose,
  onDone,
}: DoneProps & { rule: IstPerformanceRule | null }) {
  const [f, setF] = useState<RuleForm>(() => (rule ? fromRule(rule) : blankRule()));
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof RuleForm) => (value: string) => setF((s) => ({ ...s, [key]: value }));

  const save = useBusinessMutation({
    mutationFn: (input: PerformanceRuleDraftInput) =>
      rule
        ? updateGovernedDraft('performance-rules', rule.id, input)
        : createGovernedDraft('performance-rules', input),
    onSuccess: () => onDone(rule ? 'Rule draft updated' : 'Rule draft saved'),
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    const parsed = performanceRuleDraftInputSchema.safeParse({
      effectiveFrom: f.effectiveFrom,
      effectiveUntil: opt(f.effectiveUntil),
      attributionBasis: opt(f.attributionBasis),
      closedDealThresholdPct: opt(f.closedDealThresholdPct),
      countDateBasis: opt(f.countDateBasis),
      assumedCreditRate: opt(f.assumedCreditRate),
      adjustmentTreatment: opt(f.adjustmentTreatment),
      sourceReference: f.sourceReference.trim(),
    });
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? 'form');
      return setError(
        `Check ${field}: the threshold is a percentage above 0 and at most 100, the credit rate is between 0 and 1, dates are real days, and the source reference needs at least ${MIN_EVIDENCE} characters.`,
      );
    }
    setError(null);
    save.mutate(parsed.data);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? 'Edit performance rule draft' : 'New performance rule draft'}
      footer={
        <Footer onClose={onClose} label="Save draft" loading={save.isPending} onClick={submit} />
      }
    >
      <div className={styles.form}>
        <Alert variant="info" title="Draft only">
          Saving a draft does not approve it. Leave a choice as &ldquo;Not decided&rdquo; until it
          is approved; undecided choices keep the figures blocked.
        </Alert>
        <div className={styles.grid}>
          <DateField
            id="rule-effectiveFrom"
            name="effectiveFrom"
            label="Effective from"
            value={f.effectiveFrom}
            onChange={set('effectiveFrom')}
          />
          <DateField
            id="rule-effectiveUntil"
            name="effectiveUntil"
            label="Effective until"
            value={f.effectiveUntil}
            onChange={set('effectiveUntil')}
            optional
          />
        </div>
        <label className={styles.field}>
          Attribution basis
          <Select
            aria-label="Attribution basis"
            value={f.attributionBasis}
            onChange={(e) => set('attributionBasis')(e.target.value)}
            options={[
              NOT_DECIDED,
              ...Object.entries(ATTRIBUTION_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </label>
        <label className={styles.field}>
          Count-date basis
          <Select
            aria-label="Count-date basis"
            value={f.countDateBasis}
            onChange={(e) => set('countDateBasis')(e.target.value)}
            options={[
              NOT_DECIDED,
              ...Object.entries(COUNT_DATE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        </label>
        <label className={styles.field}>
          Adjustment treatment
          <Select
            aria-label="Adjustment treatment"
            value={f.adjustmentTreatment}
            onChange={(e) => set('adjustmentTreatment')(e.target.value)}
            options={[NOT_DECIDED, { value: 'report_only', label: 'Report only (never deducted)' }]}
          />
        </label>
        <div className={styles.grid}>
          <TextField
            id="rule-threshold"
            name="closedDealThresholdPct"
            label="Closed-deal threshold (%)"
            value={f.closedDealThresholdPct}
            onChange={set('closedDealThresholdPct')}
            inputMode="decimal"
            optional
            hint="Above 0, at most 100."
          />
          <TextField
            id="rule-assumedCredit"
            name="assumedCreditRate"
            label="Assumed-credit rate"
            value={f.assumedCreditRate}
            onChange={set('assumedCreditRate')}
            inputMode="decimal"
            optional
            hint="Fraction from 0 to 1."
          />
        </div>
        <TextField
          id="rule-source"
          name="sourceReference"
          label="Source reference"
          value={f.sourceReference}
          onChange={set('sourceReference')}
          hint={`The decision or document these values come from (at least ${MIN_EVIDENCE} characters).`}
        />
        <Failure message={error} title="Not saved" />
      </div>
    </Dialog>
  );
}

export function RuleEndDialog({ rule, onClose, onDone }: DoneProps & { rule: IstPerformanceRule }) {
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () => {
      const parsed = performanceRuleEndInputSchema.safeParse({
        effectiveUntil: until,
        note: note.trim(),
      });
      if (!parsed.success)
        return Promise.reject(
          new Error('Enter a real end date and a note of at least 5 characters.'),
        );
      return endGoverned('performance-rules', rule.id, parsed.data);
    },
    onSuccess: () => onDone('Rule ended'),
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`End rule v${rule.ruleVersion}`}
      footer={
        <Footer
          onClose={onClose}
          label="End rule"
          loading={run.isPending}
          disabled={!until || note.trim().length < MIN_NOTE}
          onClick={() => run.mutate()}
        />
      }
    >
      <div className={styles.form}>
        <DateField
          id="rule-end-date"
          name="effectiveUntil"
          label="Effective until"
          value={until}
          onChange={setUntil}
        />
        <TextAreaField
          id="rule-end-note"
          name="note"
          label="Note"
          value={note}
          onChange={setNote}
          hint={`At least ${MIN_NOTE} characters.`}
        />
        <Failure message={error} />
      </div>
    </Dialog>
  );
}
