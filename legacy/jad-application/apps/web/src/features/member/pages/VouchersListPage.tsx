import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { formatMoney, isExpired } from '@jad/shared';
import { EmptyState, ErrorState, PageHeader, QrCode, Skeleton, StatusChip } from '@jad/ui';
import type { VoucherStatus } from '@jad/contracts';

import { useVouchers } from '../hooks/useMember';
import { VOUCHER_STATUS_TONE, formatDate, voucherStatusLabel } from '../lib/presentation';
import styles from './VouchersListPage.module.css';

type StatusFilter = 'ALL' | VoucherStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'FULLY_REDEEMED', label: 'Fully redeemed' },
];

/**
 * Vouchers list (SCR-MEM-020, FR-VCH-001). The member's OWN vouchers only
 * (object-level, NFR-AUTHZ-002). Values are exact-decimal strings; remaining
 * value is server-computed (BR-VCH-002). Each voucher has a human code
 * (JAD-VCH-…) and a QR code (BR-VCH-007 blocked actions not shown). Production
 * static mock, no dev preview.
 */
export function VouchersListPage() {
  const vouchersQuery = useVouchers();
  const [filter, setFilter] = useState<StatusFilter>('ALL');

  const items = vouchersQuery.data ?? [];
  const filtered = useMemo(
    () => (filter === 'ALL' ? items : items.filter((v) => v.status === filter)),
    [items, filter],
  );
  const total = items.length;
  const visible = filtered.length;

  return (
    <section>
      <PageHeader
        title="Vouchers"
        description="Your JA&D vouchers - each with a code and QR code for redemption."
      />

      <p className={styles.timeframe}>Available · Remaining value</p>

      <div className={styles.filters} role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? styles.filterActive : styles.filter}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className={styles.count} aria-live="polite">
        {vouchersQuery.isLoading
          ? 'Loading vouchers…'
          : `Showing ${visible} of ${total} ${total === 1 ? 'voucher' : 'vouchers'}${filter !== 'ALL' ? ` · ${voucherStatusLabel(filter as VoucherStatus)}` : ''}`}
      </p>

      {vouchersQuery.isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : vouchersQuery.isError ? (
        <ErrorState
          error={vouchersQuery.error}
          title="Could not load your vouchers"
          onRetry={() => void vouchersQuery.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No vouchers yet"
          description="Vouchers issued to you will appear here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matches"
          description={`No ${voucherStatusLabel(filter as VoucherStatus).toLowerCase()} vouchers match this filter.`}
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setFilter('ALL')}>
              Clear filter
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {filtered.map((voucher) => {
            return (
              <li key={voucher.id}>
                <Link className={styles.card} to={`/member/vouchers/${voucher.id}`}>
                  <QrCode
                    value={voucher.code}
                    size={120}
                    alt={`QR code for ${voucher.code}`}
                    className={styles.qrThumb}
                  />
                  <span className={styles.cardMain}>
                    <span className={styles.title}>{voucher.title}</span>
                    <span className={styles.code}>{voucher.code}</span>
                    <span className={styles.meta}>
                      Original {formatMoney(voucher.originalValue)} · issued{' '}
                      {formatDate(voucher.createdAt)}
                    </span>
                    <span className={styles.remaining}>
                      Remaining <strong>{formatMoney(voucher.remainingValue)}</strong>
                    </span>
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      gap: 'var(--space-2)',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <StatusChip
                      label={voucherStatusLabel(voucher.status)}
                      tone={VOUCHER_STATUS_TONE[voucher.status as VoucherStatus]}
                    />
                    {voucher.status === 'ACTIVE' && isExpired(voucher.expiresAt) ? (
                      <StatusChip label="Expired" tone="warning" />
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
