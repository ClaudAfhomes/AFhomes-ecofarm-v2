import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  DetailField,
  DetailFieldGrid,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextAreaField,
  TextField,
  type StatusTone,
} from '@afhomes/ui';
import type { Commission } from '@afhomes/contracts';

import { formatDate, formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { canViewModule } from '../../app/navigation';
import { formatRate } from './format';
import { formatCount, formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { getCommissions, markCommissionPaid, qualifyCommission } from './services';
import { businessKeys } from './queryKeys';
import styles from './BusinessCommissionsPage.module.css';

const STATUSES = [
  '',
  'pending',
  'payment_verified',
  'final_qualification_pending',
  'earned',
  'paid',
  'cancelled',
] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  payment_verified: 'Payment verified',
  final_qualification_pending: 'Awaiting final qualification',
  earned: 'Earned',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<string, StatusTone> = {
  pending: 'warning',
  payment_verified: 'info',
  final_qualification_pending: 'warning',
  earned: 'success',
  paid: 'success',
  cancelled: 'danger',
};

/** Recorded lifecycle instants, oldest first; the last one is the current step. */
function progressSteps(commission: Commission) {
  return [
    { label: 'Created', at: commission.createdAt },
    {
      label: commission.status === 'cancelled' ? 'Cancelled' : 'Qualified',
      at: commission.qualifiedAt,
    },
    { label: 'Earned', at: commission.earnedAt },
    { label: 'Paid', at: commission.paidAt },
  ].filter((step): step is { label: string; at: string } => Boolean(step.at));
}

function canDecideCommissions(
  permissions: { moduleKey: string; canUpdate: boolean }[] | undefined,
) {
  return permissions?.some((p) => p.moduleKey === 'network.commissions' && p.canUpdate) === true;
}

/**
 * Commission management.
 *
 * Amounts come from the frozen sale snapshot and the single applicable
 * account/role rule (or 0% default), and
 * never move after creation. Only the status moves, through explicit audited
 * decisions: `final_qualification_pending -> earned` (qualification) and
 * `earned -> paid` (payout record). Every other transition is rejected by the
 * server; the buttons below never offer an impossible action.
 */
export function BusinessCommissionsPage() {
  const client = useQueryClient();
  const { user } = useSession();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [seller, setSeller] = useState('');
  const [applied, setApplied] = useState<{ status?: string; search?: string; seller?: string }>({});
  // Live search: text follows the settled term automatically; selects and the
  // Apply button apply instantly; Clear resets everything.
  const applyFilters = (explicit: { status: string; search: string; seller: string }) =>
    setApplied((current) => {
      const next = {
        ...(explicit.status ? { status: explicit.status } : {}),
        ...(explicit.search ? { search: explicit.search } : {}),
        ...(explicit.seller ? { seller: explicit.seller } : {}),
      };
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  void useDebouncedValue(search.trim(), 300, (term) =>
    applyFilters({ status, search: term, seller: seller.trim() }),
  );
  void useDebouncedValue(seller.trim(), 300, (term) =>
    applyFilters({ status, search: search.trim(), seller: term }),
  );
  const mayMutate = canDecideCommissions(user?.afHomesPermissions);
  // Sellers are scoped server-side to their own commissions; the seller filter
  // is only useful for Finance/Admin who see every row.
  const mayFilterBySeller =
    canViewModule(user?.afHomesPermissions, 'finance.payment_verification') ||
    canViewModule(user?.afHomesPermissions, 'finance.card_activation');

  const query = useQuery({
    queryKey: businessKeys.commissions(applied),
    queryFn: () => getCommissions(applied),
    // Keep the previous page on screen while the next filter lands: refetches
    // then feel instant and the skeleton only ever appears on first load.
    placeholderData: keepPreviousData,
    // Qualification and payout decisions land from review screens and other
    // sessions; the Apply-time snapshot refreshes without reload.
    refetchInterval: 30_000,
  });

  const [qualifying, setQualifying] = useState<Commission | null>(null);
  const [paying, setPaying] = useState<Commission | null>(null);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  // Headline counts from the loaded rows.
  const summary = useMemo(() => {
    const awaiting = rows.filter((c) => c.status === 'final_qualification_pending').length;
    const earned = rows.filter((c) => c.status === 'earned').length;
    const paid = rows.filter((c) => c.status === 'paid').length;
    return { total: rows.length, awaiting, earned, paid };
  }, [rows]);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: businessKeys.commissionsScope });
  };

  // First load skeletonizes the whole page: header, summary, filters and
  // table. Refetches keep the previous page visible via placeholderData and
  // never reach this branch.
  if (query.isPending)
    return (
      <section className={styles.page}>
        <div className={styles.skeleton} role="status" aria-label="Loading commissions">
          <div className={styles.skeletonHead}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 320 }} />
          </div>
          <div className={styles.summary}>
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 120 }} />
          </div>
          <Skeleton style={{ height: 48 }} />
          <div className={styles.skeletonRows}>
            <Skeleton style={{ height: 72 }} />
            <Skeleton style={{ height: 72 }} />
            <Skeleton style={{ height: 72 }} />
            <Skeleton style={{ height: 72 }} />
          </div>
        </div>
      </section>
    );

  const filtered = Boolean(applied.status || applied.search || applied.seller);

  return (
    <section className={styles.page}>
      <PageHeader title="Commissions" description="Track decisions and payouts." />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <>
          <section className={styles.summaryBlock} aria-label="Commission summary">
            <div className={styles.summary}>
              <MetricCard
                label="Needs decision"
                value={formatCountOrDash(summary.awaiting)}
                description="Ready for your review."
                icon="clock"
              />
              <MetricCard
                label="Ready to pay"
                value={formatCountOrDash(summary.earned)}
                description="Earned, not yet paid."
                icon="wallet"
              />
              <MetricCard
                label="Paid out"
                value={formatCountOrDash(summary.paid)}
                description="Payout recorded."
                icon="dollar-sign"
              />
            </div>
            {filtered ? <p className={styles.summaryNote}>Counts follow your filters.</p> : null}
          </section>

          <FilterBar
            filtersToggleLabel="Expand Filters"
            search={
              <SearchField
                label="Search commissions"
                placeholder="SALE-000001 or seller name"
                value={search}
                onChange={setSearch}
                busy={query.isFetching}
              />
            }
            filters={
              <>
                <div className={styles.statusFilter}>
                  <Select
                    aria-label="Filter by status"
                    value={status}
                    onChange={(e) => {
                      const next = e.target.value;
                      setStatus(next);
                      applyFilters({ status: next, search: search.trim(), seller: seller.trim() });
                    }}
                    options={[
                      { value: '', label: 'All statuses' },
                      ...STATUSES.filter(Boolean).map((value) => ({
                        value,
                        label: STATUS_LABEL[value] ?? value,
                      })),
                    ]}
                  />
                </div>
                {mayFilterBySeller ? (
                  <div className={styles.sellerFilter}>
                    <SearchField
                      label="Filter by seller"
                      placeholder="Staff or OST id"
                      value={seller}
                      onChange={setSeller}
                    />
                  </div>
                ) : null}
              </>
            }
            actions={
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    applyFilters({ status, search: search.trim(), seller: seller.trim() })
                  }
                >
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearch('');
                    setStatus('');
                    setSeller('');
                    setApplied({});
                  }}
                >
                  Clear
                </Button>
              </>
            }
          />

          <div className={styles.resultsHead}>
            <h2 className={styles.resultsTitle}>
              {formatCount(rows.length)} {rows.length === 1 ? 'commission' : 'commissions'}
            </h2>
            <span className={styles.refreshing} aria-live="polite">
              {query.isPlaceholderData ? 'Updating results…' : ''}
            </span>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title={applied.search ? 'No matching records.' : 'No commissions'}
              description={filtered ? 'Try other filters.' : 'None recorded yet.'}
            />
          ) : (
            <div
              role="region"
              aria-label="Scrollable records"
              tabIndex={0}
              className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
            >
              <table className={styles.queueTable}>
                <thead>
                  <tr>
                    <th scope="col">Commission</th>
                    <th scope="col">Beneficiary</th>
                    <th scope="col" className={styles.numeric}>
                      Amount
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Progress</th>
                    <th scope="col" className={styles.actionHead}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((commission) => {
                    const action =
                      !mayMutate ? null : commission.status === 'final_qualification_pending' ? (
                        <Button size="sm" onClick={() => setQualifying(commission)}>
                          Decide
                        </Button>
                      ) : commission.status === 'earned' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPaying(commission)}
                        >
                          Mark Paid
                        </Button>
                      ) : null;
                    return (
                      <tr
                        key={commission.id}
                        data-attention={
                          commission.status === 'final_qualification_pending' || undefined
                        }
                      >
                        <td data-label="Commission" className={styles.refCell}>
                          <span className={styles.recordRef}>
                            <span className={styles.recordRefDot} aria-hidden="true" />
                            {commission.commissionNumber ?? '—'}
                          </span>
                          <span className={styles.secondary}>{commission.saleNumber}</span>
                        </td>
                        <td data-label="Beneficiary" className={styles.beneficiaryCell}>
                          <span className={styles.primary}>{commission.beneficiaryName}</span>
                          <span className={styles.secondary}>
                            {commission.beneficiaryType === 'ost' ? 'OST' : 'Staff'}
                          </span>
                        </td>
                        <td data-label="Amount" className={`${styles.numeric} ${styles.amountCell}`}>
                          <span className={styles.amount}>
                            {formatMoneyOrDash(commission.amount)}
                          </span>
                          <span className={styles.secondary}>
                            {`${formatRate(commission.rate)} of ${formatMoneyOrDash(commission.basisAmount)}`}
                          </span>
                        </td>
                        <td data-label="Status" className={styles.statusCell}>
                          <StatusChip
                            label={STATUS_LABEL[commission.status] ?? commission.status}
                            tone={STATUS_TONE[commission.status] ?? 'warning'}
                            icon={commission.status === 'cancelled' ? 'close' : undefined}
                          />
                        </td>
                        <td data-label="Progress" className={styles.progressCell}>
                          <ol className={styles.steps}>
                            {progressSteps(commission).map((step, index, all) => (
                              <li key={step.label}>
                                <span className={styles.stepLabel}>{step.label}</span>
                                {/* Earlier steps show the day; the current step adds the time. */}
                                <time dateTime={step.at}>
                                  {index === all.length - 1
                                    ? formatDateTime(step.at)
                                    : formatDate(step.at)}
                                </time>
                              </li>
                            ))}
                          </ol>
                        </td>
                        <td data-label="Action" className={styles.actionCell}>
                          {action ?? (
                            <span className={styles.secondary}>
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">No action needed</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {qualifying ? (
        <QualifyDialog
          commission={qualifying}
          onClose={() => setQualifying(null)}
          onDone={async () => {
            setQualifying(null);
            await refresh();
          }}
        />
      ) : null}
      {paying ? (
        <MarkPaidDialog
          commission={paying}
          onClose={() => setPaying(null)}
          onDone={async () => {
            setPaying(null);
            await refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function QualifyDialog({
  commission,
  onClose,
  onDone,
}: {
  commission: Commission;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<'earned' | 'cancelled'>('earned');
  const decide = useBusinessMutation({
    mutationFn: () => qualifyCommission(commission.id, { decision, notes }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Final qualification decision"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={notes.trim().length < 5 || decide.isPending}
            onClick={() => decide.mutate()}
          >
            Record decision
          </Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <CommissionFacts commission={commission} />
        <p className={styles.formNote}>
          This decision is final. Your notes and name are recorded. The amount stays unchanged.
        </p>
        <label className={styles.filterLabel}>
          Decision
          <Select
            aria-label="Decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value as 'earned' | 'cancelled')}
            options={[
              { value: 'earned', label: 'Qualify: commission earned' },
              { value: 'cancelled', label: 'Cancel: commission cancelled' },
            ]}
          />
        </label>
        <div className={styles.fullRow}>
          <TextAreaField
            id="commission-decision-notes"
            name="decisionNotes"
            label="Notes"
            hint="At least 5 characters. Recorded with your identity."
            value={notes}
            onChange={setNotes}
          />
        </div>
        {decide.error ? (
          <p role="alert" className={styles.formAlert}>
            {decide.error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function MarkPaidDialog({
  commission,
  onClose,
  onDone,
}: {
  commission: Commission;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [reference, setReference] = useState('');
  const pay = useBusinessMutation({
    mutationFn: () =>
      markCommissionPaid(commission.id, reference.trim() ? { reference: reference.trim() } : {}),
    onSuccess: onDone,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Mark commission paid"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pay.isPending} onClick={() => pay.mutate()}>
            Mark Paid
          </Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <CommissionFacts commission={commission} />
        <p className={styles.formNote}>
          This records who paid, and when. The amount stays unchanged.
        </p>
        <TextField
          id="commission-payment-reference"
          name="paymentReference"
          label="Payment reference"
          optional
          value={reference}
          onChange={setReference}
        />
        {pay.error ? (
          <p role="alert" className={styles.formAlert}>
            {pay.error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function CommissionFacts({ commission }: { commission: Commission }) {
  return (
    <DetailFieldGrid className={styles.facts}>
      <DetailField label="Commission">{commission.commissionNumber ?? '—'}</DetailField>
      <DetailField label="Sale">{commission.saleNumber}</DetailField>
      <DetailField label="Beneficiary">{commission.beneficiaryName}</DetailField>
      <DetailField label="Amount">
        <strong className={styles.factAmount}>{formatMoneyOrDash(commission.amount)}</strong>
      </DetailField>
    </DetailFieldGrid>
  );
}
