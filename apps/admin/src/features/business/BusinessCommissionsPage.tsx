import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  StatusChip,
} from '@jad/ui';
import type { Commission } from '@jad/contracts';

import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { canViewModule } from '../../app/navigation';
import { formatMoney, formatRate } from './format';
import { getCommissions, markCommissionPaid, qualifyCommission } from './services';

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
    queryKey: ['business', 'commissions', applied],
    queryFn: () => getCommissions(applied),
    // Qualification and payout decisions land from review screens and other
    // sessions; the Apply-time snapshot refreshes without reload.
    refetchInterval: 30_000,
  });

  const [qualifying, setQualifying] = useState<Commission | null>(null);
  const [paying, setPaying] = useState<Commission | null>(null);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'commissions'] });
  };

  return (
    <section>
      <PageHeader
        title="Commissions"
        description="Single-level commissions from frozen sale snapshots. Account rules override role rules; no matching rule means 0%. Qualification and payout remain explicit audited decisions."
      />

      <FilterBar
        search={
          <SearchField
            label="Search commissions"
            placeholder="SALE-000001 or seller name"
            value={search}
            onChange={setSearch}
          />
        }
        filters={
          <>
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
              onClick={() => applyFilters({ status, search: search.trim(), seller: seller.trim() })}
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

      {query.isPending ? (
        <p role="status">Loading commissions…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState
          title={applied.search ? 'No matching records.' : 'No commissions'}
          description="No commission matches the current filters."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
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
              {query.data?.map((commission) => (
                <tr key={commission.id}>
                  <td>{commission.saleNumber}</td>
                  <td>{commission.beneficiaryName}</td>
                  <td>{formatMoney(commission.basisAmount)}</td>
                  <td>{formatRate(commission.rate)}</td>
                  <td>{formatMoney(commission.amount)}</td>
                  <td>
                    <StatusChip
                      label={STATUS_LABEL[commission.status] ?? commission.status}
                      tone={
                        commission.status === 'paid'
                          ? 'success'
                          : commission.status === 'earned'
                            ? 'success'
                            : commission.status === 'cancelled'
                              ? 'neutral'
                              : commission.status === 'final_qualification_pending'
                                ? 'warning'
                                : 'neutral'
                      }
                    />
                  </td>
                  <td>{formatDateTime(commission.createdAt)}</td>
                  <td>
                    {[commission.qualifiedAt, commission.earnedAt, commission.paidAt]
                      .filter(Boolean)
                      .map((value) => formatDateTime(value!))
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    {commission.status === 'final_qualification_pending' && mayMutate ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setQualifying(commission)}
                      >
                        Decide
                      </Button>
                    ) : commission.status === 'earned' && mayMutate ? (
                      <Button size="sm" variant="secondary" onClick={() => setPaying(commission)}>
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
  const decide = useMutation({
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
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          Sale <strong>{commission.saleNumber}</strong> · {formatMoney(commission.amount)} to{' '}
          {commission.beneficiaryName}. This is the only way a commission becomes earned, and it is
          recorded with your notes and identity. The amount and attribution do not change.
        </p>
        <label>
          Decision
          <select
            value={decision}
            onChange={(e) => setDecision(e.target.value as 'earned' | 'cancelled')}
          >
            <option value="earned">Qualify — commission earned</option>
            <option value="cancelled">Cancel — commission cancelled</option>
          </select>
        </label>
        <label>
          Notes (required)
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {decide.error ? <p role="alert">{decide.error.message}</p> : null}
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
  const pay = useMutation({
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
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          Sale <strong>{commission.saleNumber}</strong> · {formatMoney(commission.amount)} to{' '}
          {commission.beneficiaryName}. Only an earned commission can be marked paid. The amount and
          attribution do not change; this records when and by whom it was paid.
        </p>
        <label>
          Payment reference (optional)
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        {pay.error ? <p role="alert">{pay.error.message}</p> : null}
      </div>
    </Dialog>
  );
}
