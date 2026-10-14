/**

 * Customer-application pages.

 *

 * Transaction headers for the paper-form flow: the queue and the editor.

 */

import { downloadFile as saveFile } from '../../lib/download';
import { HumanInputValidity } from '../../lib/human-input-validity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ApplicationHolder, CustomerApplication } from '@afhomes/contracts';
import {
  createCustomerApplicationSchema,
  canTransitionCustomerApplication,
  registerCustomerApplicationSchema,
  optionalContactNumberSchema,
  paymentSchemeLabel,
  governmentIdTypeSchema,
  optionalLandlineSchema,
} from '@afhomes/contracts';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { normalizeLiveHumanField } from '../../lib/normalize';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { formatDateTime } from '../../lib/format';
import { applicationKeys, businessKeys, reservationKeys, sharedScopes } from './queryKeys';
import {
  notifySuccess,
  notifyWarning,
  Alert,
  Button,
  DateField,
  IdCapturePicker,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextAreaField,
} from '@afhomes/ui';
import styles from './OfficialFormsPages.module.css';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import {
  ACCEPTED_MIME,
  MAX_BYTES,
  getDocumentAccessUrl,
  getDocuments,
  getCurrentDocument,
  completeDocumentUpload,
  confirmDocument,
  putUploadBytes,
  requestUploadGrant,
  runDocumentOcr,
} from '../documents/services';
import {
  createCustomerApplication,
  registerCustomerApplication,
  decideCustomerApplication,
  exportCustomerApplication,
  getCardProducts,
  getCustomerApplication,
  getCustomerApplicationsPage,
  getCustomerById,
  getCustomersPage,
  getOfficialFormTemplate,
  getPurchaseTermsProposal,
  getReservationAgreements,
  previewOfficialFormImport,
  reopenCustomerApplication,
  reviewApplicationPurchaseTerms,
  submitCustomerApplication,
  updateCustomerApplication,
} from './services';

import {
  today,
  emptyHolder,
  asBase64,
  HolderFields,
  QUEUE_PAGE_SIZE,
  APPLICATION_STATUS_TONES,
  HierarchyFields,
  VipRecommenderFields,
  Field,
  type HierarchySelection,
} from './official-forms-fields';

export function CustomerApplicationsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  // Default: only applications that still need APPLICATION work. Turning this
  // off reveals the progressed history, which is never deleted or archived.
  const [applicationWorkOnly, setApplicationWorkOnly] = useState(true);
  // Realtime search: pagination resets only when the settled term changes.
  const settledSearch = useRef('');
  const debouncedSearch = useDebouncedValue(search, 300, (term) => {
    const next = term.trim();
    if (next === settledSearch.current) return;
    settledSearch.current = next;
    setPage(0);
  });
  const query = useQuery({
    queryKey: applicationKeys.list(
      status,
      tier,
      debouncedSearch,
      from,
      to,
      applicationWorkOnly,
      page,
    ),
    // Keep the previous page visible while the next one loads: without this
    // the data gap reads as an empty result during every page turn.
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      getCustomerApplicationsPage({
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(applicationWorkOnly ? { queue: 'application_work' as const } : {}),
        limit: QUEUE_PAGE_SIZE,
        offset: page * QUEUE_PAGE_SIZE,
      }),
    // Application decisions happen in review screens and other sessions.
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
          aria-label="Loading applications"
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
  return (
    <section className={styles.listSection}>
      <PageHeader
        title="Customer Applications"
        description="Applications still needing application work."
        actions={
          <Button onClick={() => navigate('/admin/customers/applications/new')}>
            New application
          </Button>
        }
      />
      <FilterBar
        filtersToggleLabel="Expand Filters"
        search={
          <SearchField
            label="Search applications"
            placeholder="Application number"
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
                value={applicationWorkOnly ? 'application_work' : 'all'}
                onChange={(e) => {
                  setApplicationWorkOnly(e.target.value === 'application_work');
                  setPage(0);
                }}
                options={[
                  { value: 'application_work', label: 'Needs application work' },
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
                  ...['draft', 'submitted', 'approved', 'rejected', 'cancelled'].map((s) => ({
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
            <DateField
              id="applications-from"
              name="from"
              label="From date"
              optional
              value={from}
              onChange={(value) => {
                setFrom(value);
                setPage(0);
              }}
            />
            <DateField
              id="applications-to"
              name="to"
              label="To date"
              optional
              value={to}
              onChange={(value) => {
                setTo(value);
                setPage(0);
              }}
            />
          </>
        }
      />
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Applications could not be loaded"
          onRetry={() => void query.refetch()}
        />
      ) : rows.length ? (
        <div
          role="region"
          aria-label="Customer application records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table>
            <thead>
              <tr>
                <th>Application</th>
                <th>Applicant</th>
                <th>Tier</th>
                <th>Seller</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <tr
                  key={app.id}
                  tabIndex={0}
                  role="link"
                  aria-label={`Review application ${app.applicationNumber}`}
                  onClick={() => navigate(`/admin/customers/applications/${app.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      navigate(`/admin/customers/applications/${app.id}`);
                  }}
                  className={styles.clickable}
                >
                  <td data-label="Application">
                    <span className={styles.appRef}>
                      <span className={styles.appRefDot} aria-hidden="true" />
                      {app.applicationNumber}
                    </span>
                  </td>
                  <td data-label="Applicant">{app.applicantName ?? '—'}</td>
                  <td data-label="Tier">{app.tier}</td>
                  <td data-label="Seller">{app.sellerName ?? '—'}</td>
                  <td data-label="Status">
                    <StatusChip
                      label={app.status}
                      tone={APPLICATION_STATUS_TONES[app.status] ?? 'neutral'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No customer applications"
          description="Create the first official application draft."
        />
      )}

      {total > 0 ? (
        <div className={styles.pagination}>
          <Pagination
            page={safePage + 1}
            pageCount={pageCount}
            onChange={(next) => setPage(next - 1)}
            label="Customer applications pagination"
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Raw Zod issues (`customerId: Invalid uuid`) are never user-facing.
 * Known selector/field failures map to actionable guidance; anything else
 * keeps its path but with a readable message.
 */
export function humanizeApplicationIssues(issues: { path: PropertyKey[]; message: string }[]) {
  return issues
    .map((issue) => {
      const [head, ...rest] = issue.path;
      if (head === 'customerId') return 'Select a customer for this application.';
      if (head === 'planId') return 'Select a VIP plan for this application.';
      if (head === 'saleId') return 'Select a sale for this reservation.';
      if (head === 'customerApplicationId')
        return 'This reservation must stay linked to its customer application.';
      const tail = [head, ...rest].filter((p) => typeof p === 'string').join('.');
      return tail ? `${tail}: ${issue.message}` : issue.message;
    })
    .join(' ');
}

/**
 * Actionable detail-load guidance per failure cause. Raw server internals and
 * stored values are never rendered (see `ErrorState`); each branch names the
 * next step instead. Returns `undefined` for unknown errors so the shared
 * generic message applies.
 */
function describeApplicationLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open applications right now (role, password, or MFA). Contact an administrator.';
  if (error instanceof ApiError && error.status === 404)
    return 'No application exists at this link. Check the address, or open the record from the applications list.';
  if (error instanceof ApiParseError)
    return 'The saved record contains values this form cannot display. Note the application number and ask an administrator to review the record.';
  return undefined;
}

/**
 * Purchase workflow progress and the ONE next action.
 *
 * Every state below is read from the server's own rows: the application's
 * lifecycle status, and the application-origin reservation linked to it by
 * `reservation_agreements.customer_application_id`. Nothing is invented in local
 * state, and a button only ever NAVIGATES - the action itself still goes
 * through the existing handlers and RPCs, so an illegal step is still refused
 * server-side rather than merely hidden here.
 */
function PurchaseWorkflowPanel({ application }: { application: CustomerApplication }) {
  const reservations = useQuery({
    queryKey: applicationKeys.reservations(application.id),
    queryFn: () => getReservationAgreements({ application: application.id }),
    retry: false,
  });
  // A cancelled agreement hands the customer back to the application stage, so
  // it is not progress.
  const reservation = reservations.data?.find((r) => r.status !== 'cancelled') ?? null;
  const status = application.status;
  const approved = status === 'approved' || Boolean(reservation);
  const hasReservation = Boolean(reservation);
  const executed = reservation?.status === 'executed';
  const finalized = Boolean(reservation?.saleId);

  const steps = [
    { label: 'Application submitted', done: status !== 'draft', current: status === 'draft' },
    { label: 'Application approved', done: approved, current: status === 'submitted' },
    {
      label: 'Reservation agreement created',
      done: hasReservation,
      current: status === 'approved' && !hasReservation,
    },
    { label: 'Payment processing', done: finalized, current: hasReservation && !finalized },
    { label: 'Activation', done: false, current: finalized },
    { label: 'Commission qualification', done: false, current: false },
  ];

  const next = !hasReservation
    ? status === 'approved'
      ? {
          label: 'Create Reservation Agreement',
          detail: 'This application is approved and has no reservation yet.',
          to: `/admin/sales/reservations/new?application=${encodeURIComponent(application.id)}`,
        }
      : status === 'submitted'
        ? {
            label: 'Review Purchase Terms',
            detail: 'Review the server proposal below, then approve or reject.',
            to: null,
          }
        : {
            label: 'Continue Application',
            detail: 'Complete the draft and submit it for review.',
            to: null,
          }
    : finalized
      ? {
          label: 'Continue to Activation',
          detail: `Purchase finalized as sale ${reservation!.saleId}.`,
          to: '/admin/finance/activation',
        }
      : executed
        ? {
            label: 'Continue Payment',
            detail: 'The executed agreement is collectable in the Finance queue.',
            to: '/admin/finance/payments',
          }
        : {
            label: 'Open Reservation',
            detail: 'The agreement still needs review and execution.',
            to: `/admin/sales/reservations/${reservation!.id}`,
          };

  return (
    <section aria-label="Purchase workflow">
      <h2>Purchase workflow</h2>
      <ol>
        {steps.map((step) => (
          <li key={step.label}>
            {step.done ? '✓' : step.current ? '→' : '○'} {step.label}
            {step.current ? ' (current)' : ''}
          </li>
        ))}
      </ol>
      <h3>Next step</h3>
      <p>{next.detail}</p>
      {next.to ? (
        <p>
          <Link to={next.to}>{next.label}</Link>
        </p>
      ) : (
        <p>{next.label}</p>
      )}
      {finalized ? (
        <p>
          <Link to="/admin/finance/commissions">Open Commissions</Link> for qualification decisions.
        </p>
      ) : null}
    </section>
  );
}

export function CustomerApplicationEditorPage() {
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const reportValidity = useCallback((field: string, invalid: boolean) => {
    setInvalidFields((current) =>
      current[field] === invalid ? current : { ...current, [field]: invalid },
    );
  }, []);
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const existing = useQuery({
    queryKey: applicationKeys.detail(id),
    queryFn: () => getCustomerApplication(id!),
    enabled: Boolean(id),
  });
  const plans = useQuery({ queryKey: sharedScopes.cardProducts, queryFn: () => getCardProducts() });
  // The server-authoritative offer. Nothing on this screen computes a price: the
  // proposal below is what the operator sees AND what the submit/review calls
  // echo back as `expectedProposalHash`.
  const proposal = useQuery({
    queryKey: reservationKeys.purchaseTermsProposal(id),
    queryFn: () => getPurchaseTermsProposal(id!),
    enabled: Boolean(id),
    retry: false,
  });
  const [applicationSearch] = useSearchParams();
  const [customerId, setCustomerId] = useState(() => applicationSearch.get('customerId') ?? '');
  const [planId, setPlanId] = useState('');
  const [tier, setTier] = useState<'BRONZE' | 'SILVER' | 'GOLD'>('BRONZE');
  const [paymentScheme, setPaymentScheme] = useState<
    'spot_cash' | 'move_a' | 'installment_4_month' | 'move_b1_40_12' | 'move_b2_25_12'
  >('spot_cash');
  const [primary, setPrimary] = useState(() => emptyHolder('PRIMARY'));
  const [secondary, setSecondary] = useState<ApplicationHolder | null>(null);
  const [meta, setMeta] = useState({
    salesManagerName: '',
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
    vipReferrer: '',
    acknowledgedAt: today(),
  });
  // Stable hierarchy + recommender references. The names above stay the document
  // snapshots; these ids are the validated relationships the server checks.
  const [hierarchy, setHierarchy] = useState<HierarchySelection>({});
  const [recommenderCustomerId, setRecommenderCustomerId] = useState<string | undefined>(undefined);
  const [channels, setChannels] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [validId, setValidId] = useState(false);
  const [paymentProof, setPaymentProof] = useState(false);
  const setMessage = (message: string) => notifyWarning({ title: 'Attention', message });
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  // Local thumbnail for the not-yet-uploaded selection. Object URLs never hit
  // the network. Derived during render (no setState-in-effect); a cleanup-only
  // effect revokes the URL the moment the selection changes or the component
  // unmounts. Runtimes without createObjectURL simply get no thumbnail.
  const ocrPreviewUrl = useMemo(() => {
    if (!ocrFile || !ocrFile.type.startsWith('image/')) return null;
    try {
      return URL.createObjectURL(ocrFile);
    } catch {
      return null;
    }
  }, [ocrFile]);
  useEffect(() => {
    return () => {
      if (ocrPreviewUrl) {
        try {
          URL.revokeObjectURL(ocrPreviewUrl);
        } catch {
          // Test environments without object URLs have nothing to revoke.
        }
      }
    };
  }, [ocrPreviewUrl]);
  const [idType, setIdType] = useState('');
  const runSave = useSingleFlight<Awaited<ReturnType<typeof createCustomerApplication>>>();
  const applicationRequest = useMutationRequest();
  const [pickerVersion, setPickerVersion] = useState(0);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const xlsxInput = useRef<HTMLInputElement>(null);
  const [chosenXlsx, setChosenXlsx] = useState<string | null>(null);
  // Customer dropdown: one bounded page (the server max), so every option is
  // reachable without loading an unbounded directory into the control. The
  // chosen record resolves to a display name through the same single-customer
  // query the detail page uses (shared cache key).
  const customerOptions = useQuery({
    queryKey: applicationKeys.picker,
    queryFn: () => getCustomersPage({ limit: 200, offset: 0 }),
  });
  const [recommenderSearch, setRecommenderSearch] = useState('');
  const settledRecommenderSearch = useDebouncedValue(recommenderSearch, 300);
  const recommenderOptions = useQuery({
    queryKey: ['business', 'customers', 'recommender', settledRecommenderSearch],
    queryFn: () =>
      getCustomersPage({
        search: settledRecommenderSearch.trim() || undefined,
        limit: 50,
        offset: 0,
      }),
  });
  const linkedRecommender = useQuery({
    queryKey: businessKeys.customer(recommenderCustomerId ?? ''),
    queryFn: () => getCustomerById(recommenderCustomerId ?? ''),
    enabled: Boolean(recommenderCustomerId),
  });
  const recommenders = [...(recommenderOptions.data?.data ?? [])];
  const chosenRecommender = linkedRecommender.data;
  if (chosenRecommender && !recommenders.some((customer) => customer.id === chosenRecommender.id))
    recommenders.push(chosenRecommender);
  const linkedCustomer = useQuery({
    queryKey: businessKeys.customer(customerId),
    queryFn: () => getCustomerById(customerId),
    enabled: Boolean(customerId),
  });
  const pickCustomer = (next: string) => {
    setCustomerId(next);
    setOcrFile(null);
    setPickerVersion((version) => version + 1);
    setIdPreview(null);
    setValidId(false);
  };
  const documents = useQuery({
    queryKey: sharedScopes.documentsCustomer(customerId),
    queryFn: () => getDocuments({ subjectType: 'customer', subjectId: customerId }),
    enabled: Boolean(customerId),
    retry: false,
  });
  const currentDocument = useQuery({
    queryKey: sharedScopes.documentsCurrentCustomer(customerId),
    queryFn: () => getCurrentDocument({ subjectType: 'customer', subjectId: customerId }),
    enabled: Boolean(customerId),
    retry: false,
  });
  // There is no current document when the server says none, including all-rejected histories.
  const serverCurrentDocument =
    currentDocument.data?.isCurrent === true &&
    currentDocument.data.hasFile &&
    currentDocument.data.verificationStatus !== 'rejected'
      ? currentDocument.data
      : null;
  const uploadId = useBusinessMutation({
    mutationFn: async (pendingDocumentId?: string) => {
      if (pendingDocumentId) {
        const document = await completeDocumentUpload(pendingDocumentId);
        if (!document.hasFile) throw new Error('Upload is still incomplete.');
        return { documentId: document.id, filename: document.originalFilename };
      }
      if (!ocrFile || !customerId) throw new Error('Select a customer and ID file first.');
      const mime = ACCEPTED_MIME.find((value) => value === ocrFile.type);
      if (!mime || !ocrFile.size || ocrFile.size > MAX_BYTES)
        throw new Error('Choose a non-empty JPEG, PNG or PDF up to 10 MiB.');
      const grant = await requestUploadGrant({
        idType: governmentIdTypeSchema.parse(idType),
        subjectType: 'customer',
        subjectId: customerId,
        mime,
        sizeBytes: ocrFile.size,
        originalFilename: ocrFile.name.slice(0, 255),
      });
      await putUploadBytes(grant.uploadUrl, ocrFile);
      const document = await completeDocumentUpload(grant.documentId);
      if (!document.hasFile) throw new Error('Upload verification is still pending.');
      return { documentId: grant.documentId, filename: ocrFile.name };
    },
    onSuccess: async () => {
      setOcrFile(null);
      setPickerVersion((version) => version + 1);
      setIdPreview(null);
      setValidId(true);
      setMessage('Valid ID uploaded privately. Review before submitting.');
      // Wait for subject-wide authority; never promote a completion locally.
      await Promise.all([documents.refetch(), currentDocument.refetch()]);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Upload failed.'),
  });
  const previewId = useBusinessMutation({
    mutationFn: (documentId: string) => getDocumentAccessUrl(documentId),
    onSuccess: (grant) => setIdPreview(grant.url),
    onError: () => setMessage('ID preview unavailable. Try again.'),
  });
  const optionalPhonesValid =
    [meta.recommenderContact].every(
      (value) => optionalContactNumberSchema.safeParse(value).success,
    ) &&
    [primary.landline, secondary?.landline].every(
      (value) => optionalLandlineSchema.safeParse(value).success,
    );
  // WHY THIS IS A LIST AND NOT A `disabled` EXPRESSION.
  //
  // Submit used to be disabled by a silent nine-term `||`. The reported symptom
  // was "Submit cannot be clicked", and that grey button was the entire visible
  // explanation. Two of the terms were traps a user could not reason about: any
  // replacement ID photo stages `ocrFile`, which greys Submit until "Detect
  // fields" is pressed; and the ID-type gate needs a confirmed document. Neither
  // was stated anywhere on screen.
  //
  // A disabled control is also unfocusable, so a keyboard or screen-reader user
  // is not merely uninformed - the button does not exist for them at all.
  //
  // Same conditions, one derived list, rendered next to the button. Blocking is
  // unchanged; only the silence is removed. Transient states (a mutation in
  // flight) are deliberately NOT blockers - they are not something to fix.
  //
  // Save mirrors the submit pattern: the same contact/field checks that used
  // to grey the button silently now read as an inline list in both modes.
  const saveBlockers: string[] = [];
  if (!optionalPhonesValid)
    saveBlockers.push('Correct the recommender contact or landline number.');
  if (Object.values(invalidFields).some(Boolean))
    saveBlockers.push('Correct the highlighted fields.');
  const submitBlockers: string[] = [];
  if (!consent) submitBlockers.push('Certification and consent must be ticked.');
  if (!serverCurrentDocument?.reviewedFields?.idType)
    submitBlockers.push('Record the ID type on the uploaded identity document.');
  if (ocrFile) submitBlockers.push('Run "Detect fields" to upload the selected ID photo.');
  if (!optionalPhonesValid)
    submitBlockers.push('Correct the recommender contact or landline number.');
  if (Object.values(invalidFields).some(Boolean))
    submitBlockers.push('Correct the highlighted fields.');
  useEffect(() => {
    const app = existing.data;
    if (!app) return;
    const timer = window.setTimeout(() => {
      setCustomerId(app.customerId);
      setPlanId(app.planId);
      setTier(app.tier);
      setPaymentScheme(app.paymentScheme);
      setPrimary(app.primary);
      setSecondary(app.secondary ?? null);
      setMeta({
        salesManagerName: app.salesManagerName ?? '',
        vipRecommenderName: app.vipRecommenderName ?? '',
        recommenderContact: app.recommenderContact ?? '',
        recommenderEmail: app.recommenderEmail ?? '',
        vipReferrer: app.vipReferrer ?? '',
        acknowledgedAt: app.acknowledgedAt,
      });
      setHierarchy({
        vdStaffId: app.vdStaffId ?? undefined,
        ssmStaffId: app.ssmStaffId ?? undefined,
        smStaffId: app.smStaffId ?? undefined,
        referrerOstId: app.referrerOstId ?? undefined,
      });
      setRecommenderCustomerId(app.recommenderCustomerId ?? undefined);
      setChannels(app.acquisitionChannels);
      setConsent(app.consentAcknowledged);
      setValidId(app.validIdReceived);
      setPaymentProof(app.reservationPaymentProofReceived);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [existing.data]);
  const payload = () => ({
    // Unchosen selectors stay absent: never send "" as a UUID.
    customerId: customerId || undefined,
    planId: planId || undefined,
    tier,
    paymentScheme,
    primary: { ...primary, holderType: 'PRIMARY' as const },
    secondary: secondary ? { ...secondary, holderType: 'SECONDARY' as const } : undefined,
    ...meta,
    // Stable references ride with the snapshots. Absent on legacy records and
    // simply omitted there; the snapshots keep those readable and printable.
    ...(hierarchy.vdStaffId ? { vdStaffId: hierarchy.vdStaffId } : {}),
    ...(hierarchy.ssmStaffId ? { ssmStaffId: hierarchy.ssmStaffId } : {}),
    ...(hierarchy.smStaffId ? { smStaffId: hierarchy.smStaffId } : {}),
    ...(hierarchy.referrerOstId ? { referrerOstId: hierarchy.referrerOstId } : {}),
    ...(recommenderCustomerId ? { recommenderCustomerId } : {}),
    acquisitionChannels: channels as (
      'CMP' | 'DRP' | 'GDP Corporate' | 'Walk-In' | 'GDP Public Servant' | 'Referral' | 'FB Ads'
    )[],
    consentAcknowledged: consent,
    primarySignatureStatus: 'received' as const,
    secondarySignatureStatus: secondary ? ('received' as const) : undefined,
    validIdReceived: validId,
    reservationPaymentProofReceived: paymentProof,
  });
  const save = useBusinessMutation({
    mutationFn: () =>
      runSave(async () => {
        if (!planId) {
          document.querySelector<HTMLInputElement>('input[aria-label="Customer"]')?.focus();
          throw new Error('Select a VIP plan before saving the registration application.');
        }
        if (!id && !customerId) {
          const registration = registerCustomerApplicationSchema.safeParse({
            ...payload(),
            registerNewCustomer: true,
          });
          if (!registration.success)
            throw new Error(humanizeApplicationIssues(registration.error.issues));
          return registerCustomerApplication({
            ...registration.data,
            requestId: applicationRequest.forPayload(registration.data),
          });
        }
        const checked = createCustomerApplicationSchema.safeParse(payload());
        if (!checked.success) {
          document
            .querySelector<HTMLInputElement>(
              '[aria-invalid="true"], input[required]:invalid, select[required]:invalid',
            )
            ?.focus();
          throw new Error(humanizeApplicationIssues(checked.error.issues));
        }
        return id
          ? updateCustomerApplication(id, checked.data)
          : createCustomerApplication({
              ...checked.data,
              requestId: applicationRequest.forPayload(checked.data),
            });
      }),
    onSuccess: (app) => {
      notifySuccess({ title: 'Success', message: 'Application saved as draft.' });
      applicationRequest.complete();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
      if (!id) navigate(`/admin/customers/applications/${app.id}`, { replace: true });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Save failed.'),
  });
  const submit = useBusinessMutation({
    mutationFn: async () => {
      const checked = createCustomerApplicationSchema.safeParse(payload());
      if (!checked.success) throw new Error(humanizeApplicationIssues(checked.error.issues));
      if (!checked.data.consentAcknowledged)
        throw new Error('Certification and consent are required.');
      // A lost Submit response must retry the transition, not edit a submitted record.
      const latest = await getCustomerApplication(id!);
      // The hash is fetched with the submit so it is always the offer the server
      // holds at this instant. A stale displayed offer is refused by the server.
      const offer = proposal.data;
      if (!offer) throw new Error('Load the purchase terms offer before confirming.');
      const confirmation = {
        requestId: applicationRequest.forPayload({
          applicationId: id,
          expectedProposalHash: offer.expectedProposalHash,
        }),
        expectedProposalHash: offer.expectedProposalHash,
      };
      if (latest.status === 'submitted') return submitCustomerApplication(id!, confirmation);
      await updateCustomerApplication(id!, checked.data);
      return submitCustomerApplication(id!, confirmation);
    },
    onSuccess: () => {
      notifySuccess({ title: 'Success', message: 'Customer application submitted successfully.' });
      applicationRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Submit failed.'),
  });
  const importFile = async (file: File) => {
    const preview = await previewOfficialFormImport('customer_application', await asBase64(file));
    if (preview.errors.length) {
      setMessage(preview.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
      return;
    }
    const f = preview.fields;
    setPrimary({
      ...primary,
      lastName: f.primary_last_name ?? '',
      firstName: f.primary_first_name ?? '',
      middleName: f.primary_middle_name,
      suffix: f.primary_suffix,
      birthDate: f.primary_birth_date ?? '',
      sex: f.primary_sex,
      citizenship: f.primary_citizenship,
      civilStatus: f.primary_civil_status,
      permanentAddressLine1: f.primary_address_line_1 ?? '',
      permanentAddressLine2: f.primary_address_line_2,
      cityMunicipality: f.primary_city_municipality ?? '',
      province: f.primary_province ?? '',
      postalCode: f.primary_postal_code,
      landline: f.primary_landline,
      mobile: f.primary_mobile ?? '',
      email: f.primary_email ?? '',
      tinNumber: f.primary_tin,
      occupationBusinessName: f.primary_occupation_business,
      officeBusinessAddress: f.primary_office_business_address,
      businessIndustry: f.primary_business_industry,
      employedPosition: f.primary_employed_position,
      printedName: `${f.primary_first_name ?? ''} ${f.primary_last_name ?? ''}`.trim(),
    });
    setTier((f.card_tier?.toUpperCase() || 'BRONZE') as typeof tier);
    setPaymentScheme((f.payment_scheme || 'spot_cash') as typeof paymentScheme);
    setChannels((f.acquisition_channels ?? '').split('|').filter(Boolean));
    setMessage('Imported candidates: please verify every field before saving.');
  };
  const ocr = useBusinessMutation({
    mutationFn: async () => {
      const documentId = ocrFile
        ? (await uploadId.mutateAsync()).documentId
        : serverCurrentDocument?.id;
      if (!documentId) throw new Error('Select an ID file first.');
      const doc = await runDocumentOcr(documentId);
      await Promise.all([documents.refetch(), currentDocument.refetch()]);
      return doc;
    },
    onSuccess: (doc) => {
      const fields = doc.extractedFields;
      const confident = (key: string) => {
        const field = fields[key];
        return field && field.confidence !== null && field.confidence >= 0.8 ? field.value : null;
      };
      setPrimary((current) => ({
        ...current,
        firstName: current.firstName || confident('firstName') || '',
        middleName: current.middleName || confident('middleName') || undefined,
        lastName: current.lastName || confident('lastName') || '',
        birthDate: current.birthDate || confident('dateOfBirth') || '',
        permanentAddressLine1: current.permanentAddressLine1 || confident('address') || '',
      }));
      const suggestedType = governmentIdTypeSchema.safeParse(confident('idType'));
      if (suggestedType.success) setIdType((current) => current || suggestedType.data);
      setMessage(
        doc.ocrStatus === 'completed'
          ? 'OCR completed: review and correct suggestions before saving.'
          : 'OCR failed: enter details manually. Your private upload is retained.',
      );
    },
    onError: (e) =>
      setMessage(e instanceof Error ? e.message : 'OCR failed; continue with manual entry.'),
  });
  const confirmIdType = useBusinessMutation({
    mutationFn: async () => {
      if (!serverCurrentDocument) throw new Error('Upload and verify an ID first.');
      const document = await confirmDocument(serverCurrentDocument.id, {
        decision: 'confirmed',
        // Only the ID type is recorded here. Identity-document numbers stay
        // write-only and are never sent from this screen.
        fields: { idType: governmentIdTypeSchema.parse(idType) },
      });
      await Promise.all([documents.refetch(), currentDocument.refetch()]);
      return document;
    },
    onSuccess: () =>
      setMessage('ID type recorded on the identity document. The application can be submitted.'),
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Could not record the ID type.'),
  });
  // One stable request identity per logical action, so a timeout-after-commit
  // retry replays the original decision instead of attempting a second one.
  const decisionRequest = useMutationRequest();
  const decide = useBusinessMutation({
    mutationFn: (decision: 'approved' | 'rejected' | 'cancelled') => {
      if (decision === 'approved' && !existing.data?.purchaseTermsId) {
        throw new Error(
          'Reopen to review purchase terms, check the offer and identity document, then submit again before approving.',
        );
      }
      return decideCustomerApplication(
        id!,
        decision,
        decisionRequest.forPayload({ applicationId: id, decision }),
        'Reviewed by authorized staff.',
      );
    },
    onSuccess: () => {
      notifySuccess({ title: 'Success', message: 'Decision recorded.' });
      decisionRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Decision failed.'),
  });
  // Old approved applications have no stored commercial evidence. Reviewing is an
  // explicit confirmation of the offer currently shown, never an override price.
  const [reviewReason, setReviewReason] = useState('');
  const reviewRequest = useMutationRequest();
  const review = useBusinessMutation({
    mutationFn: async () => {
      const offer = proposal.data;
      if (!offer) throw new Error('Load the purchase terms offer before confirming.');
      return reviewApplicationPurchaseTerms(id!, {
        requestId: reviewRequest.forPayload({
          applicationId: id,
          expectedProposalHash: offer.expectedProposalHash,
          reason: reviewReason.trim(),
        }),
        expectedProposalHash: offer.expectedProposalHash,
        reason: reviewReason.trim(),
      });
    },
    onSuccess: () => {
      notifySuccess({
        title: 'Success',
        message: 'Purchase terms confirmed and frozen for this application.',
      });
      setReviewReason('');
      reviewRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
      navigate(`/admin/sales/reservations/new?application=${encodeURIComponent(id!)}`);
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Review failed.'),
  });
  const reopenRequest = useMutationRequest();
  const reopen = useBusinessMutation({
    mutationFn: () =>
      reopenCustomerApplication(
        id!,
        reopenRequest.forPayload({ applicationId: id, decision: 'draft' }),
      ),
    onSuccess: () => {
      notifySuccess({ title: 'Success', message: 'Application reopened as draft.' });
      reopenRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Reopen failed.'),
  });
  const editable = !existing.data || existing.data.status === 'draft';
  const selectedPlan = plans.data?.find((p) => p.id === planId);
  const relatedCustomer = linkedCustomer.data ?? null;
  if (id && existing.isPending) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading application"
        >
          <Skeleton style={{ height: 40, maxWidth: 320 }} />
          <Skeleton style={{ height: 16, maxWidth: 480 }} />
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 96 }} />
            <Skeleton style={{ height: 96 }} />
            <Skeleton style={{ height: 96 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );
  }
  if (id && (existing.isError || !existing.data)) {
    return (
      <section>
        <PageHeader
          title="Application"
          description="The requested application could not be opened."
          actions={
            <Button variant="secondary" onClick={() => navigate('/admin/customers/applications')}>
              Back to applications
            </Button>
          }
        />
        <ErrorState
          error={id && existing.isError ? existing.error : undefined}
          title="Application could not be loaded"
          message={
            id && existing.isError ? describeApplicationLoadError(existing.error) : undefined
          }
          onRetry={() => void existing.refetch()}
        />
      </section>
    );
  }
  // The primary action lives in the header and the sticky footer alike, so a
  // long form never buries it. One element, rendered twice. Blocking matches
  // the submit pattern: disabled with a visible inline list, never silent.
  const saveAction = (
    <Button
      onClick={() => save.mutate()}
      disabled={!editable || uploadId.isPending || ocr.isPending || saveBlockers.length > 0}
      loading={save.isPending}
      loadingLabel="Saving…"
    >
      Save draft
    </Button>
  );
  return (
    <HumanInputValidity.Provider value={reportValidity}>
      <section className={styles.editorSection}>
        <PageHeader
          title={existing.data?.applicationNumber ?? 'New Customer Application'}
          description="Manual entry, file upload, or scan."
          actions={
            <>
              {saveAction}
              <Button variant="secondary" onClick={() => navigate('/admin/customers/applications')}>
                Back to applications
              </Button>
            </>
          }
        />
        <Alert variant="info" title="How this form works">
          Save a draft first; submit later.
        </Alert>
        {existing.data ? (
          <p>
            Status: {existing.data.status} · Submitted: {existing.data.submittedAt ?? '—'} ·
            Approved: {existing.data.approvedAt ?? '—'} · Rejected:{' '}
            {existing.data.rejectedAt ?? '—'} · Related customer:{' '}
            {relatedCustomer?.fullName ?? existing.data.customerId} · Related sale:{' '}
            {existing.data.saleId ?? '—'}
          </p>
        ) : null}
        {existing.data ? <PurchaseWorkflowPanel application={existing.data} /> : null}
        {proposal.data ? (
          <section aria-label="Purchase terms offer">
            <h2>
              {proposal.data.offerKind === 'newly_confirmed_offer'
                ? 'Newly confirmed offer'
                : 'Purchase terms offer'}
            </h2>
            {/* Read-only by construction: there is no price input on this screen. */}
            <dl className="form-grid">
              <dt>Tier</dt>
              <dd>{proposal.data.terms.tier}</dd>
              <dt>Payment scheme</dt>
              <dd>{proposal.data.terms.paymentScheme}</dd>
              <dt>Total purchase amount</dt>
              <dd>{formatMoneyOrDash(proposal.data.terms.totalPrice)}</dd>
              <dt>Included reservation amount</dt>
              <dd>{formatMoneyOrDash(proposal.data.terms.reservationFee)}</dd>
              <dt>Required initial</dt>
              <dd>{formatMoneyOrDash(proposal.data.terms.requiredInitial)}</dd>
              {proposal.data.terms.monthlyAmount ? (
                <>
                  <dt>Installments</dt>
                  <dd>
                    {formatMoneyOrDash(proposal.data.terms.monthlyAmount)} ×{' '}
                    {proposal.data.terms.installmentMonths} months
                  </dd>
                </>
              ) : null}
              <dt>Spot-cash window</dt>
              <dd>{proposal.data.terms.spotCashDays} days from the first verified payment</dd>
              <dt>Yearly points</dt>
              <dd>{proposal.data.terms.yearlyPoints}</dd>
              <dt>Validity</dt>
              <dd>{proposal.data.terms.validityMonths} months</dd>
              <dt>Commission</dt>
              <dd>
                {proposal.data.terms.commissionRate} on{' '}
                {formatMoneyOrDash(proposal.data.terms.commissionBase)} ={' '}
                {formatMoneyOrDash(proposal.data.terms.expectedCommission)}
              </dd>
              <dt>Offer as of</dt>
              <dd>{formatDateTime(proposal.data.asOf)}</dd>
            </dl>
            {proposal.data.offerKind === 'newly_confirmed_offer' ? (
              <p>
                This application predates stored purchase evidence. Confirming the offer above
                records a new review record with your name, the time and your reason; today&apos;s
                figures are never presented as the historical terms.
              </p>
            ) : null}
          </section>
        ) : null}
        {selectedPlan ? (
          <DetailCard>
            <DetailCardTitle>Official {selectedPlan.code} plan benefits</DetailCardTitle>
            <DetailFieldGrid>
              <DetailField label="Discount">{selectedPlan.discountPercent}%</DetailField>
              <DetailField label="Holder limit">{selectedPlan.cardholderLimit} max</DetailField>
              <DetailField label="Yearly points">
                {formatCountOrDash(selectedPlan.yearlyPoints)} × {selectedPlan.annualPointsTranches}
              </DetailField>
              <DetailField label="Validity">
                {selectedPlan.baseValidityYears}+{selectedPlan.validityExtensionYears} years
              </DetailField>
              <DetailField label="Total value">
                {formatMoneyOrDash(selectedPlan.totalLoyaltyValue)}
              </DetailField>
            </DetailFieldGrid>
            <p className={styles.hint}>
              Snapshots freeze at submit; later plan edits never rewrite this application.
            </p>
          </DetailCard>
        ) : null}
        <fieldset disabled={!editable} className={styles.formRoot}>
          <section className={styles.panel} aria-labelledby="application-panel-heading">
            <h2 id="application-panel-heading" className={styles.panelTitle}>
              1. Application
            </h2>
            <p className={styles.hint}>Applicant, plan, and payment scheme.</p>
            <div className={styles.editorGrid}>
              <div className={styles.pickerWrap}>
                <label className={styles.filterLabel}>
                  Customer
                  <Select
                    aria-label="Customer"
                    value={customerId}
                    disabled={uploadId.isPending || ocr.isPending}
                    onChange={(e) => pickCustomer(e.target.value)}
                    options={[
                      { value: '', label: 'New customer: register with this application' },
                      ...(customerOptions.data?.data.map((c) => ({
                        value: c.id,
                        label: c.fullName,
                      })) ?? []),
                    ]}
                  />
                </label>
                {customerOptions.isPending ? (
                  <div role="status" aria-label="Searching customers">
                    <Skeleton style={{ height: 40 }} />
                  </div>
                ) : null}
                {customerId && !linkedCustomer.data ? (
                  <p role="status" className={styles.pickedLine}>
                    Loading customer…
                  </p>
                ) : null}
              </div>
              <label className={styles.filterLabel}>
                VIP plan
                <Select
                  aria-label="VIP plan"
                  value={planId}
                  onChange={(e) => {
                    const plan = plans.data?.find((p) => p.id === e.target.value);
                    setPlanId(e.target.value);
                    if (plan) setTier(plan.code as typeof tier);
                    else setTier('BRONZE');
                    if (plan?.code !== 'GOLD') setSecondary(null);
                  }}
                  options={[
                    { value: '', label: 'Select plan' },
                    ...(plans.data
                      ?.filter((p) => ['BRONZE', 'SILVER', 'GOLD'].includes(p.code))
                      .map((p) => ({ value: p.id, label: p.name })) ?? []),
                  ]}
                />
              </label>
              <label className={styles.filterLabel}>
                Payment scheme
                <Select
                  aria-label="Payment scheme"
                  value={paymentScheme}
                  onChange={(e) => setPaymentScheme(e.target.value as typeof paymentScheme)}
                  options={[
                    'spot_cash',
                    'move_a',
                    'installment_4_month',
                    'move_b1_40_12',
                    'move_b2_25_12',
                  ].map((scheme) => ({
                    value: scheme,
                    label: paymentSchemeLabel(scheme as typeof paymentScheme),
                  }))}
                />
              </label>
            </div>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => void getOfficialFormTemplate('customer').then(saveFile)}
              >
                Download template
              </Button>
              <input
                ref={xlsxInput}
                hidden
                aria-label="Import XLSX file"
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setChosenXlsx(file.name);
                    void importFile(file);
                  }
                  e.target.value = '';
                }}
              />
              <Button onClick={() => xlsxInput.current?.click()}>Choose XLSX file</Button>
              {chosenXlsx ? (
                <span role="status" className={styles.fileName}>
                  Selected: {chosenXlsx}
                </span>
              ) : null}
            </div>
          </section>
          <section className={styles.panel} aria-labelledby="identity-panel-heading">
            <h2 id="identity-panel-heading" className={styles.panelTitle}>
              2. Identity
            </h2>
            <p className={styles.hint}>Capture ID, detect fields, record type.</p>
            <fieldset className={styles.subGroup}>
              <legend className={styles.subGroupTitle}>Valid ID</legend>
              <p>
                <StatusChip
                  label={validId ? 'Valid ID: Uploaded ✓' : 'Valid ID: Required / Missing'}
                  tone={validId ? 'success' : 'warning'}
                />
              </p>
              {serverCurrentDocument ? (
                <>
                  <p>Current ID: {serverCurrentDocument.originalFilename}</p>
                  <p>
                    ID type:{' '}
                    {serverCurrentDocument.reviewedFields?.idType?.replace(/_/g, ' ') ??
                      'Missing: review the identity document'}
                  </p>
                </>
              ) : null}
              {ocrFile ? (
                <div role="status">
                  <p>Replacement selected: {ocrFile.name} (Pending replacement: not saved yet).</p>
                  {ocrPreviewUrl ? (
                    <p>
                      <img
                        src={ocrPreviewUrl}
                        alt={`Selected ID preview: ${ocrFile.name}`}
                        className={styles.thumbnail}
                      />
                    </p>
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={uploadId.isPending || ocr.isPending}
                    onClick={() => {
                      setOcrFile(null);
                      setPickerVersion((version) => version + 1);
                    }}
                  >
                    Cancel replacement
                  </Button>
                </div>
              ) : null}
              <label className={styles.filterLabel}>
                ID Type *
                <Select
                  aria-label="ID Type"
                  value={idType}
                  disabled={uploadId.isPending || ocr.isPending}
                  onChange={(event) => setIdType(event.target.value)}
                  options={[
                    { value: '', label: 'Select ID type' },
                    ...governmentIdTypeSchema.options.map((value) => ({
                      value,
                      label: value
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
                    })),
                  ]}
                />
              </label>
              <IdCapturePicker
                onFile={setOcrFile}
                disabled={uploadId.isPending || ocr.isPending}
                resetVersion={pickerVersion}
              />
              {ocrFile ? (
                <p role="status">
                  Selected ID: {ocrFile.name}. Choose Detect fields to upload it privately and read
                  the OCR suggestions.
                </p>
              ) : null}
              <Button
                onClick={() => ocr.mutate()}
                disabled={(!ocrFile && !serverCurrentDocument) || !customerId}
                loading={ocr.isPending || uploadId.isPending}
                loadingLabel="Processing…"
              >
                Detect fields
              </Button>
              {/* Submit requires an ID type recorded on the identity document, and
                that field is only ever written by the document-confirm endpoint.
                Without this the requirement is unreachable from this screen and
                Submit stays disabled after a successful upload, so the reviewer
                records the ID type here through the same secure document
                pipeline. The gate itself is unchanged. */}
              {serverCurrentDocument && !serverCurrentDocument.reviewedFields?.idType ? (
                <p role="status">
                  Submit needs the ID type recorded against this identity document.{' '}
                  <Button
                    variant="secondary"
                    disabled={!idType || uploadId.isPending}
                    loading={confirmIdType.isPending}
                    loadingLabel="Recording…"
                    onClick={() => confirmIdType.mutate()}
                  >
                    Record ID type on this ID
                  </Button>
                </p>
              ) : null}
              {serverCurrentDocument ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => previewId.mutate(serverCurrentDocument.id)}
                  >
                    Preview uploaded ID
                  </Button>
                  <Link to={`/admin/documents/${serverCurrentDocument.id}`}>
                    Review identity document
                  </Link>
                </>
              ) : null}
              {serverCurrentDocument ? (
                <div>
                  <p>OCR status: {serverCurrentDocument.ocrStatus}</p>
                  {Object.entries(serverCurrentDocument.extractedFields).length ? (
                    <>
                      <p>
                        Detected suggestions: verify against the ID and correct the form manually.
                        ID numbers remain masked; use document review to confirm them.
                      </p>
                      <dl>
                        {Object.entries(serverCurrentDocument.extractedFields).map(
                          ([key, field]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>
                                {field.value ?? 'Not detected'}
                                {field.confidence !== null
                                  ? ` (${Math.round(field.confidence * 100)}% confidence)`
                                  : ''}
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </>
                  ) : null}
                </div>
              ) : null}
              {idPreview ? (
                <>
                  <button
                    type="button"
                    className={styles.thumbnailButton}
                    onClick={() => setPreviewOpen(true)}
                    aria-label="View identity document preview fullscreen"
                  >
                    <img
                      src={idPreview}
                      alt="Identity document preview thumbnail"
                      className={styles.thumbnail}
                    />
                  </button>
                  <Dialog
                    open={previewOpen}
                    onClose={() => setPreviewOpen(false)}
                    title="Identity document preview"
                    footer={
                      <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
                        Close
                      </Button>
                    }
                  >
                    <img
                      src={idPreview}
                      alt="Identity document preview"
                      className={styles.previewImage}
                    />
                  </Dialog>
                </>
              ) : null}
              {documents.data
                ?.filter((doc) => doc.hasFile && doc.id !== serverCurrentDocument?.id)
                .map((doc) => (
                  <p key={doc.id}>
                    Retained ID: {doc.originalFilename} · {doc.verificationStatus}{' '}
                    <Button size="sm" variant="ghost" onClick={() => previewId.mutate(doc.id)}>
                      Preview
                    </Button>
                  </p>
                ))}
              {documents.data
                ?.filter((doc) => !doc.hasFile)
                .map((doc) => (
                  <p key={doc.id}>
                    Pending ID upload: {doc.originalFilename}. File completion is not verified.{' '}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={uploadId.isPending || ocr.isPending || Boolean(ocrFile)}
                      onClick={() => uploadId.mutate(doc.id)}
                    >
                      Verify saved upload
                    </Button>
                  </p>
                ))}
              {currentDocument.isError ? (
                <p role="status">Current ID could not be loaded. Retry before using OCR.</p>
              ) : null}
              {documents.isError ? (
                <p role="status">
                  Existing ID documents could not be loaded. Document permissions still apply.
                </p>
              ) : null}
            </fieldset>
          </section>
          <HolderFields title="3. Primary holder" value={primary} onChange={setPrimary} />
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={Boolean(secondary)}
              disabled={tier !== 'GOLD'}
              onChange={(e) => setSecondary(e.target.checked ? emptyHolder('SECONDARY') : null)}
            />{' '}
            Add optional Gold secondary cardholder
          </label>
          {secondary ? (
            <HolderFields
              title="4. Secondary holder (gold optional)"
              value={secondary}
              onChange={setSecondary}
            />
          ) : null}
          <fieldset className={styles.panel}>
            <legend className={styles.panelTitle}>5. Recommender details</legend>
            <div className={styles.editorGrid}>
              <HierarchyFields
                value={hierarchy}
                fallbackSmName={meta.salesManagerName}
                fallbackReferrerName={meta.vipReferrer}
                disabled={!editable}
                onChange={(next) => {
                  setHierarchy({
                    vdStaffId: next.vdStaffId,
                    ssmStaffId: next.ssmStaffId,
                    smStaffId: next.smStaffId,
                    referrerOstId: next.referrerOstId,
                  });
                  setMeta((current) => ({
                    ...current,
                    salesManagerName: next.salesManagerName,
                    vipReferrer: next.vipReferrer,
                  }));
                }}
              />
              <VipRecommenderFields
                onSearch={setRecommenderSearch}
                value={{
                  recommenderCustomerId,
                  vipRecommenderName: meta.vipRecommenderName,
                  recommenderContact: meta.recommenderContact,
                  recommenderEmail: meta.recommenderEmail,
                }}
                customers={recommenders}
                customersLoading={recommenderOptions.isFetching}
                customersError={
                  recommenderOptions.isError ? 'Unable to load recommenders. Try again.' : null
                }
                onRetryCustomers={() => void recommenderOptions.refetch()}
                disabled={!editable}
                onChange={(next) => {
                  setRecommenderCustomerId(next.recommenderCustomerId);
                  setMeta((current) => ({
                    ...current,
                    vipRecommenderName: next.vipRecommenderName,
                    recommenderContact: next.recommenderContact,
                    recommenderEmail: next.recommenderEmail,
                  }));
                }}
              />
              <Field
                label="VIP Referrer"
                value={meta.vipReferrer}
                normalize={(v) => normalizeLiveHumanField('vipReferrer', v)}
                onChange={(v) => {
                  setHierarchy((current) => ({ ...current, referrerOstId: undefined }));
                  setMeta({ ...meta, vipReferrer: v });
                }}
                readOnly={Boolean(hierarchy.referrerOstId)}
              />
              <DateField
                id="application-acknowledged-at"
                name="acknowledgedAt"
                label="Acknowledged At"
                value={meta.acknowledgedAt}
                onChange={(v) => setMeta({ ...meta, acknowledgedAt: v })}
              />
            </div>
          </fieldset>
          <fieldset className={styles.panel}>
            <legend className={styles.panelTitle}>6. Acquisition channel</legend>
            {[
              'CMP',
              'DRP',
              'GDP Corporate',
              'Walk-In',
              'GDP Public Servant',
              'Referral',
              'FB Ads',
            ].map((channel) => (
              <label key={channel} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={channels.includes(channel)}
                  onChange={(e) =>
                    setChannels(
                      e.target.checked
                        ? [...channels, channel]
                        : channels.filter((v) => v !== channel),
                    )
                  }
                />
                {channel}
              </label>
            ))}
          </fieldset>
          <fieldset className={styles.panel}>
            <legend className={styles.panelTitle}>7. Certification</legend>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{' '}
              I certify the information and consent to verification and processing under RA 10173.
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={validId}
                onChange={(e) => setValidId(e.target.checked)}
              />{' '}
              Valid government ID with specimen signatures received
            </label>
          </fieldset>
        </fieldset>
        {saveBlockers.length > 0 ? (
          <Alert variant="warning" title="Cannot save yet:">
            <ul>
              {saveBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className={styles.stickyFooter}>
          <div className={styles.stickyFooterActions}>{saveAction}</div>
        </div>
        <p>
          {id && editable ? (
            <>
              {submitBlockers.length > 0 ? (
                <Alert variant="warning" title="Cannot submit yet:">
                  <ul>
                    {submitBlockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}{' '}
              <Button
                onClick={() => submit.mutate()}
                disabled={
                  submitBlockers.length > 0 || save.isPending || uploadId.isPending || ocr.isPending
                }
                loading={submit.isPending}
                loadingLabel="Submitting…"
              >
                Submit
              </Button>
            </>
          ) : null}{' '}
          {id && existing.data?.status === 'submitted' ? (
            <>
              <Button
                onClick={() => decide.mutate('approved')}
                loading={decide.isPending}
                loadingLabel="Approving…"
              >
                Approve
              </Button>{' '}
              <Button
                variant="danger"
                onClick={() => decide.mutate('rejected')}
                loading={decide.isPending}
                loadingLabel="Rejecting…"
              >
                Reject
              </Button>{' '}
              <Button
                onClick={() => reopen.mutate()}
                loading={reopen.isPending}
                loadingLabel="Reopening…"
              >
                {existing.data.purchaseTermsId
                  ? 'Reopen to draft'
                  : 'Reopen to review purchase terms'}
              </Button>{' '}
            </>
          ) : null}{' '}
          {id && existing.data?.status === 'rejected' ? (
            <Button
              onClick={() => reopen.mutate()}
              loading={reopen.isPending}
              loadingLabel="Reopening…"
            >
              Reopen to draft
            </Button>
          ) : null}{' '}
          {id && existing.data?.status === 'approved' && !proposal.data ? (
            <Button
              onClick={() => void proposal.refetch()}
              loading={proposal.isFetching}
              loadingLabel="Loading offer…"
              type="button"
            >
              Load purchase terms offer
            </Button>
          ) : null}{' '}
          {id && existing.data?.status === 'approved' && proposal.data ? (
            <>
              <TextAreaField
                id="application-review-reason"
                name="reviewReason"
                label="Review reason"
                optional
                rows={2}
                value={reviewReason}
                onChange={setReviewReason}
              />{' '}
              <Button
                onClick={() => review.mutate()}
                disabled={reviewReason.trim().length < 5}
                loading={review.isPending}
                loadingLabel="Confirming…"
              >
                Confirm purchase terms
              </Button>
            </>
          ) : null}{' '}
          {id &&
          existing.data &&
          canTransitionCustomerApplication(existing.data.status, 'cancelled') ? (
            <Button
              onClick={() => decide.mutate('cancelled')}
              loading={decide.isPending}
              loadingLabel="Cancelling…"
            >
              Cancel
            </Button>
          ) : null}{' '}
          {id ? (
            <>
              {existing.data && ['submitted', 'approved'].includes(existing.data.status) && (
                <Link to={`/admin/sales/reservations/new?application=${id}`}>
                  Create reservation from application
                </Link>
              )}
              <Button
                onClick={() =>
                  void exportCustomerApplication(id, 'xlsx')
                    .then(saveFile)
                    .catch((e: unknown) =>
                      setMessage(e instanceof Error ? e.message : 'Export failed.'),
                    )
                }
              >
                Export XLSX
              </Button>
              <Button
                onClick={() =>
                  void exportCustomerApplication(id, 'pdf')
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
        </p>
      </section>
    </HumanInputValidity.Provider>
  );
}
