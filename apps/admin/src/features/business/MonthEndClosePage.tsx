import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dialog,
  ErrorState,
  Icon,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import type { IconName, StatusTone } from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';

import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { formatDateTime } from '../../lib/format';
import { formatMoney } from './format';
import { businessKeys } from './queryKeys';
import {
  closePeriod,
  getAccountingPeriods,
  getFinanceSummary,
  getPeriodReadiness,
  periodReadinessKey,
  returnPeriod,
  submitPeriod,
} from './services-periods';
import styles from './MonthEndClosePage.module.css';

type PeriodStatus = 'open' | 'ready_for_approval' | 'closed';

const STATUS_LABEL: Record<PeriodStatus, string> = {
  open: 'Open',
  ready_for_approval: 'Ready for approval',
  closed: 'Closed',
};
const STATUS_TONE: Record<PeriodStatus, StatusTone> = {
  open: 'neutral',
  ready_for_approval: 'warning',
  closed: 'success',
};

const REASON_MIN = 5;
const PAYMENTS_PATH = '/admin/finance/payments';

/** Last 12 calendar months (Manila), newest first, as `YYYY-MM`. Labels only. */
function monthOptions(now = new Date()): string[] {
  const manila = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).format(now); // "2026-11"
  const [y, m] = manila.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => {
    const index = y * 12 + (m - 1) - (i + 1);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const humanKey = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

const snapshotValue = (value: unknown): string | null => {
  if (typeof value === 'number') return formatCountOrDash(value);
  if (typeof value === 'string') return /^-?\d+\.\d{2}$/.test(value) ? formatMoney(value) : value;
  return null;
};

type Confirm = 'submit' | 'close' | 'return' | null;

export function MonthEndClosePage() {
  const { user } = useSession();
  const client = useQueryClient();
  const has = (key: string, action: 'canCreate' | 'canUpdate') =>
    user?.afHomesPermissions.some((p) => p.moduleKey === key && p[action]) ?? false;
  const canSubmit = has('finance.payroll', 'canCreate');
  const canClose = has('finance.payroll_close', 'canUpdate');

  const months = useMemo(() => monthOptions(), []);
  const [period, setPeriod] = useState(months[0] as string);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: businessKeys.financeSummary(period),
    queryFn: () => getFinanceSummary(period),
    refetchInterval: 15000,
  });
  const periods = useQuery({
    queryKey: businessKeys.accountingPeriods,
    queryFn: getAccountingPeriods,
    refetchInterval: 30000,
  });
  const record = periods.data?.find((p) => p.period === period);
  const readiness = useQuery({
    queryKey: periodReadinessKey(period),
    queryFn: () => getPeriodReadiness(period),
    refetchInterval: 15000,
  });
  const blockers = readiness.data?.blockers ?? [];
  const warnings = readiness.data?.warnings ?? [];
  const submitBlock = !readiness.isSuccess
    ? 'Closing checks must load before you can continue.'
    : blockers.length > 0
      ? `${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'} to fix first.`
      : !readiness.data.ready
        ? 'This month is not ready for closing.'
        : null;

  const run = useBusinessMutation({
    mutationFn: async (kind: 'submit' | 'close' | 'return') => {
      if (kind === 'submit') return submitPeriod(period);
      if (kind === 'close') return closePeriod(period);
      return returnPeriod(period, reason.trim());
    },
    onSuccess: async (_data, kind) => {
      setConfirm(null);
      setReason('');
      setError(null);
      notifySuccess({
        title: kind === 'submit' ? 'Submitted' : kind === 'close' ? 'Period closed' : 'Returned',
      });
      await client.invalidateQueries({ queryKey: businessKeys.queue });
    },
    onError: async (e) => {
      setError(e instanceof Error ? e.message : 'The request failed.');
      await client.invalidateQueries({ queryKey: periodReadinessKey(period) });
    },
  });

  const open = (kind: Exclude<Confirm, null>) => {
    setError(null);
    setReason('');
    setConfirm(kind);
  };

  const s = summary.data;
  const status = s?.status;
  const submitterIsMe = Boolean(record?.submittedBy && record.submittedBy === user?.id);
  const earlierOpen = s?.earlierOpenPeriods ?? [];
  const closeBlock =
    submitBlock ??
    (!periods.isSuccess
      ? 'Approval history must load before closing.'
      : earlierOpen.length > 0
        ? 'Close earlier months first.'
        : submitterIsMe
          ? 'The submitter cannot close.'
          : null);

  const lines: {
    label: string;
    value: string;
    icon: IconName;
    to?: string;
    note?: string;
    warn?: boolean;
  }[] = s
    ? [
        {
          label: 'Verified',
          icon: 'check',
          value: formatMoney(s.verifiedTotal),
          note: `${formatCountOrDash(s.verifiedCount)} payments`,
        },
        {
          label: 'Pending verification',
          icon: 'clock',
          value: formatCountOrDash(s.pendingVerification),
          to: PAYMENTS_PATH,
        },
        {
          label: 'Held for duplicate review',
          icon: 'alert',
          value: formatCountOrDash(s.heldForDuplicateReview),
          to: PAYMENTS_PATH,
        },
        {
          label: 'Proposed adjustments',
          icon: 'pencil',
          value: formatCountOrDash(s.proposedAdjustments),
          to: PAYMENTS_PATH,
        },
        { label: 'Late postings', icon: 'list', value: formatCountOrDash(s.latePostings) },
        {
          label: 'Earlier open months',
          icon: 'alert',
          warn: earlierOpen.length > 0,
          value: earlierOpen.length ? earlierOpen.map(monthLabel).join(', ') : 'None',
          note: earlierOpen.length ? 'Blocks closing' : undefined,
        },
      ]
    : [];

  const snapshotEntries = Object.entries(record?.snapshot ?? {}).flatMap(([k, v]) => {
    const text = snapshotValue(v);
    return text === null ? [] : [[humanKey(k), text] as const];
  });

  const reasonTooShort = reason.trim().length < REASON_MIN;
  const confirmTitle =
    confirm === 'submit'
      ? 'Submit for closing'
      : confirm === 'close'
        ? 'Close period'
        : 'Return period';

  return (
    <section className={styles.shell}>
      <PageHeader title="Month-End Close" description="Review the month, then close it." />

      <div className={styles.toolbar}>
        <label className={styles.field}>
          Month
          <Select
            aria-label="Month"
            value={period}
            disabled={confirm !== null || run.isPending}
            onChange={(event) => setPeriod(event.target.value)}
            options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
          />
        </label>
        <Button
          variant="secondary"
          loading={summary.isFetching || periods.isFetching || readiness.isFetching}
          disabled={confirm !== null || run.isPending}
          onClick={() =>
            void Promise.all([summary.refetch(), periods.refetch(), readiness.refetch()])
          }
        >
          Refresh
        </Button>
      </div>

      {summary.isPending ? (
        <Skeleton style={{ height: 160 }} />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      ) : (
        <>
          <div className={styles.statusRow}>
            <StatusChip
              label={STATUS_LABEL[status as PeriodStatus]}
              tone={STATUS_TONE[status as PeriodStatus]}
            />
            {record?.returnedReason && status === 'open' ? (
              <span className={styles.muted}>Returned: {record.returnedReason}</span>
            ) : null}
          </div>

          {status !== 'closed' ? (
            <section className={styles.actionPanel} aria-label="Next closing step">
              <div>
                <h2 className={styles.heading}>Next step</h2>
                <p className={styles.muted}>
                  {status === 'open'
                    ? canSubmit
                      ? 'Review the closing checks, then submit for approval.'
                      : 'Finance prepares and submits this month for closing.'
                    : canClose
                      ? 'Review the submitted month, then close or return it.'
                      : 'Waiting for an authorized closer to review this month.'}
                </p>
              </div>
              <div className={styles.actions} role="group" aria-label="Month closing actions">
                {canSubmit && status === 'open' ? (
                  <>
                    <Button disabled={submitBlock !== null} onClick={() => open('submit')}>
                      Submit for closing
                    </Button>
                    {submitBlock ? <span className={styles.muted}>{submitBlock}</span> : null}
                  </>
                ) : null}
                {canClose && status === 'ready_for_approval' ? (
                  <>
                    <Button disabled={closeBlock !== null} onClick={() => open('close')}>
                      Close period
                    </Button>
                    <Button variant="secondary" onClick={() => open('return')}>
                      Return
                    </Button>
                    {closeBlock ? <span className={styles.muted}>{closeBlock}</span> : null}
                  </>
                ) : null}
              </div>
            </section>
          ) : null}

          <ul className={styles.metrics} aria-label="Pre-close checklist">
            {lines.map((line) => (
              <li
                key={line.label}
                className={line.warn ? `${styles.metric} ${styles.metricWarn}` : styles.metric}
              >
                <span className={styles.metricIcon} aria-hidden="true">
                  <Icon name={line.icon} size={20} />
                </span>
                <span className={styles.metricLabel}>
                  {line.to ? <Link to={line.to}>{line.label}</Link> : line.label}
                </span>
                <strong>{line.value}</strong>
                {line.note ? <small className={styles.note}>{line.note}</small> : null}
              </li>
            ))}
          </ul>
          {status !== 'closed' ? (
            <section className={styles.reviewPanel} aria-label="Closing checks">
              <h2 className={styles.heading}>Closing checks</h2>
              <p className={styles.muted}>
                Blocking issues must be resolved. Warnings do not prevent closing.
              </p>
              {readiness.isPending ? <p role="status">Checking this month...</p> : null}
              {readiness.isError ? (
                <ErrorState
                  title="Closing checks unavailable"
                  error={readiness.error}
                  onRetry={readiness.refetch}
                />
              ) : null}
              {readiness.isSuccess ? (
                <ul className={styles.checklist} aria-label="Readiness">
                  {blockers.map((b) => (
                    <li key={b.code} className={styles.blocker}>
                      <strong>Blocker · {b.count}</strong> — {b.message}
                      {b.code === 'PAYMENT_ADJUSTMENTS_PENDING' ||
                      b.code === 'PAYMENTS_PENDING_VERIFICATION' ? (
                        <>
                          {' '}
                          <Link to={PAYMENTS_PATH}>
                            {b.code === 'PAYMENT_ADJUSTMENTS_PENDING'
                              ? 'Review proposed adjustments'
                              : 'Review pending payments'}
                          </Link>
                        </>
                      ) : null}
                    </li>
                  ))}
                  {warnings.map((w) => (
                    <li key={w.code} className={styles.warning}>
                      <strong>Warning · {w.count}</strong> — {w.message}
                      {w.code === 'VERIFIED_PAYMENTS_MISSING_EVIDENCE' ? (
                        <>
                          {' '}
                          <Link to={PAYMENTS_PATH}>Review payment evidence</Link>
                        </>
                      ) : w.code === 'LIVE_PAYROLL_NOT_CLOSED' ? (
                        <>
                          {' '}
                          <Link to="/admin/finance/payroll">Review payroll</Link>
                        </>
                      ) : null}
                    </li>
                  ))}
                  {blockers.length === 0 && warnings.length === 0 ? (
                    <li className={styles.muted}>
                      {readiness.data.ready
                        ? 'Ready to submit.'
                        : 'The server has not marked this month ready.'}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </section>
          ) : null}

          {status === 'closed' ? (
            <div className={styles.snapshot}>
              <p>
                Closed {formatDateTime(record?.closedAt)}
                {record?.closedBy
                  ? ` by ${record.closedBy === user?.id ? 'you' : record.closedBy.slice(0, 8)}`
                  : ''}
              </p>
              <ul aria-label="Closed figures" className={styles.checklist}>
                {snapshotEntries.map(([label, value]) => (
                  <li key={label} className={styles.line}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <details className={styles.history}>
        <summary>Period history</summary>
        {periods.isError ? (
          <ErrorState error={periods.error} onRetry={periods.refetch} />
        ) : (
          <ul className={styles.checklist} aria-label="Period history">
            {(periods.data ?? []).map((p) => (
              <li key={p.period} className={styles.line}>
                <span>{monthLabel(p.period)}</span>
                <StatusChip label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} />
              </li>
            ))}
            {periods.data?.length === 0 ? <li className={styles.muted}>No periods yet.</li> : null}
          </ul>
        )}
      </details>

      {confirm ? (
        <Dialog
          open
          onClose={() => {
            if (!run.isPending) setConfirm(null);
          }}
          title={confirmTitle}
          footer={
            <div className={styles.actions}>
              <Button variant="secondary" disabled={run.isPending} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                loading={run.isPending}
                disabled={
                  run.isPending ||
                  (confirm === 'submit'
                    ? !canSubmit || submitBlock !== null
                    : confirm === 'close'
                      ? !canClose || closeBlock !== null
                      : !canClose || reasonTooShort)
                }
                onClick={() => run.mutate(confirm)}
              >
                {confirmTitle}
              </Button>
            </div>
          }
        >
          <p>
            {monthLabel(period)} · Verified {s ? formatMoney(s.verifiedTotal) : '—'}
          </p>
          {confirm === 'return' ? (
            <TextField
              id="return-reason"
              name="reason"
              label="Reason"
              value={reason}
              onChange={setReason}
              hint={`At least ${REASON_MIN} characters.`}
            />
          ) : null}
          {error ? (
            <Alert variant="danger" title="Not done">
              {error}
            </Alert>
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}
