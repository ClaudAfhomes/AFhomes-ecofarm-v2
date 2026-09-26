import { Link } from 'react-router';
import { useMemo, useState } from 'react';

import { formatMoney } from '@jad/shared';
import { EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import type { SaleStatus } from '@jad/contracts';

import { ButtonLink } from '../../../components/ButtonLink';
import { useSales } from '../hooks/useMember';
import { SALE_STATUS_TONE, formatDate, saleStatusLabel } from '../lib/presentation';
import styles from './SalesListPage.module.css';

const FILTERS: { value: SaleStatus | 'All'; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'ADMIN_APPROVED', label: 'Admin Approved' },
  { value: 'PAYMENT_VERIFIED', label: 'Payment Verified' },
  { value: 'QUALIFYING_SALE', label: 'Qualifying' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'LOCKED', label: 'Locked' },
];

/**
 * Sales list (SCR-MEM-005, FR-SAL-001). The member's own qualifying sales from
 * `GET /sales`, newest first, with the sale status from the API state machine
 * (BUSINESS-RULES §5). A sale's value is the server snapshot (BI-006) - never
 * re-derived client-side.
 */
export function SalesListPage() {
  const salesQuery = useSales();
  const [filter, setFilter] = useState<SaleStatus | 'All'>('All');

  const filteredSales = useMemo(() => {
    const data = salesQuery.data ?? [];
    if (filter === 'All') return data;
    return data.filter((sale) => sale.status === filter);
  }, [salesQuery.data, filter]);

  return (
    <section>
      <PageHeader
        title="Sales"
        description="Your qualifying sales and their approval progress."
        actions={
          <ButtonLink to="/member/sales/new" className={styles.submitLink}>
            Submit a sale
          </ButtonLink>
        }
      />

      <div className={styles.filters} role="group" aria-label="Filter sales by status">
        {FILTERS.map((option) => (
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

      {salesQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : salesQuery.isError ? (
        <ErrorState error={salesQuery.error} title="Could not load your sales" />
      ) : (salesQuery.data ?? []).length === 0 ? (
        <EmptyState
          title="No sales yet"
          description="Submit your first qualifying sale to start tracking it here."
          action={
            <Link to="/member/sales/new" className={styles.inlineLink}>
              Submit a sale
            </Link>
          }
        />
      ) : filteredSales.length === 0 ? (
        <EmptyState
          title="No sales match this filter"
          description={`No ${saleStatusLabel(filter as SaleStatus)} sales found. Try another filter.`}
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setFilter('All')}>
              Clear filter
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {filteredSales.map((sale) => (
            <li key={sale.id}>
              <Link className={styles.card} to={`/member/sales/${sale.id}`}>
                <div className={styles.cardMain}>
                  <span className={styles.property}>{sale.propertyName}</span>
                  <span className={styles.meta}>
                    {sale.customerName} · submitted {formatDate(sale.submittedAt)}
                    {sale.resubmissionCount > 0 ? ` · resubmitted ${sale.resubmissionCount}x` : ''}
                  </span>
                  <span className={styles.value}>{formatMoney(sale.propertyValue)}</span>
                </div>
                <StatusChip
                  label={saleStatusLabel(sale.status)}
                  tone={SALE_STATUS_TONE[sale.status as SaleStatus]}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
