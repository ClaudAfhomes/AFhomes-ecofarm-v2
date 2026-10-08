import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { Sale } from '@afhomes/contracts';
import {
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  DetailGrid,
  DetailMono,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusChip,
} from '@afhomes/ui';
import { CUSTOMER_CATEGORY_LABELS, paymentSchemeLabel } from '@afhomes/contracts';

import { formatDate, formatDateTime } from '../../lib/format';
import { ApiError } from '../../lib/api/errors';
import { getCustomerById, getSalePayments, getSales } from './services';
import { formatMoney } from './format';
import { SettlementBadge } from './SettlementBadge';
import { CustomerRecordActions } from './CustomerRecordActions';
import { SalePaymentList } from './SalePaymentDialog';
import { TierBadge } from './TierBadge';
import styles from './CustomerDetailPage.module.css';

/**
 * Single customer record, reached by clicking a directory row.
 *
 * Record fields come from `GET /customers/:id` (same RPC as the directory,
 * narrowed by id). Details are grouped so identity, contact, verification
 * and membership read as a hierarchy instead of one flat list. The Card
 * Sales section carries each sale's facts plus its payment history; the
 * Action buttons below each sale reuse the shared row actions (same guards
 * as the sales directory menu). A record-level Action card carries the
 * directory row workflows (new application, activation link, deactivation)
 * so operators no longer round-trip to the directory.
 */
export function CustomerDetailPage() {
  const { id } = useParams();
  const customer = useQuery({
    queryKey: ['business', 'customer', id],
    queryFn: () => getCustomerById(id ?? ''),
    enabled: Boolean(id),
  });
  // The customer's purchase history: the sale facts removed from the sales
  // table live here instead. Read-only; payment actions stay on the
  // sales/finance pages. A viewer can hold the customers grant without the
  // card-sales scope, so 403 hides the card instead of breaking the page.
  const sales = useQuery({
    queryKey: ['business', 'customer-sales', id],
    queryFn: () => getSales({ customerId: id ?? '' }),
    enabled: Boolean(id),
  });
  const salesHidden = sales.error instanceof ApiError && sales.error.status === 403;

  if (customer.isPending) return <p role="status">Loading customer…</p>;
  if (customer.isError) return <ErrorState error={customer.error} onRetry={customer.refetch} />;
  if (!customer.data)
    return <EmptyState title="Customer not found." description="It may have been deleted." />;

  const record = customer.data;
  const groups: Array<{ title: string; fields: Array<[string, ReactNode]>; columns?: 2 }> = [
    {
      title: 'Customer',
      // Two columns: identity (name, status, category, portal) then
      // identifiers (ID, code, registered). Column flow preserves JSX order.
      columns: 2,
      fields: [
        ['Full name', record.fullName],
        ['Status', <StatusChip label={record.status} />],
        [
          'Category',
          record.derivedCategory ? CUSTOMER_CATEGORY_LABELS[record.derivedCategory] : '—',
        ],
        ['Portal account', record.portalAccountActivated ? 'Activated' : 'Not activated'],
        ['Customer ID', <DetailMono>{record.customerNumber}</DetailMono>],
        [
          'Customer code',
          record.customerCode ? <DetailMono>{record.customerCode}</DetailMono> : '—',
        ],
        ['Registered', record.createdAt ? formatDateTime(record.createdAt) : '—'],
      ],
    },
    {
      title: 'Contact',
      fields: [
        ['Email', record.email],
        ['Phone', record.phone],
        ['Date of birth', record.dateOfBirth ?? '—'],
        ['Gender', record.gender ?? '—'],
      ],
    },
    {
      title: 'Verification',
      fields: [
        ['ID type', record.governmentIdType ?? '—'],
        // Only ever the masked form; the API never returns the number.
        ['Government ID', record.governmentIdMasked ?? '—'],
      ],
    },
    {
      // Same facts as general Customer Lookup, kept separate like there: an
      // active customer can hold a suspended membership, and conflating the
      // two tells the operator the wrong thing about the record.
      title: 'Membership',
      fields: [
        [
          'Membership status',
          record.membershipStatus ? <StatusChip label={record.membershipStatus} /> : 'None',
        ],
        ['VIP tier', <TierBadge tier={record.tier} />],
        [
          'Valid until',
          record.membershipExpiresAt ? formatDate(record.membershipExpiresAt) : 'Not applicable',
        ],
      ],
    },
  ];

  return (
    <section>
      <PageHeader title={record.fullName} />
      <DetailGrid className={styles.topGrid}>
        {groups.map((group) => (
          <DetailCard key={group.title}>
            <DetailCardTitle>{group.title}</DetailCardTitle>
            <DetailFieldGrid
              className={group.columns === 2 ? `${styles.twoCol} ${styles.twoColRows4}` : undefined}
            >
              {group.fields.map(([label, value]) => (
                <DetailField key={label} label={label}>
                  {value}
                </DetailField>
              ))}
            </DetailFieldGrid>
          </DetailCard>
        ))}
        {salesHidden ? null : (
          <section aria-label="Card Sales" className={styles.salesSection}>
            <h2 className={styles.sectionTitle}>Card Sales</h2>
            {sales.isPending ? (
              <p role="status">Loading card sales…</p>
            ) : sales.isError ? (
              <ErrorState error={sales.error} onRetry={sales.refetch} />
            ) : sales.data.length === 0 ? (
              <p className={styles.muted}>No card sales yet.</p>
            ) : (
              <div className={styles.saleStack}>
                {sales.data.map((sale) => (
                  <CustomerSaleCard key={sale.id} sale={sale} />
                ))}
              </div>
            )}
          </section>
        )}
        <div className={styles.salesSection}>
          <CustomerRecordActions
            customer={record}
            sales={salesHidden ? [] : (sales.data ?? [])}
            onChanged={() => void customer.refetch()}
          />
        </div>
      </DetailGrid>
    </section>
  );
}

/**
 * One sale as a single card: facts plus collapsible payment history. Sale
 * actions live in the Actions card below, aimed at a selected sale.
 */
function CustomerSaleCard({ sale }: { sale: Sale }) {
  const payments = useQuery({
    queryKey: ['business', 'sale-payments', sale.id],
    queryFn: () => getSalePayments(sale.id),
  });
  return (
    <DetailCard>
      <DetailCardTitle>Sale Details</DetailCardTitle>
      <DetailFieldGrid className={`${styles.twoCol} ${styles.twoColRows5}`}>
        <DetailField label="Sale number">
          <DetailMono>{sale.saleNumber}</DetailMono>
        </DetailField>
        <DetailField label="Card">{sale.productName}</DetailField>
        <DetailField label="Scheme">{paymentSchemeLabel(sale.paymentScheme)}</DetailField>
        <DetailField label="Seller">{sale.sellerName ?? '—'}</DetailField>
        <DetailField label="Activation status">
          {sale.activatedAt ? 'Active' : 'Not activated'}
        </DetailField>
        <DetailField label="Total">{formatMoney(sale.cashPrice)}</DetailField>
        <DetailField label="Paid">{formatMoney(sale.paidAmount)}</DetailField>
        <DetailField label="Balance">{formatMoney(sale.balance)}</DetailField>
        <DetailField label="Payment Status">
          <SettlementBadge total={sale.cashPrice} paid={sale.paidAmount} balance={sale.balance} />
        </DetailField>
        <DetailField label="Created">
          {sale.createdAt ? formatDateTime(sale.createdAt) : '—'}
        </DetailField>
      </DetailFieldGrid>
      <details className={styles.history} name="sale-payment-history">
        <summary>
          <span aria-hidden="true" className={styles.chevron} />
          View Payment History
        </summary>
        {payments.isPending ? (
          <p role="status">Loading payments…</p>
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={payments.refetch} />
        ) : (
          <SalePaymentList payments={payments.data} />
        )}
      </details>
    </DetailCard>
  );
}
