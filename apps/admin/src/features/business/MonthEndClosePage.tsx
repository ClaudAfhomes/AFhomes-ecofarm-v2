import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dialog,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import type { StatusTone } from '@afhomes/ui';
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
  });
  const periods = useQuery({
    queryKey: businessKeys.accountingPeriods,
    queryFn: getAccountingPeriods,
  });
  const record = periods.data?.find((p) => p.period === period);

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
    onError: (e) => setError(e instanceof Error ? e.message : 'The request failed.'),
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
    earlierOpen.length > 0
      ? 'Close earlier months first.'
      : submitterIsMe
        ? 'The submitter cannot close.'
        : null;

  const lines: { label: string; value: string; to?: string; note?: string }[] = s
    ? [
        {
          label: 'Verified',
          value: `${formatMoney(s.verifiedTotal)} · ${formatCountOrDash(s.verifiedCount)}`,
        },
        {
          label: 'Pending verification',
          value: formatCountOrDash(s.pendingVerification),
          to: PAYMENTS_PATH,
        },
        {
          label: 'Held for duplicate review',
          value: formatCountOrDash(s.heldForDuplicateReview),
          to: PAYMENTS_PATH,
        },
        {
          label: 'Proposed adjustments',
          value: formatCountOrDash(s.proposedAdjustments),
          to: PAYMENTS_PATH,
        },
        { label: 'Late postings', value: formatCountOrDash(s.latePostings) },
        {
          label: 'Earlier open months',
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

      <label className={styles.field}>
        Month
        <Select
          aria-label="Month"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
        />
      </label>

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

          <ul className={styles.checklist} aria-label="Pre-close checklist">
            {lines.map((line) => (
              <li key={line.label} className={styles.line}>
                <span>
                  {line.to ? <Link to={line.to}>{line.label}</Link> : line.label}
                  {line.note ? <span className={styles.note}> · {line.note}</span> : null}
                </span>
                <strong>{line.value}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>Counts are disclosed, not blocking.</p>

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
          ) : (
            <div className={styles.actions}>
              {canSubmit && status === 'open' ? (
                <Button onClick={() => open('submit')}>Submit for closing</Button>
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
          )}
        </>
      )}

      <h2 className={styles.heading}>History</h2>
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

      {confirm ? (
        <Dialog
          open
          onClose={() => setConfirm(null)}
          title={confirmTitle}
          footer={
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                loading={run.isPending}
                disabled={confirm === 'return' && reasonTooShort}
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
