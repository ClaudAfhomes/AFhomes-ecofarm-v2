import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';

import { formatMoney } from '@jad/shared';
import { ErrorState, PageHeader, Skeleton } from '@jad/ui';
import type { LedgerEntryType } from '@jad/contracts';

import { ApiError } from '../../../lib/api/errors';

import { Button } from '../../../components/Button';
import { SelectField } from '../../auth/components/SelectField';
import { useLedgerPage } from '../hooks/useMember';
import {
  formatDate,
  formatSignedMoney,
  ledgerDirectionLabel,
  ledgerEntryTypeLabel,
} from '../lib/presentation';
import styles from './LedgerPage.module.css';

const LEDGER_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'DIRECT_COMMISSION', label: 'Direct Commission' },
  { value: 'DIRECT_REFERRAL', label: 'Direct Referral' },
  { value: 'GROUP_INCENTIVE', label: 'Group Incentive' },
  { value: 'WITHDRAWAL_RESERVATION', label: 'Withdrawal Reservation' },
  { value: 'WITHDRAWAL_COMPLETION', label: 'Withdrawal Completion' },
  { value: 'WITHDRAWAL_REVERSAL', label: 'Withdrawal Reversal' },
  { value: 'COMMISSION_REVERSAL', label: 'Commission Reversal' },
  { value: 'FINANCIAL_ADJUSTMENT', label: 'Financial Adjustment' },
];

/**
 * Ledger (SCR-MEM-009). Append-only financial entries from `GET /me/ledger`
 * with server-computed running balance (BI-001/005) and cursor pagination
 * (API-SPECIFICATION §4). The type filter is a server-side allowlisted key -
 * changing it starts a fresh cursor stream.
 */
export function LedgerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get('type') ?? '';
  const ledgerQuery = useLedgerPage(type);

  const handleTypeChange = (next: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next) nextParams.set('type', next);
    else nextParams.delete('type');
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (ledgerQuery.isError && type) {
      const isUnknownType = !LEDGER_TYPE_OPTIONS.some((option) => option.value === type);
      const isValidationError =
        ledgerQuery.error instanceof ApiError && ledgerQuery.error.code === 'VALIDATION_ERROR';
      if (isUnknownType || isValidationError) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('type');
        setSearchParams(nextParams, { replace: true });
      }
    }
  }, [ledgerQuery.isError, ledgerQuery.error, type, searchParams, setSearchParams]);

  const entries = useMemo(
    () => ledgerQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [ledgerQuery.data],
  );

  return (
    <section>
      <PageHeader
        title="Ledger"
        description="Append-only financial ledger (BI-005) - cursor-paginated."
        actions={
          <Link className={styles.backLink} to="/member/ewallet" aria-label="Back to eWallet">
            ← Back to eWallet
          </Link>
        }
      />

      <div className={styles.filterWrap}>
        <SelectField
          id="ledger-type"
          name="type"
          label="Entry type"
          value={type}
          onChange={handleTypeChange}
          options={LEDGER_TYPE_OPTIONS.filter((option) => option.value !== '')}
          placeholder="All types"
          hint={
            type === 'GROUP_INCENTIVE'
              ? 'Group Incentive is gated - no entries yet until Owner decision OD-006 (FEAT-041).'
              : 'Filter is shareable via URL - ?type= - and uses a server allowlist.'
          }
        />
      </div>
      {type === 'GROUP_INCENTIVE' ? (
        <p className={styles.gatedNote}>
          Group Incentive is gated - no entries yet until Owner decision OD-006 (FEAT-041 BLOCKED on
          OD-006..012). See <Link to="/member/policies">Policies</Link>.
        </p>
      ) : null}

      {ledgerQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : ledgerQuery.isError ? (
        <ErrorState
          error={ledgerQuery.error}
          title="Could not load your ledger"
          onRetry={() => void ledgerQuery.refetch()}
        />
      ) : entries.length === 0 ? (
        <div className={styles.empty}>
          <h3 className={styles.emptyTitle}>No ledger entries</h3>
          <p className={styles.emptyBody}>
            {type === 'GROUP_INCENTIVE'
              ? 'Group Incentive is gated - no entries yet until Owner decision OD-006 (FEAT-041 BLOCKED).'
              : 'Transactions appear here once commissions are credited or withdrawals are requested.'}
          </p>
          {type ? (
            <button
              type="button"
              className={styles.clearFilter}
              onClick={() => handleTypeChange('')}
            >
              Clear filter
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {type ? (
            <p className={styles.filterNote}>
              Balance is global running balance (not filtered total). Filter is shareable via URL.{' '}
              <button
                type="button"
                className={styles.clearFilter}
                onClick={() => handleTypeChange('')}
              >
                Clear filter
              </button>
            </p>
          ) : null}
          <ul className={styles.list}>
            {entries.map((entry) => (
              <li key={entry.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.type}>
                    {ledgerEntryTypeLabel(entry.entryType as LedgerEntryType)}
                  </span>
                  <span className={styles.meta}>
                    {ledgerDirectionLabel(entry.direction)} · {formatDate(entry.createdAt)}
                    {entry.entryType === 'WITHDRAWAL_COMPLETION'
                      ? ' · external record - no balance change'
                      : ''}
                  </span>
                </div>
                <div className={styles.rowAmount}>
                  <span
                    className={
                      entry.entryType === 'WITHDRAWAL_COMPLETION'
                        ? styles.muted
                        : entry.direction === 'CREDIT'
                          ? styles.credit
                          : styles.debit
                    }
                    title={
                      entry.entryType === 'WITHDRAWAL_COMPLETION'
                        ? 'Recorded external completion - Available already reserved at Reservation (BR-WDR-002)'
                        : undefined
                    }
                  >
                    {formatSignedMoney(entry.amount, entry.direction)}
                  </span>
                  {entry.balanceAfter !== undefined ? (
                    <span className={styles.balance}>
                      Balance {formatMoney(entry.balanceAfter)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {ledgerQuery.hasNextPage ? (
            <div className={styles.loadMore}>
              <Button
                variant="secondary"
                loading={ledgerQuery.isFetchingNextPage}
                disabled={ledgerQuery.isFetchingNextPage}
                onClick={() => void ledgerQuery.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          ) : null}
          <p className={styles.meta}>
            Last updated{' '}
            {ledgerQuery.dataUpdatedAt
              ? new Date(ledgerQuery.dataUpdatedAt).toLocaleString('en-PH', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : 'just now'}{' '}
            • Append-only • <Link to="/member/ewallet">eWallet</Link> •{' '}
            <Link to="/member/commissions">Commissions</Link>
          </p>
        </>
      )}
    </section>
  );
}
