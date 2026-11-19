import { Link } from 'react-router';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  ChoiceChips,
  DateField,
  DetailField,
  DetailFieldGrid,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
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
import { addMoney, formatCount, formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { getCommissions, markCommissionPaid, qualifyCommission } from './services';
import { businessKeys } from './queryKeys';
import { CommissionOpsDialog } from './CommissionOpsDialog';
import { CommissionDetailDialog } from './CommissionDetailDialog';
import { manilaToday } from './payroll-utils';

const PAYOUT_METHODS = ['Bank transfer', 'Cheque', 'Cash', 'E-wallet'] as const;
/** markCommissionPaidSchema's sanity floor against typos (e.g. year 0026). */
const EARLIEST_PAYMENT_DATE = '2000-01-01';
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
  const mayPay =
    user?.afHomesPermissions.some(
      (p) => p.moduleKey === 'finance.commission_payouts' && p.canUpdate,
    ) === true;
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
  const [managing, setManaging] = useState<Commission | null>(null);
  const [viewingSnapshot, setViewing] = useState<Commission | null>(null);
  // The commission contract carries no hold field, so holds placed or released in
  // this session are tracked here (id -> reason). The server still enforces them.
  const [held, setHeld] = useState<Record<string, string | null>>({});
  /** Server state, overridden by a hold placed or released in this session until refetch. */
  const heldReasonOf = (c: Commission) =>
    c.id in held ? (held[c.id] ?? null) : (c.withheldReason ?? null);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  // An open detail follows the refreshed row (polling, decisions from other sessions), so
  // it never offers an action on a stale status. The snapshot covers a row a filter dropped.
  const viewing = viewingSnapshot
    ? (rows.find((c) => c.id === viewingSnapshot.id) ?? viewingSnapshot)
    : null;
  // Headline counts from the loaded rows.
  const summary = useMemo(() => {
    const awaiting = rows.filter((c) => c.status === 'final_qualification_pending').length;
    const earned = rows.filter((c) => c.status === 'earned').length;
    const paid = rows.filter((c) => c.status === 'paid').length;
    const amountFor = (statuses: Commission['status'][]) =>
      rows
        .filter((c) => statuses.includes(c.status))
        .reduce((sum, c) => addMoney(sum, c.amount), '0.00');
    return {
      total: rows.length,
      awaiting,
      earned,
      paid,
      eligibleAmount: amountFor([
        'payment_verified',
        'final_qualification_pending',
        'earned',
        'paid',
      ]),
      awaitingAmount: amountFor(['final_qualification_pending']),
      earnedAmount: amountFor(['earned']),
      paidAmount: amountFor(['paid']),
    };
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
          <ul className={styles.badges} aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index}>
                <Skeleton style={{ height: 24, width: '10rem', borderRadius: '999px' }} />
              </li>
            ))}
          </ul>
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
            <ul className={styles.badges}>
              <li>
                <StatusChip
                  label={`Needs decision: ${formatCountOrDash(summary.awaiting)}`}
                  tone="warning"
                  icon="clock"
                />
              </li>
              <li>
                <StatusChip
                  label={`Ready to pay: ${formatCountOrDash(summary.earned)}`}
                  tone="info"
                  icon="wallet"
                />
              </li>
              <li>
                <StatusChip
                  label={`Paid out: ${formatCountOrDash(summary.paid)}`}
                  tone="success"
                  icon="dollar-sign"
                />
              </li>
            </ul>
            <p className={styles.summaryNote}>
              Displayed records: eligible {formatMoneyOrDash(summary.eligibleAmount)} / awaiting
              decision {formatMoneyOrDash(summary.awaitingAmount)} / approved unpaid{' '}
              {formatMoneyOrDash(summary.earnedAmount)} / paid{' '}
              {formatMoneyOrDash(summary.paidAmount)}. Eligible includes later approved and paid
              stages; these figures are not additive.
            </p>
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
                  onClick={() => {
                    applyFilters({ status, search: search.trim(), seller: seller.trim() });
                    void client.invalidateQueries({ queryKey: businessKeys.commissionsScope });
                  }}
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
                    void client.invalidateQueries({ queryKey: businessKeys.commissionsScope });
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
                    const heldReason = heldReasonOf(commission);
                    const manage =
                      (mayMutate || mayPay) &&
                      (commission.status === 'earned' || commission.status === 'paid') ? (
                        <Button size="sm" variant="ghost" onClick={() => setManaging(commission)}>
                          {mayMutate ? 'Hold, payouts & recovery' : 'Commission Payouts'}
                        </Button>
                      ) : null;
                    const primary =
                      mayMutate && commission.status === 'final_qualification_pending' ? (
                        <Button size="sm" onClick={() => setQualifying(commission)}>
                          Qualify Commission
                        </Button>
                      ) : mayPay && commission.status === 'earned' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={heldReason !== null}
                          title={heldReason !== null ? `On hold: ${heldReason}` : undefined}
                          onClick={() => setPaying(commission)}
                        >
                          Record External Commission Payment
                        </Button>
                      ) : null;
                    const action =
                      primary || manage ? (
                        <>
                          {primary}
                          {manage}
                          {heldReason !== null ? (
                            <span className={styles.secondary}>On hold: {heldReason}</span>
                          ) : null}
                        </>
                      ) : null;
                    return (
                      <tr
                        key={commission.id}
                        data-attention={
                          commission.status === 'final_qualification_pending' || undefined
                        }
                      >
                        <td data-label="Commission" className={styles.refCell}>
                          <button
                            type="button"
                            className={`${styles.recordRef} ${styles.recordRefButton}`}
                            aria-label={`View details for commission ${commission.commissionNumber ?? commission.saleNumber}`}
                            onClick={() => setViewing(commission)}
                          >
                            <span className={styles.recordRefDot} aria-hidden="true" />
                            {commission.commissionNumber ?? '—'}
                          </button>
                          <span className={styles.secondary}>{commission.saleNumber}</span>
                        </td>
                        <td data-label="Beneficiary" className={styles.beneficiaryCell}>
                          <span className={styles.primary}>{commission.beneficiaryName}</span>
                          <span className={styles.secondary}>
                            {commission.beneficiaryType === 'ost' ? 'OST' : 'Staff'}
                          </span>
                        </td>
                        <td
                          data-label="Amount"
                          className={`${styles.numeric} ${styles.amountCell}`}
                        >
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
                              {commission.status === 'payment_verified' ? (
                                <>
                                  Activation is required before qualification.
                                  {canViewModule(
                                    user?.afHomesPermissions,
                                    'finance.card_activation',
                                  ) ? (
                                    <>
                                      {' '}
                                      <Link to="/admin/finance/activation">View activation</Link>
                                    </>
                                  ) : null}
                                </>
                              ) : commission.status === 'pending' ? (
                                'Waiting for verified payment.'
                              ) : commission.status === 'cancelled' ? (
                                'Cancelled.'
                              ) : commission.status === 'paid' ? (
                                'Payment recorded.'
                              ) : (
                                'Your role cannot perform the next action.'
                              )}
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

      {viewing ? (
        <CommissionDetailDialog
          commission={viewing}
          recordsPayouts={mayPay}
          heldReason={heldReasonOf(viewing)}
          onClose={() => setViewing(null)}
          action={
            mayMutate && viewing.status === 'final_qualification_pending' ? (
              <Button
                onClick={() => {
                  setQualifying(viewing);
                  setViewing(null);
                }}
              >
                Qualify Commission
              </Button>
            ) : mayPay && viewing.status === 'earned' && heldReasonOf(viewing) === null ? (
              <Button
                onClick={() => {
                  setPaying(viewing);
                  setViewing(null);
                }}
              >
                Record External Commission Payment
              </Button>
            ) : undefined
          }
        />
      ) : null}
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
      {managing ? (
        <CommissionOpsDialog
          commission={managing}
          heldReason={heldReasonOf(managing)}
          onHeldChange={(reason) => setHeld((current) => ({ ...current, [managing.id]: reason }))}
          onClose={() => setManaging(null)}
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
      title="Qualify Commission"
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
        <div className={styles.filterLabel}>
          <span aria-hidden="true">Decision</span>
          <ChoiceChips
            label="Decision"
            value={decision}
            onChange={(next) => setDecision(next as 'earned' | 'cancelled')}
            options={[
              { value: 'earned', label: 'Qualify: commission earned' },
              { value: 'cancelled', label: 'Cancel: commission cancelled' },
            ]}
          />
        </div>
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
  const [method, setMethod] = useState<string>(PAYOUT_METHODS[0]);
  const [paidOn, setPaidOn] = useState(manilaToday());
  const [evidence, setEvidence] = useState('');
  const pay = useBusinessMutation({
    mutationFn: () =>
      markCommissionPaid(commission.id, {
        reference: reference.trim(),
        method,
        paidOn,
        evidenceReference: evidence.trim(),
      }),
    onSuccess: onDone,
  });
  // Same limits as markCommissionPaidSchema; the server re-checks every one of them.
  const today = manilaToday();
  const dateProblem = !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)
    ? null // empty or incomplete: the required field speaks for itself
    : paidOn > today
      ? 'The payment date cannot be in the future.'
      : paidOn < EARLIEST_PAYMENT_DATE
        ? 'Enter a real payment date.'
        : null;
  const valid =
    reference.trim().length >= 3 &&
    reference.trim().length <= 100 &&
    /[A-Za-z0-9]/.test(reference) &&
    evidence.trim().length >= 10 &&
    evidence.trim().length <= 500 &&
    /^\d{4}-\d{2}-\d{2}$/.test(paidOn) &&
    dateProblem === null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record External Commission Payment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || pay.isPending} onClick={() => pay.mutate()}>
            Record External Commission Payment
          </Button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <CommissionFacts commission={commission} />
        <p className={styles.formNote}>
          Record a payment already made outside AF Homes. The approved amount and recipient are
          fixed; only the payment details are entered here.
        </p>
        <label className={styles.filterLabel}>
          Payment method
          <Select
            aria-label="Payment method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            options={PAYOUT_METHODS.map((m) => ({ value: m, label: m }))}
          />
        </label>
        <DateField
          id="commission-payment-date"
          name="paidOn"
          label="Payment date"
          hint="The day the money was paid outside AF Homes: today or earlier."
          min={EARLIEST_PAYMENT_DATE}
          max={today}
          value={paidOn}
          onChange={setPaidOn}
        />
        {dateProblem ? (
          <p role="alert" className={styles.formAlert}>
            {dateProblem}
          </p>
        ) : null}
        <TextField
          id="commission-payment-reference"
          name="paymentReference"
          label="External payment reference"
          hint="Bank or transfer reference: 3 to 100 characters, including a letter or number. Each reference can back only one payout."
          maxLength={100}
          value={reference}
          onChange={setReference}
        />
        <TextField
          id="commission-payment-evidence"
          name="paymentEvidence"
          label="Payment evidence reference"
          hint="Supporting document or external payment evidence reference, 10 to 500 characters."
          maxLength={500}
          value={evidence}
          onChange={setEvidence}
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
