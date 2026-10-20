import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
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
  Icon,
  PageHeader,
  Skeleton,
  StatusChip,
  type IconName,
} from '@afhomes/ui';
import {
  CUSTOMER_CATEGORY_LABELS,
  GOVERNMENT_ID_TYPE_LABELS,
  paymentSchemeLabel,
} from '@afhomes/contracts';

import { formatDate, formatDateTime, formatTin } from '../../lib/format';
import { formatPaymentMethod, humanizeCode } from './format';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { useSession } from '../../lib/session';
import { getCustomerById, getSalePayments, getSales } from './services';
import { businessKeys } from './queryKeys';
import { formatMoneyOrDash, formatStatedMoney } from '@afhomes/shared';
import { SettlementBadge } from './SettlementBadge';
import { CustomerCompanyEditDialog } from './CustomerCompanyEditDialog';
import { CustomerIdImage } from './CustomerIdImage';
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
 * The company form is mostly empty cells, so "Not Recorded" has to recede.
 * Forty identical grey strings at body weight drown the twenty that carry real
 * data; at caption weight in muted ink they read as what they are - blanks on
 * a form. The wording is unchanged, so nothing downstream has to know.
 */
/**
 * The dossier's colour ladder. Three tints, all of them already in the design
 * system and all of them meaning something here: brand green is the person,
 * info blue is the second holder, gold is money - the same gold the tier badge
 * and the plan card already use. No fourth hue, and none invented.
 */
type CompanyTone = 'brand' | 'info' | 'gold' | 'neutral';

function stated(value: string | null | undefined): ReactNode {
  return value ? value : <span className={styles.absent}>Not Recorded</span>;
}

/**
 * A figure or a reference, set in mono. Identifiers are digits and punctuation
 * - they line up down the rail and read as machine output, not as prose. Exact
 * decimal text is stored and rendered verbatim; no currency mark is ever
 * concatenated onto it (AGENTS.md money rule).
 */
function statedMono(value: string | null | undefined): ReactNode {
  return value ? <DetailMono>{value}</DetailMono> : stated(null);
}

/** Stored genders are lowercase enum values; the screen reads them Title Case. */
const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  undisclosed: 'Undisclosed',
};

function genderLabel(value: string | null | undefined): string | null {
  return value ? (GENDER_LABELS[value] ?? value) : null;
}

/**
 * True when the customer carries any company-stated supplementary member data.
 * Used to decide whether the Supplementary Member dossier card renders at all:
 * a record with no supplementary data shows nothing instead of 14 "Not
 * Recorded" placeholders.
 */
function hasSupplementaryRecord(customer: unknown): boolean {
  if (!customer || typeof customer !== 'object') return false;
  const record = customer as Record<string, unknown>;
  const supplementaryKeys = [
    'supplementaryFullName',
    'supplementaryAddress',
    'supplementaryBirthday',
    'supplementaryGender',
    'supplementaryCitizenship',
    'supplementaryCivilStatus',
    'supplementaryTinNumberMasked',
    'supplementaryTinNumber',
    'supplementaryMobile',
    'supplementaryEmail',
    'supplementaryLandline',
    'supplementaryOccupationBusinessName',
    'supplementaryOfficeAddress',
    'supplementaryPosition',
  ];
  return supplementaryKeys.some((key) => {
    const value = record[key];
    return typeof value === 'string' && value.trim() !== '';
  });
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
  // One object, one panel at a time. The tab is URL state, so a panel is
  // shareable and the back button walks the operator out of it.
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'overview';
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  const canEditCompany =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;
  // The ID scan is a SEPARATE module from the customer record: holding
  // `sales.customers` does not carry `sales.id_documents`. Reading the scan
  // needs the second grant, so the image is never requested without it.
  const canViewIdDocuments =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.id_documents' && permission.canView,
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
      <section className={styles.page} role="status" aria-label="Loading customer">
        <div className={styles.masthead} aria-hidden="true">
          <div className={styles.mastheadIdentity}>
            <Skeleton className={styles.monogramSkeleton} />
            <div className={styles.mastheadBody}>
              <Skeleton style={{ height: 28, maxWidth: 260 }} />
              <div className={styles.mastheadState}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ display: 'grid', gap: 2 }}>
                    <Skeleton style={{ height: 12, maxWidth: 80 }} />
                    <Skeleton style={{ height: 18, maxWidth: 120 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className={styles.mastheadIds}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: 'grid', gap: 2 }}>
                <Skeleton style={{ height: 12, maxWidth: 80 }} />
                <Skeleton style={{ height: 18, maxWidth: 140 }} />
              </div>
            ))}
          </div>
        </div>
        <DetailGrid className={styles.topGrid}>
          <DetailCard>
            <Skeleton style={{ height: 18, maxWidth: 160 }} />
            <DetailFieldGrid className={styles.fields}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} style={{ height: 16 }} />
              ))}
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <Skeleton style={{ height: 18, maxWidth: 120 }} />
            <DetailFieldGrid className={styles.fields}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} style={{ height: 16 }} />
              ))}
            </DetailFieldGrid>
          </DetailCard>
          <DetailCard>
            <Skeleton style={{ height: 18, maxWidth: 80 }} />
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <Skeleton style={{ height: 36 }} />
              <Skeleton style={{ height: 36 }} />
            </div>
          </DetailCard>
        </DetailGrid>
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
    if (!iso) return 'Not Recorded';
    const born = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(born.valueOf())) return 'Not Recorded';
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    if (
      now.getMonth() < born.getMonth() ||
      (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
    )
      age -= 1;
    return age < 0 ? 'Not Recorded' : String(age);
  };
  const addressPartOf = (address: unknown, key: string): string => {
    if (!address || typeof address !== 'object') return '';
    const part = (address as Record<string, unknown>)[key];
    return typeof part === 'string' ? part.trim() : '';
  };
  // `company` groups are the company's own form columns: fifty-odd fields that
  // read as a spreadsheet, not as a record. They get their own tab as a dossier:
  // one card per block of the form, each with a tinted header that says what the
  // block is and what it is not.
  //
  // Two inks, one rule: mono is the machine's value (an identifier or a figure),
  // body type is what a person said. An operator looking for the total finds it
  // because it is the only mono row in its block.
  //
  // The header blurb is not decoration. Two of these blocks carry a warning the
  // operator needs before acting on them: the referral names do NOT establish a
  // reporting line, and the stated figures are NOT the sale total.
  const supplementaryGroup: {
    title: string;
    icon?: IconName;
    tone?: CompanyTone;
    blurb?: string;
    fields: Array<[string, ReactNode]>;
    company?: boolean;
  } = {
    // Supplementary block, SSOT order. Names and address are stored joined
    // (single text columns) and display as the two stored fields; AGE
    // derives from the supplementary birthday.
    title: 'Supplementary Member',
    icon: 'users',
    tone: 'info',
    blurb: 'Second holder, Gold only',
    company: true,
    fields: [
      ['SUPPLEMENTARY FULL NAME', stated(record.supplementaryFullName)],
      ['SUPPLEMENTARY ADDRESS', stated(record.supplementaryAddress)],
      ['BIRTHDAY', stated(record.supplementaryBirthday)],
      ['GENDER', stated(genderLabel(record.supplementaryGender))],
      ['AGE', ageOn(record.supplementaryBirthday)],
      ['CITIZENSHIP', stated(record.supplementaryCitizenship)],
      ['CIVIL STATUS', stated(record.supplementaryCivilStatus)],
      [
        'TIN NO.',
        statedMono(formatTin(record.supplementaryTinNumber) || record.supplementaryTinNumberMasked),
      ],
      ['LANDLINE', stated(record.supplementaryLandline)],
      ['MOBILE NO.', statedMono(record.supplementaryMobile)],
      ['EMAIL', stated(record.supplementaryEmail)],
      ['OCCUPATION / BUSINESS NAME', stated(record.supplementaryOccupationBusinessName)],
      ['OFFICE / BUSINESS ADDRESS', stated(record.supplementaryOfficeAddress)],
      ['EMPLOYED POSITION', stated(record.supplementaryPosition)],
    ],
  };

  const groups: Array<{
    title: string;
    /** Dossier presentation. Only the company blocks set these; the Overview
     *  cards are plain `DetailCard`s and carry none. */
    icon?: IconName;
    tone?: CompanyTone;
    blurb?: string;
    fields: Array<[string, ReactNode]>;
    /** Rendered under the field grid, full width. The ID image lives here. */
    footer?: ReactNode;
    company?: boolean;
  }> = [
    {
      title: 'Contact and Identity',
      fields: [
        ['Email', record.email],
        ['Phone', record.phone],
        ['Date of birth', record.dateOfBirth ?? 'Not Recorded'],
        [
          'Gender',
          genderLabel(record.gender) ?? 'Not Recorded',
        ],
        [
          'ID type',
          record.governmentIdType
            ? (GOVERNMENT_ID_TYPE_LABELS[
                record.governmentIdType as keyof typeof GOVERNMENT_ID_TYPE_LABELS
              ] ?? record.governmentIdType)
            : 'Not Recorded',
        ],
        // Only ever the masked form; the API never returns the number. When no
        // number is recorded, the scan itself stands in for the value.
        [
          'Government ID',
          record.governmentIdMasked ?? (
            <CustomerIdImage customerId={record.id} canView={canViewIdDocuments} />
          ),
        ],
      ],
    },
    {
      // Company-stated primary-member facts, SSOT order (see
      // customer-ssot.ts). STATUS here is the verbatim company value;
      // lifecycle state stays under Customer above. TIN shows the current
      // value so the editor can verify it; AGE derives from the birthday,
      // never stored.
      title: 'Primary Member',
      icon: 'user',
      tone: 'brand',
      blurb: 'Who holds the card',
      company: true,
      fields: [
        ['PAYMENT STATUS', stated(record.companyStatus)],
        ['FIRST NAME', stated(record.firstName)],
        ['LAST NAME', stated(record.lastName)],
        ['MIDDLE NAME', stated(record.middleName)],
        ['SUFFIX', stated(record.suffix)],
        ['BIRTHDAY', stated(record.dateOfBirth)],
        ['GENDER', stated(genderLabel(record.gender))],
        ['AGE', ageOn(record.dateOfBirth)],
        ['CITIZENSHIP', stated(record.citizenship)],
        ['CIVIL STATUS', stated(record.civilStatus)],
        ['PERMANENT ADDRESS LINE 1', stated(addressPartOf(record.address, 'line1'))],
        ['PERMANENT ADDRESS LINE 2', stated(addressPartOf(record.address, 'line2'))],
        ['PROVINCE', stated(addressPartOf(record.address, 'province'))],
        ['CITY', stated(addressPartOf(record.address, 'city'))],
        ['BARANGGAY', stated(addressPartOf(record.address, 'barangay'))],
        ['POSTAL CODE', statedMono(addressPartOf(record.address, 'postalCode'))],
        ['LANDLINE', stated(record.landline)],
        ['EMAIL', stated(record.email)],
        [
          'TIN NO.',
          statedMono(formatTin(record.tinNumber) || record.tinNumberMasked),
        ],
        ['MOBILE NO.', statedMono(record.phone)],
        ['OCCUPATION / BUSINESS NAME', stated(record.occupationBusinessName)],
        ['OFFICE / BUSINESS ADDRESS', stated(record.officeBusinessAddress)],
        ['EMPLOYED POSITION', stated(record.employedPosition)],
      ],
    },
    ...(hasSupplementaryRecord(record) ? [supplementaryGroup] : []),
    {
      // Stored verbatim as stated. These names do not assert reporting lines;
      // referral_relationships remains the only genealogy authority.
      title: 'Related Persons and Referral',
      icon: 'user-plus',
      tone: 'neutral',
      blurb: 'Stated names, not the genealogy',
      company: true,
      fields: [
        ['SVD (NAME)', stated(record.svdName)],
        ['SSM (NAME)', stated(record.ssmName)],
        ['SM (NAME)', stated(record.smName)],
        ['REFERRER (NAME)', stated(record.referrerName)],
        ['VIP RECOMMENDER (NAME)', stated(record.vipRecommenderName)],
        ['CONTACT NO.', stated(record.relatedContactNo)],
        ['EMAIL ADDRESS', stated(record.relatedEmail)],
      ],
    },
    {
      // Company-stated figures, verbatim. Server-computed money (verified
      // payments, snapshots, commissions) never reads these columns.
      title: 'Package and Payment (company stated)',
      icon: 'wallet',
      tone: 'gold',
      blurb: 'Company figures, not sale totals',
      company: true,
      fields: [
        ['VIP PACKAGE', stated(record.statedVipPackage)],
        ['PAYMENT TERMS', stated(record.statedPaymentTerms ? paymentSchemeLabel(record.statedPaymentTerms) : null)],
        ['REGULAR PRICE', statedMono(formatStatedMoney(record.statedRegularPrice))],
        ['DISCOUNT', statedMono(formatStatedMoney(record.statedDiscount))],
        ['TOTAL AMOUNT', statedMono(formatStatedMoney(record.statedTotalAmount))],
        ['Reservation Fee', statedMono(formatStatedMoney(record.statedRf))],
        ['PAYMENT TYPE', stated(record.statedPaymentType ? formatPaymentMethod(record.statedPaymentType) : null)],
        ['REF NO', statedMono(record.statedRefNo)],
        ['PAYMENT DATE', stated(record.statedPaymentDate)],
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
          record.membershipStatus ? <StatusChip label={humanizeCode(record.membershipStatus)} /> : 'None',
        ],
        ['VIP tier', <TierBadge tier={record.tier} />],
        [
          'Valid until',
          record.membershipExpiresAt ? formatDate(record.membershipExpiresAt) : 'Not applicable',
        ],
      ],
    },
  ];
  const workingGroups = groups.filter((group) => !group.company);
  const companyGroups = groups.filter((group) => group.company);

  return (
    <section className={styles.page}>
      {editing ? (
        <CustomerCompanyEditDialog
          customer={record}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={() => void customer.refetch()}
        />
      ) : null}
      {/* Record header: one card that owns the name and the facts about it. The
          state line (Status / Tier / Category / Portal account) is the person's
          standing; the rail below is the row it is in. The group boundary is
          the rail's stronger top rule, matching the prior strip's intent. */}
      <header className={styles.masthead}>
        <div className={styles.mastheadIdentity}>
          <span className={styles.monogram} aria-hidden="true">
            {customerInitials(record.fullName)}
          </span>
          <div className={styles.mastheadBody}>
            <h1 className={styles.mastheadName}>{record.fullName}</h1>
            <DetailFieldGrid className={styles.mastheadState}>
              <DetailField label="Status:">
                <StatusChip label={humanizeCode(record.status)} />
              </DetailField>
              <DetailField label="Tier:">
                <TierBadge tier={record.tier} />
              </DetailField>
              <DetailField label="Category:">
                {record.derivedCategory
                  ? CUSTOMER_CATEGORY_LABELS[record.derivedCategory]
                  : 'Not Recorded'}
              </DetailField>
              <DetailField label="Portal account:">
                {record.portalAccountActivated ? 'Activated' : 'Not activated'}
              </DetailField>
            </DetailFieldGrid>
          </div>
          {canEditCompany ? (
            <Button className={styles.mastheadAction} variant="secondary" onClick={() => setEditing(true)}>
              Edit stated record
            </Button>
          ) : null}
        </div>
        <DetailFieldGrid className={styles.mastheadIds}>
          <DetailField label="Customer ID (RA No.):">
            <DetailMono>{record.raNumber || 'Not Recorded'}</DetailMono>
          </DetailField>
          <DetailField label="Internal system reference:">
            <DetailMono>{record.customerNumber}</DetailMono>
          </DetailField>
          <DetailField label="Customer code:">
            {record.customerCode ? <DetailMono>{record.customerCode}</DetailMono> : 'Not Recorded'}
          </DetailField>
          <DetailField label="Registered:">
            {record.createdAt ? formatDateTime(record.createdAt) : 'Not Recorded'}
          </DetailField>
        </DetailFieldGrid>
      </header>
      <ImportContinuationPanel customerId={record.id} />
      <nav className={styles.tabs} aria-label="Customer record sections">
        {RECORD_TABS.filter((entry) => entry.id !== 'sales' || !salesHidden).map((entry) => (
          <Link
            key={entry.id}
            to={`?tab=${entry.id}`}
            className={entry.id === tab ? `${styles.tab} ${styles.tabCurrent}` : styles.tab}
            aria-current={entry.id === tab ? 'page' : undefined}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {tab === 'overview' ? (
        <>
          {salesHidden ? null : <SettlementStrip sales={sales.data ?? []} />}
          <DetailGrid className={styles.topGrid}>
            {workingGroups.map((group) => (
              <DetailCard key={group.title}>
                <DetailCardTitle>{group.title}</DetailCardTitle>
                <DetailFieldGrid className={styles.fields}>
                  {group.fields.map(([label, value]) => (
                    <DetailField
                      key={label}
                      label={label}
                      className={label === 'Government ID' ? styles.govIdField : undefined}
                    >
                      {value}
                    </DetailField>
                  ))}
                </DetailFieldGrid>
                {group.footer ? <div className={styles.groupFooter}>{group.footer}</div> : null}
              </DetailCard>
            ))}
            <CustomerRecordActions
              customer={record}
              sales={salesHidden ? [] : (sales.data ?? [])}
              onChanged={() => void customer.refetch()}
            />
          </DetailGrid>
        </>
      ) : null}
      {tab === 'sales' ? (
        salesHidden ? null : (
          <section aria-label="Sales and payments" className={styles.panel}>
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
            ) : sales.isError ? (
              <ErrorState
                error={sales.error}
                message={describeSalesLoadError(sales.error)}
                onRetry={sales.refetch}
              />
            ) : sales.data.length === 0 ? (
              <EmptyState
                title="No card sales yet."
                description="A sale appears here once the purchase is finalised in Finance."
              />
            ) : (
              <div className={styles.saleStack}>
                {sales.data.map((sale) => (
                  <CustomerSaleCard key={sale.id} sale={sale} />
                ))}
              </div>
            )}
          </section>
        )
      ) : null}
      {tab === 'company' ? (
        <div className={styles.dossier}>
          {companyGroups.map((group) => (
            <article key={group.title} className={styles.dossierCard}>
              <header
                className={`${styles.dossierHead} ${group.tone ? styles[`tone${group.tone}`] : ''}`}
              >
                {group.icon ? (
                  <span className={styles.dossierMark} aria-hidden="true">
                    <Icon name={group.icon} size={16} />
                  </span>
                ) : null}
                <h2 className={styles.dossierTitle}>{group.title}</h2>
                {group.blurb ? <p className={styles.dossierBlurb}>{group.blurb}</p> : null}
              </header>
              <DetailFieldGrid className={styles.dossierFields}>
                {group.fields.map(([label, value]) => (
                  <DetailField key={label} label={label}>
                    {value}
                  </DetailField>
                ))}
              </DetailFieldGrid>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const RECORD_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales and payments' },
  { id: 'company', label: 'Stated record' },
] as const;

/**
 * The screen's answer, above everything else: what this customer still owes.
 * The balance leads and the rest are its arithmetic, so one glance settles
 * the question. Money lives here and only here; the Sales panel carries the
 * payment ledger behind it, never a second copy of these totals.
 */
function SettlementStrip({ sales }: { sales: Sale[] }) {
  if (sales.length === 0)
    return (
      <section className={styles.settlementEmpty} aria-label="Outstanding balance">
        <span className={styles.settlementEmptyMark} aria-hidden="true">
          <Icon name="wallet" size={22} />
        </span>
        <div className={styles.settlementEmptyBody}>
          <h3 className={styles.settlementEmptyTitle}>No card sales yet</h3>
          <p className={styles.settlementEmptyText}>Nothing outstanding for this customer yet.</p>
        </div>
      </section>
    );
  return (
    <section className={styles.settlement} aria-label="Outstanding balance">
      {sales.map((sale) => (
        <div key={sale.id} className={styles.settlementRow}>
          <div className={styles.settlementLead}>
            <span className={styles.settlementLabel}>
              Balance on <DetailMono>{sale.saleNumber}</DetailMono>
            </span>
            <span className={styles.settlementValue}>{formatMoneyOrDash(sale.balance)}</span>
          </div>
          <dl className={styles.settlementFacts}>
            <DetailField label="Card">{sale.productName}</DetailField>
            <DetailField label="Scheme">{paymentSchemeLabel(sale.paymentScheme)}</DetailField>
            <DetailField label="Total">{formatMoneyOrDash(sale.cashPrice)}</DetailField>
            <DetailField label="Paid">{formatMoneyOrDash(sale.paidAmount)}</DetailField>
          </dl>
          <SettlementBadge total={sale.cashPrice} paid={sale.paidAmount} balance={sale.balance} />
        </div>
      ))}
    </section>
  );
}

/**
 * One sale and its payment ledger. The money figures are NOT repeated here:
 * they live once, in the settlement strip on Overview, so a figure can never
 * show up twice and disagree with itself.
 */
function CustomerSaleCard({ sale }: { sale: Sale }) {
  const payments = useQuery({
    queryKey: businessKeys.salePayments(sale.id),
    queryFn: () => getSalePayments(sale.id),
    placeholderData: keepPreviousData,
  });
  return (
    <DetailCard>
      <DetailCardTitle>Sale {sale.saleNumber}</DetailCardTitle>
      <DetailFieldGrid className={styles.fields}>
        <DetailField label="Card">{sale.productName}</DetailField>
        <DetailField label="Scheme">{paymentSchemeLabel(sale.paymentScheme)}</DetailField>
        <DetailField label="Seller">{sale.sellerName ?? 'Not Recorded'}</DetailField>
        <DetailField label="Activation status">
          {sale.activatedAt ? 'Active' : 'Not activated'}
        </DetailField>
        <DetailField label="Created">
          {sale.createdAt ? formatDateTime(sale.createdAt) : 'Not Recorded'}
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

const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'VI']);

/** Two-letter monogram for a record header. Suffixes (JR., III, ...) are
 *  skipped so "MARIA SANTOS JR." still reads "MS". */
function customerInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((word) => !NAME_SUFFIXES.has(word.replace(/\./g, '').toUpperCase()));
  if (meaningful.length === 0) return 'C';
  const first = meaningful[0]?.[0] ?? '';
  const last = meaningful.length > 1 ? (meaningful[meaningful.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}
