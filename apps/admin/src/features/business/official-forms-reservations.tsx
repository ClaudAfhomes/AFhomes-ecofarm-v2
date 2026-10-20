/**

 * Reservation-agreement pages.

 *

 * IST contracts: the queue, the editor, and the origin/membership panels.

 */

import { downloadFile as saveFile } from '../../lib/download';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type {
  ActivationResult,
  ApplicationHolder,
  PurchaseDocumentKind,
  PurchaseReservation,
  ReservationFinanceSummary,
} from '@afhomes/contracts';
import { createReservationAgreementSchema, paymentSchemeLabel } from '@afhomes/contracts';
import { formatDateTime } from '../../lib/format';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { useSession } from '../../lib/session';
import { downloadFile } from '../../lib/download';
import { formatCount, formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { applicationKeys, businessKeys, membershipKeys, reservationKeys, sharedScopes } from './queryKeys';
import {
  notifySuccess,
  notifyWarning,
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import styles from './OfficialFormsPages.module.css';
import { TierBadge } from './TierBadge';
import { ReservationStatusBadge } from './ReservationStatusBadge';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import {
  createReservationAgreement,
  decideReservationAgreement,
  exportReservationAgreement,
  getCardProducts,
  getCustomerApplication,
  getCustomerApplications,
  getOfficialFormTemplate,
  getPurchaseTermsProposal,
  getReservationPayments,
  getReservationFinance,
  activateSale,
  exportPurchaseDocument,
  finalizeReservationPurchase,
  getReservationAgreement,
  getReservationAgreementsPage,
  getSaleSummary,
  getSales,
  previewOfficialFormImport,
  reopenReservationAgreement,
  submitReservationAgreement,
  updateReservationAgreement,
  updateApplicationReservation,
} from './services';
import { RecordPaymentDialog } from './BusinessFinanceQueuePage';

import { humanizeApplicationIssues } from './official-forms-applications';

import {
  today,
  asBase64,
  formatFileSize,
  fieldLabel,
  filterReservationFieldInput,
  VIP_TIER_FIELD_OPTIONS,
  isVipTier,
  Field,
  QUEUE_PAGE_SIZE,
} from './official-forms-fields';

export function ReservationAgreementsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  // Default: only agreements that still need IST RESERVATION work. Executing
  // one hands collection to Finance, so it leaves this queue. Nothing is
  // deleted - 'Include progressed' brings the executed history back.
  const [reservationWorkOnly, setReservationWorkOnly] = useState(true);
  // Realtime search: pagination resets only when the settled term changes.
  const settledSearch = useRef('');
  const debouncedSearch = useDebouncedValue(search, 300, (term) => {
    const next = term.trim();
    if (next === settledSearch.current) return;
    settledSearch.current = next;
    setPage(0);
  });
  const query = useQuery({
    queryKey: reservationKeys.list(status, tier, debouncedSearch, reservationWorkOnly, page),
    // Keep the previous page visible while the next one loads: without this
    // the data gap reads as an empty result during every page turn.
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      getReservationAgreementsPage({
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(reservationWorkOnly ? { queue: 'reservation_work' as const } : {}),
        limit: QUEUE_PAGE_SIZE,
        offset: page * QUEUE_PAGE_SIZE,
      }),
    // Agreement decisions happen in review screens and other sessions.
    refetchInterval: 30_000,
  });
  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  // A shrunken result can leave the page past the last one. Correct during
  // render on a total change (the documented previous-value pattern, not an
  // effect); display clamps meanwhile.
  const [prevTotal, setPrevTotal] = useState(total);
  if (prevTotal !== total) {
    setPrevTotal(total);
    if (page > pageCount - 1) setPage(pageCount - 1);
  }
  const safePage = Math.min(page, pageCount - 1);
  // First load skeletonizes the whole page - header, filters, and table - so
  // no static content flashes before the data it describes. Refetches keep the
  // previous list visible and never reach this branch.
  if (query.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading reservations"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 180 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
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
  const pendingSignatures = rows.filter(
    (item) =>
      item.primarySignatureStatus !== 'received' ||
      (item.hasSecondaryHolder && item.secondarySignatureStatus !== 'received'),
  ).length;
  return (
    <section className={styles.listSection}>
      <PageHeader
        title="IST Reservation Agreements"
        description="Only agreements needing reservation work."
        actions={
          <Button onClick={() => navigate('/admin/sales/reservations/new')}>New agreement</Button>
        }
      />
      {/*
       * Two figures, not a sentence. "38 agreements - 3 awaiting signature" read
       * as one grey line, so the only number anyone acts on was the one you had
       * to hunt for. As figures the exception carries its own weight, and the
       * warning tone appears only when there is something to warn about.
       */}
      {total > 0 ? (
        <dl
          className={styles.queueSummary}
          role="status"
          aria-label="Reservation queue summary"
        >
          <div className={styles.queueSummaryCell}>
            <dt>{total === 1 ? 'Agreement' : 'Agreements'}</dt>
            <dd>{formatCount(total)}</dd>
          </div>
          <div
            className={styles.queueSummaryCell}
            data-alert={pendingSignatures > 0 ? 'true' : undefined}
          >
            <dt>Awaiting signature</dt>
            <dd>{formatCount(pendingSignatures)}</dd>
          </div>
        </dl>
      ) : null}
      <FilterBar
        filtersToggleLabel="Expand Filters"
        search={
          <SearchField
            label="Search reservation agreements"
            placeholder="Reservation number"
            value={search}
            onChange={setSearch}
            busy={query.isPending}
          />
        }
        filters={
          <>
            <label className={styles.filterLabel}>
              Queue
              <Select
                aria-label="Queue"
                value={reservationWorkOnly ? 'reservation_work' : 'all'}
                onChange={(e) => {
                  setReservationWorkOnly(e.target.value === 'reservation_work');
                  setPage(0);
                }}
                options={[
                  { value: 'reservation_work', label: 'Needs reservation work' },
                  { value: 'all', label: 'Include progressed' },
                ]}
              />
            </label>
            <label className={styles.filterLabel}>
              Status
              <Select
                aria-label="Status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
                options={[
                  { value: '', label: 'All' },
                  ...['draft', 'submitted', 'executed', 'cancelled'].map((s) => ({
                    value: s,
                    label: s[0]!.toUpperCase() + s.slice(1),
                  })),
                ]}
              />
            </label>
            <label className={styles.filterLabel}>
              Tier
              <Select
                aria-label="Tier"
                value={tier}
                onChange={(e) => {
                  setTier(e.target.value);
                  setPage(0);
                }}
                options={[
                  { value: '', label: 'All' },
                  ...['BRONZE', 'SILVER', 'GOLD'].map((t) => ({ value: t, label: t })),
                ]}
              />
            </label>
          </>
        }
      />
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Agreements could not be loaded"
          onRetry={() => void query.refetch()}
        />
      ) : rows.length ? (
        <div
          role="region"
          aria-label="Reservation agreement records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
        >
          <table className={styles.queueTable}>
            <thead>
              <tr>
                <th>Reservation</th>
                <th>Applicant</th>
                <th>Tier</th>
                <th>Payment scheme</th>
                <th className={styles.numeric}>Amount</th>
                <th>Signatures</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const signaturesComplete =
                  item.primarySignatureStatus === 'received' &&
                  (!item.hasSecondaryHolder || item.secondarySignatureStatus === 'received');
                return (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Review reservation ${item.reservationNumber}`}
                    onClick={() => navigate(`/admin/sales/reservations/${item.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ')
                        navigate(`/admin/sales/reservations/${item.id}`);
                    }}
                    className={styles.clickable}
                  >
                    <td data-label="Reservation">
                      <span className={styles.resRef}>
                        <span className={styles.resRefDot} aria-hidden="true" />
                        {item.reservationNumber}
                      </span>
                    </td>
                    <td data-label="Applicant">{item.applicantName ?? '—'}</td>
                    <td data-label="Tier">
                      <TierBadge tier={item.tier} />
                    </td>
                    <td data-label="Payment scheme">{paymentSchemeLabel(item.paymentScheme)}</td>
                    <td data-label="Amount" className={styles.numeric}>
                      {formatMoneyOrDash(item.totalPrice)}
                    </td>
                    <td data-label="Signatures">
                      {/*
                       * The exception wears the colour. Four rows of green
                       * "Complete" say nothing and drown the one row that is
                       * actually waiting on somebody, so the settled state
                       * recedes to quiet text and only the pending one is a chip.
                       */}
                      {signaturesComplete ? (
                        <span className={styles.settled}>Complete</span>
                      ) : (
                        <StatusChip label="Pending signature" tone="warning" />
                      )}
                    </td>
                    <td data-label="Status">
                      <ReservationStatusBadge status={item.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No reservation agreements"
          description="Create an agreement from an approved application."
        />
      )}

      {total > 0 ? (
        <div className={styles.pagination}>
          <Pagination
            page={safePage + 1}
            pageCount={pageCount}
            onChange={(next) => setPage(next - 1)}
            label="Reservation agreements pagination"
          />
        </div>
      ) : null}
    </section>
  );
}

export function ReservationAgreementEditorPage() {
  const [searchParams] = useSearchParams();
  const reservationRequest = useMutationRequest();
  const runReservationSave =
    useSingleFlight<Awaited<ReturnType<typeof createReservationAgreement>>>();
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [saleId, setSaleId] = useState('');
  const [customerApplicationId, setCustomerApplicationId] = useState(
    () => searchParams.get('application') ?? '',
  );
  const existing = useQuery({
    queryKey: reservationKeys.detail(id),
    queryFn: () => getReservationAgreement(id!),
    enabled: Boolean(id),
  });
  // Sales and card products are only needed in sale-origin mode (the agreement
  // attaches to an existing card sale). In application-origin mode the
  // reservation IS the first commercial document, so fetching them on mount is
  // wasted work. Gate them accordingly; the shared cache keeps them warm for
  // the sale-origin path.
  const sales = useQuery({
    queryKey: sharedScopes.sales,
    queryFn: () => getSales(),
    enabled: !customerApplicationId || Boolean(id),
  });
  const plans = useQuery({
    queryKey: sharedScopes.cardProducts,
    queryFn: () => getCardProducts(),
    enabled: !customerApplicationId || Boolean(id),
  });
  // The application list is only needed to pick one when none has been fixed
  // by the URL. In application-origin mode the application is already known, so
  // the full list is never read.
  const applications = useQuery({
    queryKey: applicationKeys.reservationSource,
    queryFn: () => getCustomerApplications(),
    enabled: !customerApplicationId,
  });
  const sourceApplication = useQuery({
    queryKey: applicationKeys.reservationSourceDetail(customerApplicationId),
    queryFn: () => getCustomerApplication(customerApplicationId),
    enabled: Boolean(customerApplicationId) && !id,
  });
  /**
   * Application-origin mode.
   *
   * Opening from an approved application means there is NO card sale to choose:
   * the reservation IS the first commercial document, and the sale arrives only
   * when Finance finalizes fully paid. The sale selector is therefore hidden
   * rather than disabled, so a first-time purchase can never be mistaken for one
   * that needs an existing sale.
   */
  const applicationOrigin =
    existing.data?.origin === 'application' || (!id && Boolean(customerApplicationId));
  // The frozen offer is the ONLY source of the economics shown here. It is
  // server-derived, and a stale copy is refreshed rather than reused.
  const proposal = useQuery({
    queryKey: reservationKeys.purchaseTermsReservationSource(customerApplicationId),
    queryFn: () => getPurchaseTermsProposal(customerApplicationId),
    enabled: applicationOrigin && !id,
    retry: false,
  });
  const reviewRequired =
    applicationOrigin &&
    proposal.isError &&
    /PURCHASE_TERMS_REVIEW_REQUIRED/i.test(
      (proposal.error as { message?: string } | null)?.message ?? '',
    );
  // Imported tier context (IST XLSX `vip_tier`). Display/validation only:
  // the server always derives the authoritative tier from the selected sale
  // and rejects a mismatch.
  const [vipTier, setVipTier] = useState('');
  const [dates, setDates] = useState({
    reservationDate: today(),
    agreementDate: today(),
    revisionNumber: '',
    monthlyAmortizationStart: '',
    monthlyAmortizationEnd: '',
    paymentDueDay: '',
  });
  const [primary, setPrimary] = useState({
    holderType: 'PRIMARY' as const,
    name: '',
    address: '',
    contactNumber: '',
    email: '',
    tinNumber: '',
  });
  type SecondaryState = {
    holderType: 'PRIMARY' | 'SECONDARY';
    name: string;
    address: string;
    contactNumber: string;
    email: string;
    tinNumber: string;
  };
  const [secondary, setSecondary] = useState<SecondaryState | null>(null);
  /** Chosen workbook for the IST bulk import, and whether it is still being read. */
  const [istFile, setIstFile] = useState<{ name: string; size: number } | null>(null);
  const [istReading, setIstReading] = useState(false);
  const istImportLabelId = useId();
  const [schedule, setSchedule] = useState({
    particular: 'Monthly amortization',
    amount: '0.00',
    paymentDate: '',
    remarks: '',
  });
  const setMessage = (message: string) => notifyWarning({ title: 'Attention', message });
  useEffect(() => {
    const app = sourceApplication.data;
    if (!app || id || !['submitted', 'approved'].includes(app.status)) return;
    // No primary holder means nothing safe to prefill. The server still refuses
    // the save, but the PAGE must not crash on a thin payload.
    if (!app.primary) return;
    const holder = (value: ApplicationHolder) => ({
      holderType: value.holderType,
      name: [value.firstName, value.middleName, value.lastName, value.suffix]
        .filter(Boolean)
        .join(' '),
      address: [
        value.permanentAddressLine1,
        value.permanentAddressLine2,
        // Barangay before the municipality, matching how a Philippine address is
        // written. It is simply absent for a legacy record, which keeps the old
        // string shape intact rather than inserting a blank segment.
        value.barangay,
        value.cityMunicipality,
        value.province,
        value.postalCode,
      ]
        .filter(Boolean)
        .join(', '),
      contactNumber: value.mobile,
      email: value.email,
      tinNumber: value.tinNumber ?? '',
    });
    const timer = window.setTimeout(() => {
      setPrimary({ ...holder(app.primary), holderType: 'PRIMARY' });
      setSecondary(app.secondary ? { ...holder(app.secondary), holderType: 'SECONDARY' } : null);
      setVipTier(app.tier);
      if (app.saleId) setSaleId(app.saleId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sourceApplication.data, id]);
  useEffect(() => {
    const agreement = existing.data;
    if (!agreement) return;
    const timer = window.setTimeout(() => {
      setSaleId(agreement.saleId ?? '');
      setCustomerApplicationId(agreement.customerApplicationId ?? '');
      setVipTier(agreement.tier);
      setDates({
        reservationDate: agreement.reservationDate,
        agreementDate: agreement.agreementDate,
        revisionNumber: agreement.revisionNumber ?? '',
        monthlyAmortizationStart: agreement.monthlyAmortizationStart ?? '',
        monthlyAmortizationEnd: agreement.monthlyAmortizationEnd ?? '',
        paymentDueDay: String(agreement.paymentDueDay ?? ''),
      });
      setPrimary({ ...agreement.primary, tinNumber: agreement.primary.tinNumber ?? '' });
      setSecondary(
        agreement.secondary
          ? {
              ...agreement.secondary,
              holderType: 'SECONDARY' as const,
              tinNumber: agreement.secondary.tinNumber ?? '',
            }
          : null,
      );
      const first = agreement.schedule[0];
      if (first)
        setSchedule({
          particular: first.particular,
          amount: first.amount,
          paymentDate: first.paymentDate ?? '',
          remarks: first.remarks ?? '',
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [existing.data]);
  /**
   * The ONLY fields an application-origin agreement can set.
   *
   * Deliberately absent: price, scheme, seller, commission, status, source ids and
   * every total. Those come from the immutable purchase-terms row, and a body
   * field for any of them would be a field the browser could lie in.
   */
  const agreedFields = () => ({
    agreementDate: dates.agreementDate,
    revisionNumber: dates.revisionNumber || undefined,
    monthlyAmortizationStart: dates.monthlyAmortizationStart || undefined,
    monthlyAmortizationEnd: dates.monthlyAmortizationEnd || undefined,
    paymentDueDay: dates.paymentDueDay ? Number(dates.paymentDueDay) : undefined,
    primarySignatureStatus: 'received' as const,
    secondarySignatureStatus: secondary ? ('received' as const) : undefined,
    scheduleNotes: [
      {
        ...schedule,
        paymentDate: schedule.paymentDate || undefined,
        remarks: schedule.remarks || undefined,
      },
    ],
  });
  const payload = () => ({
    // An unchosen sale stays absent: never send "" as a UUID.
    saleId: saleId || undefined,
    ...(customerApplicationId ? { customerApplicationId } : {}),
    ...(vipTier === 'BRONZE' || vipTier === 'SILVER' || vipTier === 'GOLD'
      ? { vipTier: vipTier as 'BRONZE' | 'SILVER' | 'GOLD' }
      : {}),
    ...dates,
    revisionNumber: dates.revisionNumber || undefined,
    monthlyAmortizationStart: dates.monthlyAmortizationStart || undefined,
    monthlyAmortizationEnd: dates.monthlyAmortizationEnd || undefined,
    paymentDueDay: dates.paymentDueDay ? Number(dates.paymentDueDay) : undefined,
    primary,
    secondary: secondary ? { ...secondary, holderType: 'SECONDARY' } : undefined,
    primarySignatureStatus: 'received',
    secondarySignatureStatus: secondary ? 'received' : undefined,
    scheduleNotes: [
      {
        ...schedule,
        paymentDate: schedule.paymentDate || undefined,
        remarks: schedule.remarks || undefined,
      },
    ],
  });
  const save = useBusinessMutation({
    mutationFn: () =>
      runReservationSave(() => {
        if (!id && !customerApplicationId) throw new Error('Choose eligible application first.');
        if (applicationOrigin) {
          if (id) {
            const fields = agreedFields();
            return updateApplicationReservation(id, {
              requestId: reservationRequest.forPayload({ id, ...fields }),
              ...fields,
            });
          }
          // The exact frozen terms reference comes from the APPLICATION, not from
          // the offer body: it is an identifier, and the server revalidates it
          // against the immutable row before writing anything.
          const termsId = sourceApplication.data?.purchaseTermsId;
          if (!termsId) throw new Error('No captured purchase terms. Review required first.');
          if (!proposal.data) throw new Error('Load current offer first.');
          return createReservationAgreement({
            origin: 'application',
            requestId: reservationRequest.forPayload({ application: customerApplicationId }),
            customerApplicationId,
            purchaseTermsId: termsId,
            reservationDate: dates.reservationDate,
            ...agreedFields(),
          });
        }
        if (!saleId) throw new Error('Select a sale for this reservation.');
        const checked = createReservationAgreementSchema.safeParse(payload());
        if (!checked.success) throw new Error(humanizeApplicationIssues(checked.error.issues));
        const body = checked.data;
        return id
          ? updateReservationAgreement(id, body)
          : createReservationAgreement({
              ...body,
              requestId: reservationRequest.forPayload(body),
            });
      }),
    onSuccess: (agreement) => {
      notifySuccess({ title: 'Success', message: 'Reservation saved.' });
      reservationRequest.complete();
      void client.invalidateQueries({ queryKey: reservationKeys.detail(agreement.id) });
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      // Creating the reservation hands this customer to the reservation/payment
      // stage, so the application must leave the active application queue now -
      // not at the next poll. A cancelled agreement returns it.
      if (agreement.customerApplicationId)
        void client.invalidateQueries({ queryKey: applicationKeys.scope });
      void client.invalidateQueries({ queryKey: applicationKeys.reservationsScope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
      void client.invalidateQueries({ queryKey: sharedScopes.reports });
      if (!id) navigate(`/admin/sales/reservations/${agreement.id}`, { replace: true });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Save failed.'),
  });
  const submit = useBusinessMutation({
    mutationFn: () => submitReservationAgreement(id!),
    onSuccess: () => {
      notifySuccess({ title: 'Success', message: 'Agreement submitted.' });
      void existing.refetch();
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Submit failed.'),
  });
  const decide = useBusinessMutation({
    mutationFn: (decision: 'executed' | 'cancelled') =>
      decideReservationAgreement(id!, decision, 'Reviewed by authorized seller.'),
    onSuccess: () => {
      notifySuccess({ title: 'Success', message: 'Decision recorded.' });
      void existing.refetch();
      void client.invalidateQueries({ queryKey: reservationKeys.detail(id) });
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      // Executing makes the agreement collectable (Finance queue) and
      // cancelling it returns the customer to application work.
      void client.invalidateQueries({ queryKey: businessKeys.queue });
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
      void client.invalidateQueries({ queryKey: applicationKeys.reservationsScope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
      void client.invalidateQueries({ queryKey: sharedScopes.reports });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Decision failed.'),
  });
  const reopen = useBusinessMutation({
    mutationFn: () => reopenReservationAgreement(id!),
    onSuccess: () => {
      notifySuccess({ title: 'Success', message: 'Agreement reopened as draft.' });
      void existing.refetch();
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Reopen failed.'),
  });
  const summary = useQuery({
    queryKey: sharedScopes.saleSummary(saleId),
    queryFn: () => getSaleSummary(saleId),
    enabled: Boolean(saleId),
  });
  const autoFill = () => {
    const sale = sales.data?.find((s) => s.id === saleId);
    if (!sale) {
      setMessage('Select a card sale first.');
      return;
    }
    setPrimary((prev) => ({
      ...prev,
      name: prev.name || sale.customerName,
    }));
    setMessage('Prefilled from sale. Verify before saving.');
  };
  const importIstFile = async (file: File) => {
    const preview = await previewOfficialFormImport('reservation_agreement', await asBase64(file));
    if (preview.errors.length) {
      setMessage(preview.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
      return;
    }
    const f = preview.fields;
    if (f.sale_id) setSaleId(f.sale_id);
    if (f.customer_application_id) setCustomerApplicationId(f.customer_application_id);
    // A workbook cell can hold anything. Only a real tier may reach the closed
    // dropdown: setting an unknown value would leave the state out of step with
    // the displayed option, and the server would reject it anyway.
    const importedTier = (f.vip_tier ?? '').toUpperCase();
    if (isVipTier(importedTier)) setVipTier(importedTier);
    if (f.reservation_date)
      setDates((d) => ({ ...d, reservationDate: f.reservation_date ?? d.reservationDate }));
    if (f.agreement_date)
      setDates((d) => ({ ...d, agreementDate: f.agreement_date ?? d.agreementDate }));
    if (f.revision_number !== undefined)
      setDates((d) => ({ ...d, revisionNumber: f.revision_number ?? d.revisionNumber }));
    setPrimary((prev) => ({
      ...prev,
      name: f.primary_name ?? prev.name,
      address: f.primary_address ?? prev.address,
      contactNumber: f.primary_contact_number ?? prev.contactNumber,
      email: f.primary_email ?? prev.email,
      tinNumber: f.primary_tin ?? prev.tinNumber,
    }));
    if (f.secondary_enabled === 'true')
      setSecondary((prev) => ({
        holderType: 'SECONDARY' as const,
        name: f.secondary_name ?? prev?.name ?? '',
        address: f.secondary_address ?? prev?.address ?? '',
        contactNumber: f.secondary_contact_number ?? prev?.contactNumber ?? '',
        email: f.secondary_email ?? prev?.email ?? '',
        tinNumber: f.secondary_tin ?? prev?.tinNumber ?? '',
      }));
    setSchedule((prev) => ({
      particular: f.schedule_particular || prev.particular,
      amount: f.schedule_amount || prev.amount,
      paymentDate: f.schedule_payment_date || prev.paymentDate,
      remarks: f.schedule_remarks || prev.remarks,
    }));
    setMessage('Imported candidates ready. Verify every field.');
  };
  const editable = !existing.data || existing.data.status === 'draft';
  const salePlan = plans.data?.find((p) => p.id === summary.data?.saleId);
  return (
    <section className={styles.editorSection}>
      <PageHeader
        title={existing.data?.reservationNumber ?? 'New IST Reservation Agreement'}
        description="Server-derived snapshots. Schedule rows are obligations."
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/sales/reservations')}>
            Back to agreements
          </Button>
        }
      />
      {/*
       * Figures, not a sentence. "Status: draft - Tier: SILVER - Total: 60000.00
       * - Verified received: ..." read as one run of prose with the labels
       * bolded inline, so no fact outranked another and the eye had nowhere to
       * land first. As a divided strip the lifecycle state leads, the money
       * lines up under it, and the timestamps sit quiet at the end.
       */}
      {existing.data ? (
        <dl className={styles.stateSummary} aria-label="Agreement state">
          <div className={styles.stateSummaryCell}>
            <dt>Status</dt>
            <dd>
              <ReservationStatusBadge status={existing.data.status} />
            </dd>
          </div>
          <div className={styles.stateSummaryCell}>
            <dt>Tier</dt>
            <dd>{existing.data.tier}</dd>
          </div>
          {/*
           * Money lives in ONE place. A sale-origin agreement has no detail
           * panel below, so the strip carries it; an application-origin one
           * already shows the frozen figures in the Server offer panel, and
           * repeating them here would put the same peso on screen twice.
           */}
          {!applicationOrigin ? (
            <>
              <div className={styles.stateSummaryCell}>
                <dt>Total</dt>
                <dd>{formatMoneyOrDash(existing.data.totalPrice)}</dd>
              </div>
              <div className={styles.stateSummaryCell}>
                <dt>Verified received</dt>
                <dd>{formatMoneyOrDash(existing.data.totalPaymentReceived)}</dd>
              </div>
              {/* A zero balance means fully paid, which is the good state - so
                  the warning tone belongs to an outstanding balance only. */}
              <div
                className={styles.stateSummaryCell}
                data-alert={Number(existing.data.balance) > 0 ? 'true' : undefined}
              >
                <dt>Balance</dt>
                <dd>{formatMoneyOrDash(existing.data.balance)}</dd>
              </div>
            </>
          ) : null}
          <div className={styles.stateSummaryCell}>
            <dt>Submitted</dt>
            <dd>{existing.data.submittedAt ? formatDateTime(existing.data.submittedAt) : '—'}</dd>
          </div>
          <div className={styles.stateSummaryCell}>
            <dt>Executed</dt>
            <dd>{existing.data.executedAt ? formatDateTime(existing.data.executedAt) : '—'}</dd>
          </div>
        </dl>
      ) : null}
      {summary.data ? (
        <p className={styles.moneyNote}>
          <span>
            Linked sale <strong>{summary.data.saleId}</strong>: verified{' '}
            {formatMoneyOrDash(summary.data.verifiedTotal)}, balance{' '}
            {formatMoneyOrDash(summary.data.remainingBalance)}.
          </span>
          <span>Schedule shows obligations only. Cash lives in payments ledger.</span>
        </p>
      ) : null}
      {salePlan ? (
        <p className={styles.note}>Benefits apply prospectively. Snapshot freezes at creation.</p>
      ) : null}
      {reviewRequired ? (
        <Alert variant="warning">
          <strong>Review required first.</strong> Confirm server offer with reason.{' '}
          <Link to={`/admin/customers/applications/${customerApplicationId}`}>
            Open the application review
          </Link>
          .
        </Alert>
      ) : null}
      {applicationOrigin && proposal.data ? (
        <section className={styles.panel} aria-label="Frozen purchase terms">
          <h2 className={styles.panelTitle}>Server offer</h2>
          <p className={styles.panelNote}>Read-only frozen terms. Server revalidates on save.</p>
          <dl className={styles.snapshotGrid}>
            <div className={styles.snapshotField}>
              <dt>Card tier</dt>
              <dd>{proposal.data.terms.tier}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Payment scheme</dt>
              <dd>{paymentSchemeLabel(proposal.data.terms.paymentScheme)}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Total purchase</dt>
              <dd>{formatMoneyOrDash(proposal.data.terms.totalPrice)}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Included reservation amount</dt>
              <dd>{formatMoneyOrDash(proposal.data.terms.reservationFee)}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Required initial</dt>
              <dd>{formatMoneyOrDash(proposal.data.terms.requiredInitial)}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Monthly amount</dt>
              <dd>{formatMoneyOrDash(proposal.data.terms.monthlyAmount)}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Installment months</dt>
              <dd>{proposal.data.terms.installmentMonths ?? '—'}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Seller</dt>
              <dd>{proposal.data.sellerName || 'Seller name unavailable'}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Benefits</dt>
              <dd>{proposal.data.terms.inclusions.length} captured item(s)</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Purchase terms reference</dt>
              <dd>{sourceApplication.data?.purchaseTermsId ?? 'Not captured'}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Offer as of</dt>
              <dd>{formatDateTime(proposal.data.asOf)}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      <fieldset disabled={!editable} className={styles.formRoot}>
        <section className={styles.panel} aria-labelledby="reservation-source-heading">
          <h2 id="reservation-source-heading" className={styles.panelTitle}>
            Source &amp; references
          </h2>
          <p className={styles.panelNote}>Link application or sale here.</p>
          <div className={styles.editorGrid}>
            {/* Application-origin reservations have NO sale: the agreement comes
                first and the sale arrives at finalization. */}
            {applicationOrigin ? null : (
              <>
                <label className={styles.filterLabel}>
                  Card sale
                  <Select
                    aria-label="Card sale"
                    value={saleId}
                    loading={sales.isPending}
                    onChange={(e) => setSaleId(e.target.value)}
                    options={[
                      { value: '', label: 'Select sale' },
                      ...(sales.data?.map((sale) => ({
                        value: sale.id,
                        label: `${sale.saleNumber} — ${sale.customerName}`,
                      })) ?? []),
                    ]}
                  />
                </label>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={autoFill}>
                    Auto-fill from sale
                  </Button>
                </div>
              </>
            )}
            <label className={styles.filterLabel}>
              Source Customer Application
              <Select
                aria-label="Source Customer Application"
                value={customerApplicationId}
                loading={applications.isPending}
                onChange={(e) => setCustomerApplicationId(e.target.value)}
                options={[
                  { value: '', label: 'Choose a submitted or approved application' },
                  ...(applications.data
                    ?.filter((app) => ['submitted', 'approved'].includes(app.status))
                    .map((app) => ({
                      value: app.id,
                      label: `${app.applicationNumber} — ${app.applicantName}`,
                    })) ?? []),
                ]}
              />
            </label>
            <label className={styles.filterLabel}>
              Imported Tier
              <Select
                aria-label="Imported Tier"
                value={vipTier}
                onChange={(e) => setVipTier(e.target.value)}
                options={VIP_TIER_FIELD_OPTIONS}
              />
            </label>
          </div>
          {sourceApplication.data ? (
            <p className={styles.note}>
              Copied from {sourceApplication.data.applicationNumber}. Verify before saving.
            </p>
          ) : null}
        </section>
        <section className={styles.panel} aria-labelledby="reservation-dates-heading">
          <h2 id="reservation-dates-heading" className={styles.panelTitle}>
            Agreement dates
          </h2>
          <p className={styles.panelNote}>Dates bounding this agreement.</p>
          <div className={styles.editorGrid}>
            {Object.entries(dates).map(([key, value]) => (
              <Field
                key={key}
                label={fieldLabel(key)}
                value={value}
                type={
                  key.toLowerCase().includes('date') || key.includes('Start') || key.includes('End')
                    ? 'date'
                    : 'text'
                }
                onChange={(v) => setDates({ ...dates, [key]: v })}
              />
            ))}
          </div>
        </section>
        <section className={styles.panel} aria-labelledby="reservation-primary-heading">
          <h2 id="reservation-primary-heading" className={styles.panelTitle}>
            Primary cardholder
          </h2>
          <p className={styles.panelNote}>Signing owner of this reservation.</p>
          <div className={styles.editorGrid}>
            {Object.entries(primary)
              .filter(([key]) => key !== 'holderType')
              .map(([key, value]) => (
                <Field
                  key={key}
                  label={fieldLabel(key)}
                  value={value}
                  normalize={(v) => filterReservationFieldInput(key, v)}
                  onChange={(v) => setPrimary({ ...primary, [key]: v })}
                />
              ))}
          </div>
        </section>
        <section className={styles.panel} aria-labelledby="reservation-secondary-heading">
          <h2 id="reservation-secondary-heading" className={styles.panelTitle}>
            Supplementary cardholder
          </h2>
          <label className={styles.toggleCard}>
            <input
              type="checkbox"
              checked={Boolean(secondary)}
              onChange={(e) =>
                setSecondary(
                  e.target.checked
                    ? {
                        holderType: 'SECONDARY' as const,
                        name: '',
                        address: '',
                        contactNumber: '',
                        email: '',
                        tinNumber: '',
                      }
                    : null,
                )
              }
            />
            <span className={styles.toggleText}>
              <span className={styles.toggleTitle}>
                Add optional supplementary holder (Gold only)
              </span>
              <span className={styles.toggleHint}>The server rejects other tiers.</span>
            </span>
          </label>
          {secondary ? (
            <div className={styles.editorGrid}>
              {Object.entries(secondary)
                .filter(([key]) => key !== 'holderType')
                .map(([key, value]) => (
                  <Field
                    key={key}
                    label={fieldLabel(key)}
                    value={value}
                    normalize={(v) => filterReservationFieldInput(key, v)}
                    onChange={(v) => setSecondary({ ...secondary, [key]: v })}
                  />
                ))}
            </div>
          ) : null}
        </section>
        <section className={styles.panel} aria-labelledby="reservation-schedule-heading">
          <h2 id="reservation-schedule-heading" className={styles.panelTitle}>
            Payment plan schedule
          </h2>
          <p className={styles.panelNote}>
            Obligations only, not payments. Cash lives in payments ledger.
          </p>
          <div className={styles.editorGrid}>
            {Object.entries(schedule).map(([key, value]) => (
              <Field
                key={key}
                label={fieldLabel(key)}
                value={value}
                type={key === 'paymentDate' ? 'date' : 'text'}
                onChange={(v) => setSchedule({ ...schedule, [key]: v })}
              />
            ))}
          </div>
        </section>
        <section className={styles.panel} aria-labelledby="reservation-import-heading">
          <h2 id="reservation-import-heading" className={styles.panelTitle}>
            Bulk import
          </h2>
          <p className={styles.panelNote}>Import workbook candidates. Verify every field.</p>
          <div className={styles.importCard} data-selected={istFile ? 'true' : 'false'}>
            <div className={styles.importHead}>
              <span className={styles.importTitle} id={istImportLabelId}>
                Import IST XLSX
              </span>
              <span className={styles.importHint}>
                Choose official workbook. Verify imported values.
              </span>
            </div>
            <div className={styles.importControls}>
              <label className={styles.filePicker}>
                <input
                  className={styles.fileInput}
                  type="file"
                  accept=".xlsx"
                  aria-labelledby={istImportLabelId}
                  disabled={istReading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setIstFile({ name: file.name, size: file.size });
                    setIstReading(true);
                    void importIstFile(file).finally(() => setIstReading(false));
                  }}
                />
              </label>
              <Button
                variant="secondary"
                onClick={() => void getOfficialFormTemplate('ist').then(saveFile)}
              >
                Download import template
              </Button>
            </div>
            <p className={styles.fileName} role="status">
              {istFile
                ? `${istFile.name} · ${formatFileSize(istFile.size)}${
                    istReading ? ' · reading…' : ''
                  }`
                : 'No workbook chosen yet.'}
            </p>
          </div>
        </section>
      </fieldset>
      <div className={styles.stickyFooter}>
        <div className={styles.buttonRow}>
          <Button
            onClick={() => save.mutate()}
            disabled={!editable}
            loading={save.isPending}
            loadingLabel="Saving…"
          >
            {applicationOrigin && !id ? 'Create Reservation Agreement' : 'Save draft'}
          </Button>
          {id && editable ? (
            <Button
              variant="secondary"
              onClick={() => submit.mutate()}
              loading={submit.isPending}
              loadingLabel="Submitting…"
            >
              Submit
            </Button>
          ) : null}
          {id && existing.data?.status === 'submitted' ? (
            <Button
              onClick={() => decide.mutate('executed')}
              loading={decide.isPending}
              loadingLabel="Executing…"
            >
              Execute
            </Button>
          ) : null}
          {id && (existing.data?.status === 'draft' || existing.data?.status === 'submitted') ? (
            <Button
              variant="danger"
              onClick={() => decide.mutate('cancelled')}
              loading={decide.isPending}
              loadingLabel="Cancelling…"
            >
              Cancel
            </Button>
          ) : null}
          {id && existing.data?.status === 'submitted' ? (
            <Button
              variant="secondary"
              onClick={() => reopen.mutate()}
              loading={reopen.isPending}
              loadingLabel="Reopening…"
            >
              Reopen to draft
            </Button>
          ) : null}
          <span className={styles.spacer} />
          {id ? (
            <>
              <Button
                variant="primary"
                onClick={() =>
                  void exportReservationAgreement(id, 'xlsx')
                    .then(saveFile)
                    .catch((e: unknown) =>
                      setMessage(e instanceof Error ? e.message : 'Export failed.'),
                    )
                }
              >
                Export XLSX
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  void exportReservationAgreement(id, 'pdf')
                    .then(saveFile)
                    .catch((e: unknown) =>
                      setMessage(e instanceof Error ? e.message : 'Export failed.'),
                    )
                }
              >
                Export PDF
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {id && existing.data?.origin === 'application' ? (
        <ApplicationOriginAgreementPanel id={id} agreement={existing.data} />
      ) : null}
    </section>
  );
}

/**
 * The application-origin agreement after creation: lifecycle state, money, the
 * one payment ledger, and the historical prints.
 *
 * Nothing here recalculates money. Every figure is the server's, and the Finalize
 * button follows the server's own eligibility rather than a browser total.
 */
function ApplicationOriginAgreementPanel({
  id,
  agreement,
}: {
  id: string;
  agreement: Extract<PurchaseReservation, { origin: 'application' }>;
}) {
  const client = useQueryClient();
  const { user } = useSession();
  const canHandlePayments =
    user?.afHomesPermissions.some(
      (permission) =>
        permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
    ) ?? false;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const finance = useQuery({
    queryKey: reservationKeys.finance(id),
    queryFn: () => getReservationFinance(id),
    retry: false,
  });
  const payments = useQuery({
    queryKey: reservationKeys.payments(id),
    queryFn: () => getReservationPayments(id),
    retry: false,
  });
  const afterMutation = async () => {
    await client.invalidateQueries({ queryKey: reservationKeys.scope });
    await client.invalidateQueries({ queryKey: reservationKeys.detail(id) });
    await client.invalidateQueries({ queryKey: reservationKeys.finance(id) });
    await client.invalidateQueries({ queryKey: reservationKeys.payments(id) });
    // Execution makes the agreement collectable, so Finance readiness must move
    // in the same breath. A stale queue is how a customer is told "nothing to pay".
    await client.invalidateQueries({ queryKey: businessKeys.queue });
    await client.invalidateQueries({ queryKey: businessKeys.sales });
    // No query uses the `activation-queue` segment (the queue key is
    // `queue/activation`), so this is a no-op kept as-is pending review.
    await client.invalidateQueries({ queryKey: ['business', 'activation-queue'] });
    await client.invalidateQueries({ queryKey: sharedScopes.reports });
  };
  const print = async (kind: PurchaseDocumentKind, label: string, sourceId = id) => {
    setError(null);
    try {
      setBusy(true);
      downloadFile(await exportPurchaseDocument(sourceId, kind));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };
  const finalize = async () => {
    setError(null);
    try {
      setBusy(true);
      await finalizeReservationPurchase(id, crypto.randomUUID());
      await afterMutation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Finalization failed.');
    } finally {
      setBusy(false);
    }
  };
  const money = finance.data;
  const lifecycle = agreement.status;
  return (
    <section className={styles.editorSection} aria-label="Reservation lifecycle">
      <h2 className={styles.panelTitle}>Purchase state</h2>
      {error ? <Alert variant="warning">{error}</Alert> : null}
      <dl className={styles.snapshotGrid}>
        <div className={styles.snapshotField}>
          <dt>Agreement state</dt>
          <dd>
            <StatusChip label={lifecycle} />
          </dd>
        </div>
        <div className={styles.snapshotField}>
          <dt>Card Sale (AF-CSALE)</dt>
          <dd>
            {money?.saleNumber ??
              agreement.saleId ??
              'Not created — created when the purchase is finalized'}
          </dd>
        </div>
        <div className={styles.snapshotField}>
          <dt>Total purchase</dt>
          <dd>{formatMoneyOrDash(money?.totalPrice ?? agreement.totalPrice)}</dd>
        </div>
        <div className={styles.snapshotField}>
          <dt>Included reservation amount</dt>
          <dd>{formatMoneyOrDash(money?.reservationFee ?? agreement.reservationFee)}</dd>
        </div>
        <div className={styles.snapshotField}>
          <dt>Verified paid</dt>
          <dd>{formatMoneyOrDash(money?.verifiedTotal ?? '0.00')}</dd>
        </div>
        <div className={styles.snapshotField}>
          <dt>Remaining</dt>
          <dd>{formatMoneyOrDash(money?.remainingBalance ?? agreement.balance)}</dd>
        </div>
        {money?.overpaidAmount && money.overpaidAmount !== '0.00' ? (
          <div className={styles.snapshotField}>
            <dt>Overpaid</dt>
            <dd>{formatMoneyOrDash(money.overpaidAmount)}</dd>
          </div>
        ) : null}
      </dl>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={() => void print('reservation', 'Reservation')}
          disabled={busy}
          loading={busy}
        >
          Print Reservation Agreement
        </Button>
        {money?.fullyPaid ? (
          <Button
            onClick={() => void finalize()}
            disabled={!canHandlePayments || busy}
            loading={busy}
            title={
              canHandlePayments
                ? 'Creates exactly one card sale from the verified payments.'
                : 'Requires the finance payment verification grant.'
            }
          >
            Finalize Purchase
          </Button>
        ) : null}
        {lifecycle === 'executed' && !money?.fullyPaid ? (
          <Button
            variant="secondary"
            onClick={() => setRecording(true)}
            disabled={busy || !canHandlePayments}
            loading={busy}
          >
            Record Payment
          </Button>
        ) : null}
      </div>
      {lifecycle === 'executed' && !agreement.saleId ? (
        <Alert variant="info">
          Executed. This agreement is now in the Finance queue for collection. No card sale exists
          yet — one is created only when the whole price is verified.
        </Alert>
      ) : null}
      {lifecycle === 'executed' && !money?.fullyPaid && money ? (
        <p className={styles.moneyNote}>
          <StatusChip label="Payment processing" tone="warning" />
          <span>
            Verified {formatMoneyOrDash(money.verifiedTotal)}, remaining{' '}
            {formatMoneyOrDash(money.remainingBalance)}.
          </span>
        </p>
      ) : null}
      {lifecycle === 'executed' && money?.fullyPaid ? (
        <p className={styles.moneyNote}>
          <StatusChip label="Fully paid" tone="success" />
          <span>
            Verified {formatMoneyOrDash(money.verifiedTotal)} against{' '}
            {formatMoneyOrDash(money.totalPrice)}. Ready to finalize.
          </span>
        </p>
      ) : null}
      {recording ? (
        <RecordPaymentDialog
          saleId={id}
          origin="reservation"
          onDone={afterMutation}
          onClose={() => setRecording(false)}
        />
      ) : null}
      <h3 className={styles.panelTitle}>Payments</h3>
      {payments.data && payments.data.length > 0 ? (
        <div className={`table-scroll ${styles.ledgerWrap}`}>
          <table>
            <caption>Every AF-PAY recorded against this agreement</caption>
            <thead>
              <tr>
                <th scope="col">AF-PAY</th>
                <th scope="col" className={styles.ledgerAmount}>
                  Amount
                </th>
                <th scope="col">Method</th>
                <th scope="col">Recorded</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.data.map((payment) => (
                <tr key={payment.id}>
                  <td data-label="AF-PAY">{payment.paymentNumber ?? '—'}</td>
                  <td data-label="Amount" className={styles.ledgerAmount}>
                    {formatMoneyOrDash(payment.amount)}
                  </td>
                  <td data-label="Method">{payment.method}</td>
                  <td data-label="Recorded">{formatDateTime(payment.recordedAt)}</td>
                  <td data-label="Status">
                    <StatusChip label={payment.status} />
                  </td>
                  <td data-label="Actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      loading={busy}
                      onClick={() => void print('payment_recorded', 'Recorded receipt', payment.id)}
                    >
                      Print Recorded Receipt
                    </Button>{' '}
                    {/* A rejected payment never gets a verified receipt: there is no
                        verified evidence to render, and inventing one would be a lie
                        in a customer's hand. */}
                    {payment.status === 'verified' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        loading={busy}
                        onClick={() =>
                          void print('payment_verified', 'Verified receipt', payment.id)
                        }
                      >
                        Print Verified Receipt
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.note}>No payments recorded against this agreement yet.</p>
      )}
      {agreement.saleId ? (
        <div className={styles.actions}>
          <span className={styles.note}>Final purchase record:</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            loading={busy}
            onClick={() => void print('purchase_finalized', 'Final purchase', agreement.saleId!)}
          >
            Print Final Purchase Record
          </Button>
        </div>
      ) : null}
      <MembershipConfirmation saleId={agreement.saleId} persisted={money?.membership} />
    </section>
  );
}

/**
 * The membership result after activation, with the confirmation print.
 *
 * Deliberately absent: the QR token, the fallback code, their hashes, any
 * onboarding token and any storage URL. Those are returned once by the activation
 * call and are never re-displayable, so this panel could not show them even if it
 * wanted to.
 */
function MembershipConfirmation({
  saleId,
  persisted,
}: {
  saleId: string | null;
  persisted?: ReservationFinanceSummary['membership'];
}) {
  const { user } = useSession();
  const canActivate =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'finance.card_activation' && permission.canUpdate,
    ) ?? false;
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activate = async () => {
    if (!saleId) return;
    setError(null);
    try {
      setBusy(true);
      setResult(await activateSale(saleId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Activation failed.');
    } finally {
      setBusy(false);
    }
  };
  if (!saleId) return null;
  const membershipId = result?.membershipId ?? persisted?.id;
  return (
    <section className={styles.editorSection} aria-label="Membership activation">
      <h3 className={styles.panelTitle}>Membership</h3>
      {error ? <Alert variant="warning">{error}</Alert> : null}
      {result || persisted ? (
        <>
          <dl className={styles.snapshotGrid}>
            <div className={styles.snapshotField}>
              <dt>Membership</dt>
              <dd>{result?.membershipNumber ?? persisted?.membershipNumber}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>{result ? 'Points allocated' : 'Points balance'}</dt>
              <dd>{formatCountOrDash(result?.pointsAllocated ?? persisted?.pointsBalance)}</dd>
            </div>
            <div className={styles.snapshotField}>
              <dt>Card Sale</dt>
              <dd>{saleId}</dd>
            </div>
          </dl>
          <Alert variant="info">
            Card credentials are shown once, by the authorized activation flow, and are never
            re-displayed. Use Print Activation Confirmation for the historical record.
          </Alert>
          {membershipId ? <PrintActivationConfirmation membershipId={membershipId} /> : null}
        </>
      ) : (
        <div className={styles.actions}>
          <Button onClick={() => void activate()} disabled={!canActivate || busy} loading={busy}>
            Activate membership
          </Button>
        </div>
      )}
    </section>
  );
}

function PrintActivationConfirmation({ membershipId }: { membershipId: string }) {
  const [error, setError] = useState<string | null>(null);
  // The activation confirmation is addressed by the membership, which is the
  // source the evidence builder reads.
  return (
    <div className={styles.actions}>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setError(null);
          void exportPurchaseDocument(membershipId, 'membership_activated')
            .then(downloadFile)
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : 'Print failed.'),
            );
        }}
      >
        Print Activation Confirmation
      </Button>
      <span className={styles.note}>Membership {membershipId}</span>
      {error ? <span role="alert"> {error}</span> : null}
    </div>
  );
}
