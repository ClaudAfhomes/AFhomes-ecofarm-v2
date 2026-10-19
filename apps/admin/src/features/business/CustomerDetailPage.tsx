import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { Sale } from '@afhomes/contracts';
import {
  Button,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  DetailGrid,
  DetailMono,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import { CUSTOMER_CATEGORY_LABELS, paymentSchemeLabel } from '@afhomes/contracts';

import { formatDate, formatDateTime } from '../../lib/format';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { useSession } from '../../lib/session';
import { getCustomerById, getSalePayments, getSales } from './services';
import { businessKeys } from './queryKeys';
import { formatMoneyOrDash } from '@afhomes/shared';
import { SettlementBadge } from './SettlementBadge';
import { CustomerCompanyEditDialog } from './CustomerCompanyEditDialog';
import { CustomerRecordActions } from './CustomerRecordActions';
import { SalePaymentList } from './SalePaymentDialog';
import { TierBadge } from './TierBadge';
import { ImportContinuationPanel } from './ImportContinuationPanel';
import styles from './CustomerDetailPage.module.css';

/**
 * Actionable detail-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeCustomerLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open customer records right now. Contact an administrator.';
  if (error instanceof ApiError && error.status === 404)
    return 'No customer exists at this link. Check the address, or open the record from the customers list.';
  if (error instanceof ApiParseError)
    return 'The saved record contains values this screen cannot display. Note the customer number and ask an administrator to review the record.';
  return undefined;
}

function describeSalesLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiParseError)
    return 'The saved sales contain values this screen cannot display. Note the customer number and ask an administrator to review the records.';
  return undefined;
}

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
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const canEditCompany =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;
  const customer = useQuery({
    queryKey: businessKeys.customer(id),
    queryFn: () => getCustomerById(id ?? ''),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
  // The customer's purchase history: the sale facts removed from the sales
  // table live here instead. Read-only; payment actions stay on the
  // sales/finance pages. A viewer can hold the customers grant without the
  // card-sales scope, so 403 hides the card instead of breaking the page.
  const sales = useQuery({
    queryKey: businessKeys.customerSales(id),
    queryFn: () => getSales({ customerId: id ?? '' }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
  const salesHidden = sales.error instanceof ApiError && sales.error.status === 403;

  if (customer.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading customer"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <DetailGrid className={styles.topGrid}>
            {['Customer', 'Contact', 'Verification', 'Membership'].map((title) => (
              <DetailCard key={title}>
                <DetailCardTitle>{title}</DetailCardTitle>
                <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                  <Skeleton style={{ height: 16 }} />
                  <Skeleton style={{ height: 16 }} />
                  <Skeleton style={{ height: 16 }} />
                </div>
              </DetailCard>
            ))}
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 120 }} />
          </DetailGrid>
        </div>
      </section>
    );
  if (customer.isError)
    return (
      <section className={styles.page}>
        <PageHeader title="Customer" description="Customer record and card sales." />
        <ErrorState
          error={customer.error}
          message={describeCustomerLoadError(customer.error)}
          onRetry={customer.refetch}
        />
      </section>
    );
  if (!customer.data)
    return (
      <section className={styles.page}>
        <PageHeader title="Customer" description="Customer record and card sales." />
        <EmptyState title="Customer not found." description="It may have been deleted." />
      </section>
    );

  const record = customer.data;
  // Company-stated age is never stored (it goes stale); both AGE fields derive
  // from the stored birthdays so the display can never disagree with them.
  const ageOn = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    const born = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(born.valueOf())) return '—';
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    if (
      now.getMonth() < born.getMonth() ||
      (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
    )
      age -= 1;
    return age < 0 ? '—' : String(age);
  };
  const addressPartOf = (address: unknown, key: string): string => {
    if (!address || typeof address !== 'object') return '';
    const part = (address as Record<string, unknown>)[key];
    return typeof part === 'string' ? part.trim() : '';
  };
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
        ['Customer ID (RA No.)', <DetailMono>{record.raNumber || '—'}</DetailMono>],
        ['Internal system reference', <DetailMono>{record.customerNumber}</DetailMono>],
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
      // Company-stated primary-member facts, SSOT order (see
      // customer-ssot.ts). STATUS here is the verbatim company value;
      // lifecycle state stays under Customer above. TIN is masked like the
      // government ID; AGE derives from the birthday, never stored.
      title: 'Primary Member',
      columns: 2,
      fields: [
        ['STATUS', record.companyStatus ?? '—'],
        ['FIRST NAME', record.firstName ?? '—'],
        ['LAST NAME', record.lastName ?? '—'],
        ['MIDDLE NAME', record.middleName ?? '—'],
        ['SUFFIX', record.suffix ?? '—'],
        ['BIRTHDAY', record.dateOfBirth ?? '—'],
        ['GENDER', record.gender ?? '—'],
        ['AGE', ageOn(record.dateOfBirth)],
        ['CITIZENSHIP', record.citizenship ?? '—'],
        ['CIVIL STATUS', record.civilStatus ?? '—'],
        ['PERMANENT ADDRESS LINE 1', addressPartOf(record.address, 'line1') || '—'],
        ['PERMANENT ADDRESS LINE 2', addressPartOf(record.address, 'line2') || '—'],
        ['PROVINCE', addressPartOf(record.address, 'province') || '—'],
        ['CITY', addressPartOf(record.address, 'city') || '—'],
        ['BARANGGAY', addressPartOf(record.address, 'barangay') || '—'],
        ['POSTAL CODE', addressPartOf(record.address, 'postalCode') || '—'],
        ['LANDLINE', record.landline ?? '—'],
        ['EMAIL', record.email],
        ['TIN NO.', record.tinNumberMasked ?? '—'],
        ['MOBILE NO.', record.phone],
        ['OCCUPATION / BUSINESS NAME', record.occupationBusinessName ?? '—'],
        ['OFFICE / BUSINESS ADDRESS', record.officeBusinessAddress ?? '—'],
        ['EMPLOYED POSITION', record.employedPosition ?? '—'],
      ],
    },
    {
      // Supplementary block, SSOT order. Names and address are stored joined
      // (single text columns) and display as the two stored fields; AGE
      // derives from the supplementary birthday.
      title: 'Supplementary Member',
      columns: 2,
      fields: [
        ['SUPPLEMENTARY FULL NAME', record.supplementaryFullName ?? '—'],
        ['SUPPLEMENTARY ADDRESS', record.supplementaryAddress ?? '—'],
        ['BIRTHDAY', record.supplementaryBirthday ?? '—'],
        ['GENDER', record.supplementaryGender ?? '—'],
        ['AGE', ageOn(record.supplementaryBirthday)],
        ['CITIZENSHIP', record.supplementaryCitizenship ?? '—'],
        ['CIVIL STATUS', record.supplementaryCivilStatus ?? '—'],
        ['TIN NO.', record.supplementaryTinNumberMasked ?? '—'],
        ['LANDLINE', record.supplementaryLandline ?? '—'],
        ['MOBILE NO.', record.supplementaryMobile ?? '—'],
        ['EMAIL', record.supplementaryEmail ?? '—'],
        ['OCCUPATION / BUSINESS NAME', record.supplementaryOccupationBusinessName ?? '—'],
        ['OFFICE / BUSINESS ADDRESS', record.supplementaryOfficeAddress ?? '—'],
        ['EMPLOYED POSITION', record.supplementaryPosition ?? '—'],
      ],
    },
    {
      // Stored verbatim as stated. These names do not assert reporting lines;
      // referral_relationships remains the only genealogy authority.
      title: 'Related Persons and Referral',
      columns: 2,
      fields: [
        ['OST/IST NAME', record.ostIstName ?? '—'],
        ['SVD (NAME)', record.svdName ?? '—'],
        ['SSM (NAME)', record.ssmName ?? '—'],
        ['SM (NAME)', record.smName ?? '—'],
        ['REFERRER (NAME)', record.referrerName ?? '—'],
        ['VIP RECOMMENDER (NAME)', record.vipRecommenderName ?? '—'],
        ['CONTACT NO.', record.relatedContactNo ?? '—'],
        ['EMAIL ADDRESS', record.relatedEmail ?? '—'],
      ],
    },
    {
      // Company-stated figures, verbatim. Server-computed money (verified
      // payments, snapshots, commissions) never reads these columns.
      title: 'Package and Payment — company stated',
      columns: 2,
      fields: [
        ['VIP PACKAGE', record.statedVipPackage ?? '—'],
        ['PAYMENT TERMS', record.statedPaymentTerms ?? '—'],
        ['REGULAR PRICE', record.statedRegularPrice ?? '—'],
        ['DISCOUNT', record.statedDiscount ?? '—'],
        ['TOTAL AMOUNT', record.statedTotalAmount ?? '—'],
        ['RF', record.statedRf ?? '—'],
        ['PAYMENT TYPE', record.statedPaymentType ?? '—'],
        ['REF NO', record.statedRefNo ?? '—'],
        ['DATE', record.statedPaymentDate ?? '—'],
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
    <section className={styles.page}>
      <PageHeader
        title={record.fullName}
        description="Customer record and card sales."
        actions={
          canEditCompany ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit company record
            </Button>
          ) : undefined
        }
      />
      {editing ? (
        <CustomerCompanyEditDialog
          customer={record}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={() => void customer.refetch()}
        />
      ) : null}
      <ImportContinuationPanel customerId={record.id} />
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
            {sales.isPending ? (
              <div
                style={{ display: 'grid', gap: 'var(--space-3)' }}
                role="status"
                aria-label="Loading card sales"
              >
                <Skeleton style={{ height: 24, maxWidth: 160 }} />
                <Skeleton style={{ height: 96 }} />
                <Skeleton style={{ height: 96 }} />
              </div>
            ) : (
              <>
                <h2 className={styles.sectionTitle}>Card Sales</h2>
                {sales.isError ? (
                  <ErrorState
                    error={sales.error}
                    message={describeSalesLoadError(sales.error)}
                    onRetry={sales.refetch}
                  />
                ) : sales.data.length === 0 ? (
                  <p className={styles.muted}>No card sales yet.</p>
                ) : (
                  <div className={styles.saleStack}>
                    {sales.data.map((sale) => (
                      <CustomerSaleCard key={sale.id} sale={sale} />
                    ))}
                  </div>
                )}
              </>
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
    queryKey: businessKeys.salePayments(sale.id),
    queryFn: () => getSalePayments(sale.id),
    placeholderData: keepPreviousData,
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
        <DetailField label="Total">{formatMoneyOrDash(sale.cashPrice)}</DetailField>
        <DetailField label="Paid">{formatMoneyOrDash(sale.paidAmount)}</DetailField>
        <DetailField label="Balance">{formatMoneyOrDash(sale.balance)}</DetailField>
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
          <div
            style={{ display: 'grid', gap: 'var(--space-3)' }}
            role="status"
            aria-label="Loading payments"
          >
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={payments.refetch} />
        ) : (
          <SalePaymentList payments={payments.data} />
        )}
      </details>
    </DetailCard>
  );
}
