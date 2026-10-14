import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';
import type { Commission } from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { canViewModule } from '../../app/navigation';
import { formatRate } from './format';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
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
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading commissions"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader title="Commissions" description="Commissions from frozen sale snapshots" />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <>
          <ul className={styles.badges} aria-label="Commission summary">
            <li>
              <StatusChip
                label={`Pending decision: ${formatCountOrDash(summary.awaiting)}`}
                tone="warning"
                icon="clock"
              />
            </li>
            <li>
              <StatusChip
                label={`Qualified (earned): ${formatCountOrDash(summary.earned)}`}
                tone="success"
                icon="check"
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
                <label className={styles.filterLabel}>
                  Status
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
                </label>
                {mayFilterBySeller ? (
                  <SearchField
                    label="Filter by seller"
                    placeholder="Staff or OST id"
                    value={seller}
                    onChange={setSeller}
                  />
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

          {rows.length === 0 ? (
            <EmptyState
              title={applied.search ? 'No matching records.' : 'No commissions'}
              description="No commission matches the current filters."
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
                    <th>Commission</th>
                    <th>Sale</th>
                    <th>Beneficiary</th>
                    <th>Basis</th>
                    <th>Rate</th>
                    <th>Commission</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Qualified / Earned / Paid</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((commission) => (
                    <tr key={commission.id}>
                      <td data-label="Commission">
                        <span className={styles.recordRef}>
                          <span className={styles.recordRefDot} aria-hidden="true" />
                          {commission.commissionNumber ?? '—'}
                        </span>
                      </td>
                      <td data-label="Sale">{commission.saleNumber}</td>
                      <td data-label="Beneficiary">{commission.beneficiaryName}</td>
                      <td data-label="Basis" className={styles.numeric}>
                        {formatMoneyOrDash(commission.basisAmount)}
                      </td>
                      <td data-label="Rate" className={styles.numeric}>
                        {formatRate(commission.rate)}
                      </td>
                      <td data-label="Commission" className={styles.numeric}>
                        {formatMoneyOrDash(commission.amount)}
                      </td>
                      <td data-label="Status">
                        <StatusChip
                          label={STATUS_LABEL[commission.status] ?? commission.status}
                          tone={
                            commission.status === 'paid'
                              ? 'success'
                              : commission.status === 'earned'
                                ? 'success'
                                : commission.status === 'cancelled'
                                  ? 'danger'
                                  : commission.status === 'final_qualification_pending'
                                    ? 'warning'
                                    : commission.status === 'payment_verified'
                                      ? 'info'
                                      : 'warning'
                          }
                          icon={commission.status === 'cancelled' ? 'close' : undefined}
                        />
                      </td>
                      <td data-label="Created">{formatDateTime(commission.createdAt)}</td>
                      <td data-label="Qualified / Earned / Paid">
                        {[commission.qualifiedAt, commission.earnedAt, commission.paidAt]
                          .filter(Boolean)
                          .map((value) => formatDateTime(value!))
                          .join(' · ') || '—'}
                      </td>
                      <td data-label="Actions">
                        {commission.status === 'final_qualification_pending' && mayMutate ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setQualifying(commission)}
                          >
                            Decide
                          </Button>
                        ) : commission.status === 'earned' && mayMutate ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPaying(commission)}
                          >
                            Mark Paid
                          </Button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
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
        <p className={styles.formNote}>
          Sale <strong>{commission.saleNumber}</strong> · {formatMoneyOrDash(commission.amount)} to{' '}
          {commission.beneficiaryName}. This is the only way a commission becomes earned, and it is
          recorded with your notes and identity. The amount and attribution do not change.
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
        <TextField
          id="commission-decision-notes"
          name="decisionNotes"
          label="Notes"
          hint="At least 5 characters. Recorded with your identity."
          value={notes}
          onChange={setNotes}
        />
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
        <p className={styles.formNote}>
          Sale <strong>{commission.saleNumber}</strong> · {formatMoneyOrDash(commission.amount)} to{' '}
          {commission.beneficiaryName}. Only an earned commission can be marked paid. The amount and
          attribution do not change; this records when and by whom it was paid.
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
