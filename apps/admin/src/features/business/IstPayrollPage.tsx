import { addMoney, compareMoney, subtractMoney } from '@afhomes/shared';
import { PayrollLineDetailDialog } from './PayrollLineDetailDialog';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayrollBatchDetail, PayrollLine } from '@afhomes/contracts';
import {
  Alert,
  Button,
  ChoiceChips,
  Dialog,
  ErrorState,
  PageHeader,
  Select,
  SearchField,
  Skeleton,
  StatusChip,
  Tabs,
  TextField,
  notifySuccess,
} from '@afhomes/ui';

import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { formatMoney } from './format';
import { PayrollDisbursementDialog } from './PayrollDisbursementDialog';
import { PayrollLinesTable, plainReason } from './PayrollLinesTable';
import { PayrollReviewDialog } from './PayrollReviewDialog';
import { BATCH_STATUS_LABEL, BATCH_STATUS_TONE } from './payroll-status';
import { PayrollEngagementsRules } from './PayrollEngagementsRules';
import { PayrollPerformance } from './PayrollPerformance';
import { PayrollPolicies } from './PayrollPolicies';
import { PayrollSimulation } from './PayrollSimulation';
import {
  LIVE_LOCKED_REASON,
  REASON_MIN,
  errorMessage,
  hasPayrollPermission,
  payrollMonthLabel,
  payrollMonthOptions,
  q1BannerText,
} from './payroll-utils';
import {
  approvePayrollBatch,
  closePayrollBatch,
  generatePayrollDraft,
  getPayrollBatch,
  getPayrollBatches,
  getPayrollGate,
  payrollKeys,
  returnPayrollBatch,
  submitPayrollBatch,
} from './services-payroll';
import styles from './IstPayrollPage.module.css';

type Tab = 'live' | 'simulation' | 'policies' | 'engagements';

export function IstPayrollPage() {
  const { user } = useSession();
  const client = useQueryClient();
  const canView = hasPayrollPermission(user, 'finance.payroll', 'canView');
  const canCreate = hasPayrollPermission(user, 'finance.payroll', 'canCreate');
  const canUpdate = hasPayrollPermission(user, 'finance.payroll', 'canUpdate');
  const canApprove = hasPayrollPermission(user, 'finance.payroll_approval', 'canUpdate');
  const canClose = hasPayrollPermission(user, 'finance.payroll_close', 'canUpdate');

  const months = useMemo(() => payrollMonthOptions(), []);
  const [period, setPeriod] = useState(months[0] as string);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [rankFilter, setRankFilter] = useState('');
  const [lineFilter, setLineFilter] = useState('');
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('live');
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<PayrollLine | null>(null);
  const [reviewing, setReviewing] = useState<PayrollLine | null>(null);
  const [reconciling, setReconciling] = useState<PayrollLine | null>(null);

  const gate = useQuery({
    queryKey: payrollKeys.gate,
    queryFn: getPayrollGate,
    refetchInterval: 30000,
  });
  const batches = useQuery({
    queryKey: payrollKeys.batches(period),
    queryFn: () => getPayrollBatches(period),
    refetchInterval: 30000,
  });
  // Newest first from the server; simulations are never the live record.
  const live = batches.data?.find((b) => b.mode === 'live');
  const detail = useQuery({
    queryKey: payrollKeys.batch(live?.id ?? ''),
    queryFn: () => getPayrollBatch(live!.id),
    enabled: Boolean(live),
    refetchInterval: 15000,
  });

  const locked = !gate.isSuccess || !gate.data.liveAuthorized;

  const run = useBusinessMutation({
    mutationFn: async (kind: 'generate' | 'submit' | 'approve' | 'return' | 'close') => {
      if (kind === 'generate') return generatePayrollDraft(period);
      const id = live!.id;
      if (kind === 'submit') return submitPayrollBatch(id);
      if (kind === 'approve') return approvePayrollBatch(id);
      if (kind === 'close') return closePayrollBatch(id);
      return returnPayrollBatch(id, reason.trim());
    },
    onSuccess: async (_d, kind) => {
      setReturning(false);
      setReason('');
      setError(null);
      notifySuccess({
        title:
          kind === 'generate'
            ? 'Draft generated'
            : kind === 'submit'
              ? 'Submitted for approval'
              : kind === 'approve'
                ? 'Batch approved'
                : kind === 'close'
                  ? 'Batch closed'
                  : 'Batch returned',
      });
      await client.invalidateQueries({ queryKey: payrollKeys.all });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const d: PayrollBatchDetail | undefined = detail.data;
  const status = live?.status;
  const allLines = d?.lines ?? [];
  const viewing = allLines.find((line) => line.id === viewingId);
  const filteredLines = allLines.filter((line) => {
    const term = employeeSearch.trim().toLocaleLowerCase();
    return (
      (!term || `${line.staffName ?? ''} ${line.staffId}`.toLocaleLowerCase().includes(term)) &&
      (!rankFilter || line.rank === rankFilter) &&
      (!lineFilter ||
        (lineFilter === 'blocked'
          ? line.status === 'blocked'
          : lineFilter === 'review'
            ? line.reviewRequired && !line.reviewedAt
            : lineFilter === 'paid'
              ? Boolean(line.disbursement)
              : line.status === 'computed' &&
                !line.disbursement &&
                line.net !== null &&
                compareMoney(line.net, '0.00') > 0))
    );
  });
  const paidTotal = allLines.reduce(
    (total, line) => addMoney(total, line.disbursement?.amount ?? '0.00'),
    '0.00',
  );
  const outstanding =
    d && compareMoney(d.totalNet, paidTotal) > 0 ? subtractMoney(d.totalNet, paidTotal) : '0.00';
  const attentionCount = allLines.filter(
    (line) =>
      line.status === 'blocked' ||
      (line.reviewRequired && !line.reviewedAt) ||
      (line.disbursement?.evidenceChanged && !line.disbursement.reconciled),
  ).length;

  const submitterIsMe = Boolean(live?.submittedBy && live.submittedBy === user?.id);
  const blocked = live?.blockedLineCount ?? 0;

  const unreviewed = (d?.lines ?? []).filter((l) => l.reviewRequired && !l.reviewedAt).length;
  const blockedReasons = [
    ...new Set(
      (d?.lines ?? [])
        .filter((l) => l.status === 'blocked')
        .map((l) => plainReason(l.blockedReason)),
    ),
  ];
  const q1Banner = gate.data ? q1BannerText(gate.data) : null;

  const submitBlock = locked
    ? (gate.data?.note ?? LIVE_LOCKED_REASON)
    : blocked > 0
      ? `${blocked} ${blocked === 1 ? 'line needs' : 'lines need'} configuration`
      : unreviewed > 0
        ? `${unreviewed} flagged ${unreviewed === 1 ? 'line needs' : 'lines need'} a review note before submit`
        : (live?.lineCount ?? 0) === 0
          ? 'There are no staff lines to pay.'
          : null;
  const approveBlock = submitterIsMe
    ? 'You submitted this batch. Another approver must decide.'
    : null;

  const primary = () => {
    if (!live || status === 'returned') {
      if (!canCreate)
        return (
          <p role="note">
            Your role cannot generate payroll drafts. Finance prepares the batch; Super Admin
            reviews submitted batches.
          </p>
        );
      return (
        <ActionRow note={locked ? LIVE_LOCKED_REASON : null}>
          <Button loading={run.isPending} disabled={locked} onClick={() => run.mutate('generate')}>
            {status === 'returned' ? 'Regenerate draft' : 'Generate draft'}
          </Button>
        </ActionRow>
      );
    }
    if (status === 'draft') {
      if (!canUpdate)
        return (
          <p role="note">
            Finance must submit this draft before approval actions become available.
          </p>
        );
      return (
        <ActionRow note={submitBlock}>
          <Button
            loading={run.isPending}
            disabled={submitBlock !== null}
            onClick={() => run.mutate('submit')}
          >
            Submit for approval
          </Button>
        </ActionRow>
      );
    }
    if (status === 'submitted') {
      if (!canApprove) return <p className={styles.waiting}>Waiting for Super Admin approval</p>;
      return (
        <ActionRow note={approveBlock}>
          <Button
            loading={run.isPending}
            disabled={approveBlock !== null}
            onClick={() => run.mutate('approve')}
          >
            Approve
          </Button>
          <Button variant="secondary" onClick={() => setReturning(true)}>
            Return
          </Button>
        </ActionRow>
      );
    }
    if (status === 'approved' && canClose) {
      return (
        <ActionRow note={submitterIsMe ? 'The submitter cannot close.' : null}>
          <Button
            loading={run.isPending}
            disabled={submitterIsMe}
            onClick={() => run.mutate('close')}
          >
            Close batch
          </Button>
        </ActionRow>
      );
    }
    return (
      <p role="note">
        {status === 'closed'
          ? 'This batch is closed. Its history is read-only.'
          : 'This batch is approved. Finance records payment, then an authorized reviewer reconciles and closes it.'}
      </p>
    );
  };

  const reasonTooShort = reason.trim().length < REASON_MIN;

  return (
    <section className={styles.shell}>
      <PageHeader title="IST Payroll" description="Generate, approve and pay the monthly batch." />

      {!canView ? null : (
        <>
          <Tabs
            ariaLabel="Payroll view"
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            items={[
              { value: 'live', label: 'Live payroll' },
              { value: 'simulation', label: 'Simulation' },
              { value: 'policies', label: 'Policies' },
              { value: 'engagements', label: 'Engagements & rules' },
            ]}
          />

          {gate.isError ? <ErrorState error={gate.error} onRetry={gate.refetch} /> : null}
          {gate.data && locked ? (
            <Alert variant="warning" title="Live payroll is locked">
              {gate.data.note ?? LIVE_LOCKED_REASON}
            </Alert>
          ) : q1Banner ? (
            <details className={styles.contextDetails}>
              <summary>Compensation model: owner-reported</summary>
              <p>{q1Banner}</p>
            </details>
          ) : null}

          {tab === 'policies' ? (
            <PayrollPolicies />
          ) : tab === 'engagements' ? (
            <PayrollEngagementsRules />
          ) : tab === 'simulation' ? (
            <PayrollSimulation
              period={period}
              months={months}
              onPeriodChange={setPeriod}
              canRun={canCreate}
              liveLines={d?.lines ?? []}
              userId={user?.id}
              canSubmit={canUpdate}
              canApprove={canApprove}
              canClose={canClose}
            />
          ) : (
            <>
              <label className={styles.field}>
                Month
                <Select
                  aria-label="Month"
                  name="payrollMonth"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  options={months.map((m) => ({ value: m, label: payrollMonthLabel(m) }))}
                />
              </label>

              {batches.isPending ? (
                <Skeleton style={{ height: 160 }} />
              ) : batches.isError ? (
                <ErrorState error={batches.error} onRetry={batches.refetch} />
              ) : (
                <>
                  <div className={styles.statusRow}>
                    {live ? (
                      <>
                        <StatusChip
                          label={BATCH_STATUS_LABEL[live.status]}
                          tone={BATCH_STATUS_TONE[live.status]}
                        />
                        <span className={styles.muted}>
                          {live.lineCount} lines · Net {formatMoney(live.totalNet)}
                        </span>
                      </>
                    ) : (
                      <span className={styles.muted}>
                        No payroll batch for {payrollMonthLabel(period)} yet.
                      </span>
                    )}
                  </div>

                  {live?.status === 'returned' && live.returnReason ? (
                    <Alert variant="warning" title="Returned">
                      {live.returnReason}
                    </Alert>
                  ) : null}

                  {blocked > 0 ? (
                    <Alert variant="warning" title="Some lines are blocked">
                      <p className={styles.compactText}>
                        {blocked} staff {blocked === 1 ? 'line needs' : 'lines need'} setup before
                        this batch can be submitted.
                      </p>
                      <details className={styles.issueDetails}>
                        <summary>View configuration issues</summary>
                        <ul>
                          {blockedReasons.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </details>
                    </Alert>
                  ) : null}
                  {unreviewed > 0 ? (
                    <p className={styles.muted}>
                      Submission is blocked until every flagged line has a review note.
                    </p>
                  ) : null}

                  {!live || blocked > 0 ? (
                    <section aria-label="Payroll setup" className={styles.stack}>
                      {!live ? (
                        <p className={styles.muted}>
                          Set the company rates in Policies, then approve the IST engagements and
                          performance rule in Engagements &amp; rules. Verified performance evidence
                          supplies the figures for each monthly calculation.
                        </p>
                      ) : null}
                      <div className={styles.actions}>
                        <Button variant="secondary" onClick={() => setTab('policies')}>
                          Review compensation policies
                        </Button>
                        <Button variant="secondary" onClick={() => setTab('engagements')}>
                          Review engagements and rules
                        </Button>
                      </div>
                    </section>
                  ) : null}
                  <div className={styles.actions}>
                    {primary()}
                    {status === 'draft' && canCreate ? (
                      <Button
                        variant="secondary"
                        disabled={locked || run.isPending}
                        onClick={() => run.mutate('generate')}
                      >
                        Refresh calculations
                      </Button>
                    ) : null}
                  </div>
                  {d ? (
                    <section aria-label="Payroll summary" className={styles.summaryGrid}>
                      <div>
                        <span>Calculated employees</span>
                        <strong>{d.computedLineCount}</strong>
                        <small>{d.lineCount} staff lines in batch</small>
                      </div>
                      <div>
                        <span>Calculated payroll</span>
                        <strong>
                          {d.computedLineCount === 0 ? 'Not calculated' : formatMoney(d.totalNet)}
                        </strong>
                        <small>
                          {d.computedLineCount === 0
                            ? 'Complete setup and refresh calculations.'
                            : `BA ${formatMoney(d.totalBa)} / PA ${formatMoney(d.totalPa)} / PB ${formatMoney(d.totalPb)}`}
                        </small>
                      </div>
                      <div>
                        <span>Needs attention</span>
                        <strong>{attentionCount}</strong>
                        <small>Configuration, review or evidence exceptions</small>
                      </div>
                      <div>
                        <span>
                          {d.status === 'approved' || d.status === 'closed'
                            ? 'Outstanding payroll'
                            : 'Draft amount'}
                        </span>
                        <strong>{formatMoney(outstanding)}</strong>
                        <small>
                          Recorded paid {formatMoney(paidTotal)} / {BATCH_STATUS_LABEL[d.status]}
                        </small>
                      </div>
                    </section>
                  ) : null}

                  {error && !returning && !paying ? (
                    <Alert variant="danger" title="Not done">
                      {error}
                    </Alert>
                  ) : null}

                  {live ? (
                    detail.isPending ? (
                      <Skeleton style={{ height: 200 }} />
                    ) : detail.isError ? (
                      <ErrorState error={detail.error} onRetry={detail.refetch} />
                    ) : (
                      <>
                        <div
                          className={styles.lineFilters}
                          role="search"
                          aria-label="Payroll employee filters"
                        >
                          <SearchField
                            label="Search payroll employees"
                            value={employeeSearch}
                            onChange={setEmployeeSearch}
                            placeholder="Employee name or staff ID"
                          />
                          <div className={styles.chipField}>
                            <span aria-hidden="true">Position</span>
                            <ChoiceChips
                              label="Payroll position"
                              value={rankFilter}
                              onChange={setRankFilter}
                              options={[
                                { value: '', label: 'All' },
                                ...['SM', 'SSM', 'SVD'].map((value) => ({ value, label: value })),
                              ]}
                            />
                          </div>
                          <label>
                            Status
                            <Select
                              aria-label="Payroll line status"
                              value={lineFilter}
                              onChange={(event) => setLineFilter(event.target.value)}
                              options={[
                                { value: '', label: 'All lines' },
                                { value: 'blocked', label: 'Configuration blocked' },
                                { value: 'review', label: 'Unreviewed exceptions' },
                                { value: 'unpaid', label: 'Awaiting payment' },
                                { value: 'paid', label: 'Payment recorded' },
                              ]}
                            />
                          </label>
                          {employeeSearch || rankFilter || lineFilter ? (
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setEmployeeSearch('');
                                setRankFilter('');
                                setLineFilter('');
                              }}
                            >
                              Clear employee filters
                            </Button>
                          ) : null}
                        </div>
                        {filteredLines.length === 0 && allLines.length > 0 ? (
                          <p>No employees match these filters.</p>
                        ) : (
                          <PayrollLinesTable
                            lines={filteredLines}
                            onView={(line) => setViewingId(line.id)}
                            onDisburse={
                              status === 'approved' && canUpdate
                                ? (line) => {
                                    setError(null);
                                    setPaying(line);
                                  }
                                : undefined
                            }
                            disburseBlock={locked ? LIVE_LOCKED_REASON : null}
                            onReconcile={
                              status === 'approved' && canClose ? setReconciling : undefined
                            }
                            onReview={
                              status === 'draft' && canUpdate && !locked
                                ? (line) => {
                                    setError(null);
                                    setReviewing(line);
                                  }
                                : undefined
                            }
                          />
                        )}
                      </>
                    )
                  ) : null}
                </>
              )}
              <PayrollPerformance period={period} />
            </>
          )}
        </>
      )}

      {viewing ? (
        <PayrollLineDetailDialog
          line={viewing}
          onClose={() => setViewingId(null)}
          action={
            status === 'draft' &&
            canUpdate &&
            viewing.reviewRequired &&
            !viewing.reviewedAt &&
            !locked ? (
              <Button
                onClick={() => {
                  setViewingId(null);
                  setReviewing(viewing);
                }}
              >
                Record review
              </Button>
            ) : status === 'approved' &&
              canUpdate &&
              !viewing.disbursement &&
              viewing.net &&
              compareMoney(viewing.net, '0.00') > 0 &&
              !locked ? (
              <Button
                onClick={() => {
                  setViewingId(null);
                  setPaying(viewing);
                }}
              >
                Record disbursement
              </Button>
            ) : status === 'approved' &&
              canClose &&
              viewing.disbursement?.evidenceChanged &&
              !viewing.disbursement.reconciled ? (
              <Button
                onClick={() => {
                  setViewingId(null);
                  setReconciling(viewing);
                }}
              >
                Review reconciliation
              </Button>
            ) : null
          }
        />
      ) : null}
      {returning ? (
        <Dialog
          open
          onClose={() => setReturning(false)}
          title="Return batch"
          footer={
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setReturning(false)}>
                Cancel
              </Button>
              <Button
                loading={run.isPending}
                disabled={reasonTooShort}
                onClick={() => run.mutate('return')}
              >
                Return batch
              </Button>
            </div>
          }
        >
          <TextField
            id="payroll-return-reason"
            name="reason"
            label="Reason"
            value={reason}
            onChange={setReason}
            hint={`At least ${REASON_MIN} characters.`}
          />
          {error ? (
            <Alert variant="danger" title="Not done">
              {error}
            </Alert>
          ) : null}
        </Dialog>
      ) : null}

      {reviewing ? (
        <PayrollReviewDialog
          line={reviewing}
          onClose={() => setReviewing(null)}
          onDone={async () => {
            setReviewing(null);
            notifySuccess({ title: 'Review recorded' });
            await client.invalidateQueries({ queryKey: payrollKeys.all });
          }}
        />
      ) : null}

      {reconciling ? (
        <PayrollReviewDialog
          line={reconciling}
          reconciliation
          onClose={() => setReconciling(null)}
          onDone={async () => {
            setReconciling(null);
            notifySuccess({ title: 'Reconciliation review recorded' });
            await client.invalidateQueries({ queryKey: payrollKeys.all });
          }}
        />
      ) : null}
      {paying ? (
        <PayrollDisbursementDialog
          line={paying}
          onClose={() => setPaying(null)}
          onDone={async () => {
            setPaying(null);
            notifySuccess({ title: 'Disbursement recorded' });
            await client.invalidateQueries({ queryKey: payrollKeys.all });
          }}
        />
      ) : null}
    </section>
  );
}

function ActionRow({ note, children }: { note: string | null; children: React.ReactNode }) {
  return (
    <div className={styles.actions}>
      {children}
      {note ? <span className={styles.muted}>{note}</span> : null}
    </div>
  );
}
