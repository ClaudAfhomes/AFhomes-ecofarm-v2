/**

 * Customer-application pages.

 *

 * Transaction headers for the paper-form flow: the queue and the editor.

 */

import { downloadFile as saveFile } from '../../lib/download';
import { HumanInputValidity } from '../../lib/human-input-validity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  GOVERNMENT_ID_TYPE_LABELS,
  type GovernmentIdType,
  optionalLandlineSchema,
} from '@afhomes/contracts';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { useSession } from '../../lib/session';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { formatDateTime } from '../../lib/format';
import { applicationKeys, businessKeys, membershipKeys, reservationKeys, sharedScopes } from './queryKeys';
import {
  notifySuccess,
  notifyWarning,
  Alert,
  Button,
  DateField,
  Dialog,
  IdCapturePicker,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
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
import { TierBadge } from './TierBadge';
import { tierArtwork } from '@afhomes/ui';
import styles from './OfficialFormsPages.module.css';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import {
  ACCEPTED_MIME,
  MAX_BYTES,
  getCurrentDocument,
  completeDocumentUpload,
  putUploadBytes,
  requestUploadGrant,
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
  getCustomerImportPrefill,
  getCustomersPage,
  getPurchaseTermsProposal,
  getReservationAgreements,
  reopenCustomerApplication,
  reviewApplicationPurchaseTerms,
  submitCustomerApplication,
  updateCustomerApplication,
} from './services';

import {
  today,
  emptyHolder,
  HolderFields,
  QUEUE_PAGE_SIZE,
  APPLICATION_STATUS_TONES,
  RecommenderFields,
  formatFileSize,
} from './official-forms-fields';

export function CustomerApplicationsPage() {
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const { user } = useSession();
  // Bulk membership import/export lives here now (membership work), gated on
  // its own module like the direct URL guard in navigation.ts. The server
  // re-checks regardless.
  const canSeeImportExport =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'governance.customer_import' && permission.canView,
    ) === true;
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState(() => urlParams.get('search') ?? '');
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
          <>
            {canSeeImportExport ? (
              <Button
                variant="secondary"
                onClick={() => navigate('/admin/customers/applications/import-export')}
              >
                Import/Export Data
              </Button>
            ) : null}
            <Button onClick={() => navigate('/admin/customers/applications/new')}>
              New application
            </Button>
          </>
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
  const navigate = useNavigate();
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
      label: 'Reservation created',
      done: hasReservation,
      current: status === 'approved' && !hasReservation,
    },
    { label: 'Payment processing', done: finalized, current: hasReservation && !finalized },
    { label: 'Activation', done: false, current: finalized },
    { label: 'Commission', done: false, current: false },
  ];

  const next = !hasReservation
    ? status === 'approved'
      ? {
          label: 'Create Reservation',
          detail: 'No reservation exists yet.',
          to: `/admin/sales/reservations/new?application=${encodeURIComponent(application.id)}`,
        }
      : status === 'submitted'
        ? {
            label: 'Review terms',
            detail: 'Review the offer, then decide.',
            to: null,
          }
        : {
            label: 'Continue draft',
            detail: 'Complete the draft and submit.',
            to: null,
          }
    : finalized
      ? {
          label: 'Continue Activation',
          detail: `Sale ${reservation!.saleId} is finalized.`,
          to: '/admin/finance/activation',
        }
      : executed
        ? {
            label: 'Continue Payment',
            detail: 'Collect payment in Finance.',
            to: '/admin/finance/payments',
          }
        : {
            label: 'Open Reservation',
            detail: 'Agreement needs execution.',
            to: `/admin/sales/reservations/${reservation!.id}`,
          };
  const nextTarget = next.to;

  return (
    <section aria-label="Purchase workflow" className={styles.panel}>
      <h2 className={styles.panelTitle}>Purchase workflow</h2>
      <ol className={styles.workflowSteps}>
        {steps.map((step) => (
          <li
            key={step.label}
            className={styles.workflowStep}
            data-state={step.done ? 'done' : step.current ? 'current' : 'pending'}
          >
            <span className={styles.workflowMark} aria-hidden="true">
              {step.done ? '✓' : step.current ? '→' : '○'}
            </span>{' '}
            {step.label}
            {step.current ? ' (current)' : ''}
          </li>
        ))}
      </ol>
      <div className={styles.workflowNext}>
        <h3>Next step</h3>
        <p className={styles.hint}>{next.detail}</p>
        <div className={styles.actions}>
          {nextTarget ? (
            <Button onClick={() => navigate(nextTarget)}>{next.label}</Button>
          ) : (
            <span className={styles.note}>{next.label}</span>
          )}
          {finalized ? (
            <Button variant="secondary" onClick={() => navigate('/admin/finance/commissions')}>
              Open Commissions
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function CustomerApplicationEditorPage() {
  const { user: applicationUser } = useSession();
  const mayLoadImport =
    applicationUser?.afHomesPermissions.some(
      (p) => p.moduleKey === 'governance.customer_import' && p.canView,
    ) ?? false;
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
  // The picker resolves against the authoritative record, and a prefill click
  // is only accepted for the customer it was started for.
  const selectedCustomerRef = useRef(customerId);
  const [prefilledCustomerId, setPrefilledCustomerId] = useState<string | null>(null);
  const [planId, setPlanId] = useState('');
  const [tier, setTier] = useState<'BRONZE' | 'SILVER' | 'GOLD'>('BRONZE');
  const [paymentScheme, setPaymentScheme] = useState<
    'spot_cash' | 'move_a' | 'installment_4_month' | 'move_b1_40_12' | 'move_b2_25_12'
  >('spot_cash');
  const [primary, setPrimary] = useState(() => emptyHolder('PRIMARY'));
  const [secondary, setSecondary] = useState<ApplicationHolder | null>(null);
  const [meta, setMeta] = useState({
    svdStaffId: '',
    ssmStaffId: '',
    smStaffId: '',
    referrerStaffId: '',
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
    acknowledgedAt: today(),
  });
  const [channels, setChannels] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [validId, setValidId] = useState(false);
  const [paymentProof, setPaymentProof] = useState(false);
  const setMessage = (message: string) => notifyWarning({ title: 'Attention', message });
  const [idFile, setIdFile] = useState<File | null>(null);
  // Local thumbnail for the not-yet-uploaded selection. Object URLs never hit
  // the network. Derived during render (no setState-in-effect); a cleanup-only
  // effect revokes the URL the moment the selection changes or the component
  // unmounts. Runtimes without createObjectURL simply get no thumbnail.
  const idPreviewUrl = useMemo(() => {
    if (!idFile || !idFile.type.startsWith('image/')) return null;
    try {
      return URL.createObjectURL(idFile);
    } catch {
      return null;
    }
  }, [idFile]);
  useEffect(() => {
    return () => {
      if (idPreviewUrl) {
        try {
          URL.revokeObjectURL(idPreviewUrl);
        } catch {
          // Test environments without object URLs have nothing to revoke.
        }
      }
    };
  }, [idPreviewUrl]);
  const [idType, setIdType] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  // Steps unlock only by moving forward. Going back is always free; jumping
  // ahead never is, so an operator cannot skip a step's own checks. Existing
  // records open unlocked: their data was entered before, or the form below
  // is read-only review anyway.
  const [maxReached, setMaxReached] = useState(() => (id ? 5 : 0));
  // The wizard guides NEW applications step by step. Existing records keep
  // the full page: reviewers need every section and decision button at once.
  const isNew = !id;
  const uploadPendingId = useCallback(
    async (targetCustomerId: string, file: File, type: string) => {
      const mime = ACCEPTED_MIME.find((value) => value === file.type);
      if (!mime || !file.size || file.size > MAX_BYTES)
        throw new Error('Choose JPEG, PNG or PDF up to 10 MiB.');
      if (!targetCustomerId) throw new Error('Select a customer first.');
      if (!type) throw new Error('Choose ID type first.');
      const grant = await requestUploadGrant({
        idType: governmentIdTypeSchema.parse(type),
        subjectType: 'customer',
        subjectId: targetCustomerId,
        mime,
        sizeBytes: file.size,
        originalFilename: file.name.slice(0, 255),
      });
      await putUploadBytes(grant.uploadUrl, file);
      const document = await completeDocumentUpload(grant.documentId);
      if (!document.hasFile) throw new Error('Upload verification is still pending.');
      return { documentId: grant.documentId, filename: file.name };
    },
    [],
  );
  const runSave = useSingleFlight<Awaited<ReturnType<typeof createCustomerApplication>>>();
  const applicationRequest = useMutationRequest();
  const [pickerVersion, setPickerVersion] = useState(0);
  // Customer dropdown: one bounded page (the server max), so every option is
  // reachable without loading an unbounded directory into the control. The
  // chosen record resolves to a display name through the same single-customer
  // query the detail page uses (shared cache key).
  const customerOptions = useQuery({
    queryKey: applicationKeys.picker,
    queryFn: () => getCustomersPage({ limit: 200, offset: 0 }),
  });
  const linkedCustomer = useQuery({
    queryKey: businessKeys.customer(customerId),
    queryFn: () => getCustomerById(customerId),
    enabled: Boolean(customerId),
  });
  const importPrefill = useMutation({
    mutationFn: (selectedCustomer: string) => getCustomerImportPrefill(selectedCustomer),
    onSuccess: (data, selectedCustomer) => {
      if (selectedCustomer !== selectedCustomerRef.current) return;
      setPrefilledCustomerId(selectedCustomer);
      setConsent(false);
      setValidId(false);
      setPaymentProof(false);
      setChannels([]);
      setPrimary({ ...emptyHolder('PRIMARY'), ...data.primary, holderType: 'PRIMARY' });
      setSecondary(
        data.secondary
          ? { ...emptyHolder('SECONDARY'), ...data.secondary, holderType: 'SECONDARY' }
          : null,
      );
      const plan = plans.data?.find((p) => p.code === data.tier);
      if (plan && data.tier) {
        setPlanId(plan.id);
        setTier(data.tier);
      }
      if (data.paymentScheme) setPaymentScheme(data.paymentScheme);
      // The related-party panel is staff-linked on this form, so the imported
      // names/contacts land only where the form still edits free text.
      setMeta((current) => ({
        ...current,
        vipRecommenderName: data.recommenderName,
        recommenderContact: data.recommenderContact,
        recommenderEmail: data.recommenderEmail,
      }));
      setMessage(
        'Imported details loaded for review. Still required: ' +
          data.missingFields.join(', ') +
          '.',
      );
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : 'Could not load imported details.'),
  });
  const pickCustomer = (next: string) => {
    selectedCustomerRef.current = next;
    if (prefilledCustomerId && next !== prefilledCustomerId) {
      setPrimary(emptyHolder('PRIMARY'));
      setSecondary(null);
      setPrefilledCustomerId(null);
      setPlanId('');
      setTier('BRONZE');
      setPaymentScheme('spot_cash');
      setConsent(false);
      setPaymentProof(false);
      setChannels([]);
      setMeta((current) => ({
        ...current,
        vipRecommenderName: '',
        recommenderContact: '',
        recommenderEmail: '',
      }));
    }
    setCustomerId(next);
    setIdFile(null);
    setPickerVersion((version) => version + 1);
    setValidId(false);
  };
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
  const optionalPhonesValid =
    [meta.recommenderContact].every(
      (value) => optionalContactNumberSchema.safeParse(value).success,
    ) &&
    [primary.landline, secondary?.landline].every(
      (value) => optionalLandlineSchema.safeParse(value).success,
    );
  // WHY THIS IS A LIST AND NOT A `disabled` EXPRESSION.
  //
  // Save-and-submit used to be a silent multi-term `||` plus a separate
  // "Submit" button. The reported symptom was "Submit cannot be clicked", and
  // that grey button was the entire visible explanation.
  //
  // A disabled control is also unfocusable, so a keyboard or screen-reader user
  // is not merely uninformed - the button does not exist for them at all.
  //
  // One derived list, rendered next to the button: every condition that blocks
  // the single save-and-submit action. Transient states (a mutation in flight)
  // are deliberately NOT blockers - they are not something to fix.
  const blockers: string[] = [];
  if (!planId) blockers.push('Select a VIP plan.');
  if (!consent) blockers.push('Certification and consent must be ticked.');
  // A picked file uploads on Save, so it satisfies the gate.
  if (!serverCurrentDocument?.reviewedFields?.idType && !idFile)
    blockers.push('Upload a valid ID and choose its ID type.');
  if (idFile && !idType) blockers.push('Choose ID type first.');
  if (idFile && !customerId && id) blockers.push('Select a customer first.');
  if (!optionalPhonesValid) blockers.push('Correct the recommender contact or landline number.');
  if (Object.values(invalidFields).some(Boolean)) blockers.push('Correct the highlighted fields.');
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
        svdStaffId: app.svdStaffId ?? '',
        ssmStaffId: app.ssmStaffId ?? '',
        smStaffId: app.smStaffId ?? '',
        referrerStaffId: app.referrerStaffId ?? '',
        vipRecommenderName: app.vipRecommenderName ?? '',
        recommenderContact: app.recommenderContact ?? '',
        recommenderEmail: app.recommenderEmail ?? '',
        acknowledgedAt: app.acknowledgedAt,
      });
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
    acquisitionChannels: channels as (
      'CMP' | 'DRP' | 'GDP Corporate' | 'Walk-In' | 'GDP Public Servant' | 'Referral' | 'FB Ads'
    )[],
    consentAcknowledged: consent,
    primarySignatureStatus: 'received' as const,
    secondarySignatureStatus: secondary ? ('received' as const) : undefined,
    validIdReceived: validId,
    reservationPaymentProofReceived: paymentProof,
  });
  // ONE action: save and submit. There is no draft-only save - a new
  // application is created (or an existing draft updated) and then immediately
  // submitted with the server's own purchase-terms hash, so a lost response
  // retries the transition instead of editing a submitted record.
  const saveAndSubmit = useBusinessMutation({
    mutationFn: () =>
      runSave(async () => {
        if (!planId) throw new Error('Select a VIP plan before saving the application.');

        let appId: string;
        if (!id && !customerId) {
          // New Register carries NO customerId by design, so parsing against
          // the create contract here would reject the payload for the very
          // field this path deliberately leaves empty. The register contract
          // (customerId omitted, registerNewCustomer true) is the one this
          // path must satisfy.
          const registration = registerCustomerApplicationSchema.safeParse({
            ...payload(),
            registerNewCustomer: true,
          });
          if (!registration.success)
            throw new Error(humanizeApplicationIssues(registration.error.issues));
          if (!registration.data.consentAcknowledged)
            throw new Error('Certification and consent are required.');
          const created = await registerCustomerApplication({
            ...registration.data,
            requestId: applicationRequest.forPayload(registration.data),
          });
          appId = created.id;
          // New customer now exists: upload the picked ID on Save.
          if (idFile) {
            if (!idType) throw new Error('Choose ID type first.');
            await uploadPendingId(created.customerId, idFile, idType);
            setIdFile(null);
            setPickerVersion((version) => version + 1);
            setValidId(true);
            setCustomerId(created.customerId);
            await currentDocument.refetch();
          }
        } else {
          const checkedForSubmit = createCustomerApplicationSchema.safeParse(payload());
          if (!checkedForSubmit.success)
            throw new Error(humanizeApplicationIssues(checkedForSubmit.error.issues));
          if (!checkedForSubmit.data.consentAcknowledged)
            throw new Error('Certification and consent are required.');

          if (id) {
            const latest = await getCustomerApplication(id);
            if (latest.status === 'submitted') {
              // A lost Submit response must retry the transition, not edit a
              // submitted record.
              const offer = await getPurchaseTermsProposal(id);
              return submitCustomerApplication(id, {
                requestId: applicationRequest.forPayload({
                  applicationId: id,
                  expectedProposalHash: offer.expectedProposalHash,
                }),
                expectedProposalHash: offer.expectedProposalHash,
              });
            }
            // Upload the picked ID on Save before updating the draft.
            if (idFile) {
              await uploadPendingId(customerId || latest.customerId, idFile, idType);
              setIdFile(null);
              setPickerVersion((version) => version + 1);
              setValidId(true);
              await currentDocument.refetch();
            }
            await updateCustomerApplication(id, checkedForSubmit.data);
            appId = id;
          } else {
            // Upload the picked ID on Save before creating the application.
            if (idFile) {
              await uploadPendingId(customerId, idFile, idType);
              setIdFile(null);
              setPickerVersion((version) => version + 1);
              setValidId(true);
              await currentDocument.refetch();
            }
            const created = await createCustomerApplication({
              ...checkedForSubmit.data,
              requestId: applicationRequest.forPayload(checkedForSubmit.data),
            });
            appId = created.id;
          }
        }

        // The hash is fetched fresh so it is always the offer the server holds
        // at this instant. A stale offer is refused server-side.
        const offer = await getPurchaseTermsProposal(appId);
        return submitCustomerApplication(appId, {
          requestId: applicationRequest.forPayload({
            applicationId: appId,
            expectedProposalHash: offer.expectedProposalHash,
          }),
          expectedProposalHash: offer.expectedProposalHash,
        });
      }),
    onSuccess: (app) => {
      notifySuccess({ title: 'Success', message: 'Customer application submitted successfully.' });
      applicationRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
      void client.invalidateQueries({ queryKey: sharedScopes.reports });
      if (!id) navigate(`/admin/customers/applications/${app.id}`, { replace: true });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Save and submit failed.'),
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
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
      void client.invalidateQueries({ queryKey: sharedScopes.reports });
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
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
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
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Reopen failed.'),
  });
  const editable = !existing.data || existing.data.status === 'draft';
  const selectedPlan = plans.data?.find((p) => p.id === planId);
  const relatedCustomer = linkedCustomer.data ?? null;
  // Snapshot names for chain selections the genealogy list no longer contains
  // (a departure, or a chain outside the viewer's own scope). The dropdowns
  // stay legible; the server still refuses an ineligible id at write time.
  const chainNames: Record<string, string> = {};
  {
    const app = existing.data;
    const pairs: [string | undefined, string | undefined][] = [
      [app?.svdStaffId, app?.svdName],
      [app?.ssmStaffId, app?.ssmName],
      [app?.smStaffId, app?.salesManagerName],
      [app?.referrerStaffId, app?.vipReferrer],
    ];
    for (const [staffId, name] of pairs) if (staffId && name) chainNames[staffId] = name;
  }
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
  // The ONE primary action lives in the header and the sticky footer alike, so
  // a long form never buries it. One element, rendered twice. Blocking stays
  // visible: disabled with an inline list of what to fix, never silent.
  const saveAction = (
    <Button
      onClick={() => saveAndSubmit.mutate()}
      disabled={!editable || saveAndSubmit.isPending || blockers.length > 0}
      loading={saveAndSubmit.isPending}
      loadingLabel="Saving and submitting…"
    >
      Save &amp; Submit
    </Button>
  );
  const primaryComplete = [
    primary.firstName,
    primary.lastName,
    primary.birthDate,
    primary.mobile,
    primary.email,
    primary.printedName,
  ].every((field) => field.trim() !== '');
  // Per-step Next gates. Each mirrors a save blocker, never more: Save stays
  // the final authority, and Next can never refuse what Save allows.
  const stepBlockers: (string | null)[] = [
    !planId ? 'Select a VIP plan.' : null,
    !serverCurrentDocument?.reviewedFields?.idType && !idFile
      ? 'Upload a valid ID and choose its ID type.'
      : idFile && !idType
        ? 'Choose ID type first.'
        : null,
    Object.values(invalidFields).some(Boolean)
      ? 'Correct the highlighted fields.'
      : !primaryComplete
        ? 'Complete primary holder fields.'
        : null,
    !optionalPhonesValid ? 'Correct the recommender contact or landline number.' : null,
    null,
    null,
  ];
  const steps = [
    { id: 'step-application', label: 'Application', done: Boolean(planId) },
    {
      id: 'step-identity',
      label: 'Identity',
      done: Boolean(serverCurrentDocument?.reviewedFields?.idType || idFile),
    },
    { id: 'step-holders', label: 'Holders', done: primaryComplete },
    {
      id: 'step-recommender',
      label: 'Recommender',
      // acknowledgedAt ships pre-filled with today, so it can never mark the
      // step done on its own: only entered chain or contact details count.
      done: [
        meta.svdStaffId,
        meta.ssmStaffId,
        meta.smStaffId,
        meta.referrerStaffId,
        meta.vipRecommenderName,
        meta.recommenderContact,
        meta.recommenderEmail,
      ].some((field) => field.trim() !== ''),
    },
    { id: 'step-channel', label: 'Channel', done: channels.length > 0 },
    { id: 'step-cert', label: 'Certify', done: consent },
  ];
  // Every step change puts the panel it reveals at the top of the view.
  // Without it, Next leaves the operator standing where they were - scrolled to
  // the bottom of the step they just finished, with the new panel above the
  // viewport reading as a blank page.
  const revealStep = (index: number) => {
    // The panel is not in the DOM until React re-renders, so the lookup waits a
    // tick. Optional call keeps it inert in runtimes without scrolling.
    window.setTimeout(() => {
      document.getElementById(steps[index]!.id)?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      });
    }, 0);
  };
  const goStep = (index: number) => {
    if (index < 0 || index > steps.length - 1 || index > maxReached) return;
    setActiveStep(index);
    revealStep(index);
  };
  const goNext = () => {
    if (stepBlockers[activeStep] || activeStep >= steps.length - 1) return;
    const next = activeStep + 1;
    setMaxReached((reached) => Math.max(reached, next));
    setActiveStep(next);
    revealStep(next);
  };
  // Edit entry point for the record-actions panel: the form below is the only
  // editor (there is no separate edit route), so editing means revealing it.
  // Draft-only by construction — the fieldset stays disabled past draft and
  // the server refuses non-draft writes regardless.
  const focusApplicationForm = () => {
    const section = document.getElementById('step-application');
    if (!section) return;
    section.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    section
      .querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      ?.focus({ preventScroll: true });
  };
  return (
    <HumanInputValidity.Provider value={reportValidity}>
      <section className={styles.editorSection}>
        <PageHeader
          title={existing.data?.applicationNumber ?? 'New Customer Application'}
          description="Manual entry or ID capture."
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
          Saves and submits in one step.
        </Alert>
        {isNew ? (
          <nav aria-label="Application steps" className={styles.stepper}>
            <ol className={styles.stepperList}>
              {steps.map((step, index) => {
                const current = index === activeStep;
                const reachable = index <= maxReached;
                return (
                  <li
                    key={step.id}
                    className={styles.stepperItem}
                    data-done={step.done}
                    data-current={current}
                  >
                    <button
                      type="button"
                      className={styles.stepperLink}
                      disabled={!reachable}
                      aria-current={current ? 'step' : undefined}
                      onClick={() => goStep(index)}
                    >
                      <span className={styles.stepperIndex} aria-hidden="true">
                        {step.done ? '✓' : index + 1}
                      </span>
                      <span className={styles.stepperLabel}>{step.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : (
          <nav aria-label="Application steps" className={styles.stepper}>
            <ol className={styles.stepperList}>
              {steps.map((step, index) => (
                <li key={step.id} className={styles.stepperItem} data-done={step.done}>
                  <a href={`#${step.id}`} className={styles.stepperLink}>
                    <span className={styles.stepperIndex} aria-hidden="true">
                      {step.done ? '✓' : index + 1}
                    </span>
                    <span className={styles.stepperLabel}>{step.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        {existing.data ? (
          <section aria-label="Application record status" className={styles.panel}>
            <div className={styles.statusHead}>
              <StatusChip
                label={existing.data.status}
                tone={APPLICATION_STATUS_TONES[existing.data.status] ?? 'neutral'}
              />
              <span className={styles.note}>Official application record</span>
            </div>
            <dl className={styles.snapshotGrid}>
              <div className={styles.snapshotField}>
                <dt>Submitted</dt>
                <dd>{existing.data.submittedAt ?? '—'}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Approved</dt>
                <dd>{existing.data.approvedAt ?? '—'}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Rejected</dt>
                <dd>{existing.data.rejectedAt ?? '—'}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Customer</dt>
                <dd>
                  {relatedCustomer ? (
                    <Link to={`/admin/customers/${relatedCustomer.id}`}>
                      {relatedCustomer.fullName}
                    </Link>
                  ) : (
                    existing.data.customerId
                  )}
                </dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Sale</dt>
                <dd>{existing.data.saleId ?? '—'}</dd>
              </div>
            </dl>
          </section>
        ) : null}
        {existing.data ? <PurchaseWorkflowPanel application={existing.data} /> : null}
        {relatedCustomer ? (
          <section aria-label="Linked company record" className={styles.panel}>
            <h2 className={styles.panelTitle}>Linked company record — read-only</h2>
            <p className={styles.hint}>
              Company record for {relatedCustomer.fullName} ({relatedCustomer.customerNumber}). Edit
              on the customer page. Stated figures never change the offer.
            </p>
            <dl className={styles.snapshotGrid}>
              <div className={styles.snapshotField}>
                <dt>RA NO</dt>
                <dd>{relatedCustomer.raNumber ?? '—'}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>STATUS (company)</dt>
                <dd>{relatedCustomer.companyStatus ?? '—'}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>CITIZENSHIP</dt>
                <dd>{relatedCustomer.citizenship ?? '—'}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>SUPPLEMENTARY</dt>
                <dd>{relatedCustomer.supplementaryFullName ?? '—'}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>RELATED</dt>
                <dd>
                  {[
                    relatedCustomer.ostIstName,
                    relatedCustomer.svdName,
                    relatedCustomer.ssmName,
                    relatedCustomer.smName,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>STATED PACKAGE</dt>
                <dd>{relatedCustomer.statedVipPackage ?? '—'}</dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => navigate(`/admin/customers/${relatedCustomer.id}`)}
              >
                Open Customer
              </Button>
            </div>
          </section>
        ) : null}
        {proposal.data ? (
          <section aria-label="Purchase terms offer" className={styles.panel}>
            <h2 className={styles.panelTitle}>
              {proposal.data.offerKind === 'newly_confirmed_offer'
                ? 'Newly confirmed offer'
                : 'Purchase terms offer'}
            </h2>
            {/* Read-only by construction: there is no price input on this screen. */}
            <dl className={styles.snapshotGrid}>
              <div className={styles.snapshotField}>
                <dt>Tier</dt>
                <dd>{proposal.data.terms.tier}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Payment scheme</dt>
                <dd>{proposal.data.terms.paymentScheme}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Total purchase amount</dt>
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
              {proposal.data.terms.monthlyAmount ? (
                <div className={styles.snapshotField}>
                  <dt>Installments</dt>
                  <dd>
                    {formatMoneyOrDash(proposal.data.terms.monthlyAmount)} ×{' '}
                    {proposal.data.terms.installmentMonths} months
                  </dd>
                </div>
              ) : null}
              <div className={styles.snapshotField}>
                <dt>Spot-cash window</dt>
                <dd>{proposal.data.terms.spotCashDays} days from first payment</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Yearly points</dt>
                <dd>{proposal.data.terms.yearlyPoints}</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Validity</dt>
                <dd>{proposal.data.terms.validityMonths} months</dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Commission</dt>
                <dd>
                  {proposal.data.terms.commissionRate} on{' '}
                  {formatMoneyOrDash(proposal.data.terms.commissionBase)} ={' '}
                  {formatMoneyOrDash(proposal.data.terms.expectedCommission)}
                </dd>
              </div>
              <div className={styles.snapshotField}>
                <dt>Offer as of</dt>
                <dd>{formatDateTime(proposal.data.asOf)}</dd>
              </div>
            </dl>
            {proposal.data.offerKind === 'newly_confirmed_offer' ? (
              <p className={styles.hint}>
                This record predates stored evidence. Confirming adds your name, time and reason.
                Figures are not historical terms.
              </p>
            ) : null}
          </section>
        ) : null}
        {selectedPlan ? (
          <DetailCard
            className={`${styles.planBenefits} ${styles[`plan${selectedPlan.code}`] ?? ''}`}
          >
            <div className={styles.planBenefitsHead}>
              <div>
                <p className={styles.planEyebrow}>Official plan benefits</p>
                <DetailCardTitle className={styles.planTitle}>{selectedPlan.name}</DetailCardTitle>
              </div>
              <TierBadge tier={selectedPlan.code} />
            </div>
            {['GOLD', 'SILVER', 'BRONZE'].includes(selectedPlan.code.trim().toUpperCase()) ? (
              <div className={styles.planArt}>
                <img {...tierArtwork(selectedPlan.code)} className={styles.planArtImage} />
              </div>
            ) : null}
            <DetailFieldGrid className={styles.planGrid}>
              <DetailField label="Discount">{selectedPlan.discountPercent}% off</DetailField>
              <DetailField label="Holder limit">{selectedPlan.cardholderLimit} max</DetailField>
              <DetailField label="Yearly points">
                {formatCountOrDash(selectedPlan.yearlyPoints)} × {selectedPlan.annualPointsTranches}
              </DetailField>
              <DetailField label="Validity">
                {selectedPlan.baseValidityYears}+{selectedPlan.validityExtensionYears} yrs
              </DetailField>
              <DetailField label="Total value">
                {formatMoneyOrDash(selectedPlan.totalLoyaltyValue)}
              </DetailField>
            </DetailFieldGrid>
            <p className={styles.hint}>Frozen at submit. Later edits change nothing.</p>
          </DetailCard>
        ) : null}
        <fieldset disabled={!editable} className={styles.formRoot}>
          {(!isNew || activeStep === 0) && (
            <section
              id="step-application"
              className={styles.panel}
              aria-labelledby="application-panel-heading"
            >
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
                      disabled={saveAndSubmit.isPending}
                      loading={customerOptions.isPending}
                      onChange={(e) => pickCustomer(e.target.value)}
                      options={[
                        { value: '', label: 'New Register' },
                        ...(customerOptions.data?.data.map((c) => ({
                          value: c.id,
                          label: c.fullName,
                        })) ?? []),
                      ]}
                    />
                  </label>
                  {customerId && linkedCustomer.isPending ? (
                    <p role="status" className={styles.pickedLine}>
                      Loading customer…
                    </p>
                  ) : null}
                  {customerId && linkedCustomer.isError ? (
                    <Alert variant="danger">
                      Customer details could not be loaded.{' '}
                      <Button variant="secondary" onClick={() => void linkedCustomer.refetch()}>
                        Retry customer details
                      </Button>
                    </Alert>
                  ) : null}
                  {!id && customerId && mayLoadImport ? (
                    <Button
                      variant="secondary"
                      loading={importPrefill.isPending}
                      onClick={() => importPrefill.mutate(customerId)}
                    >
                      Load imported customer details
                    </Button>
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
            </section>
          )}
          {(!isNew || activeStep === 1) && (
            <section
              id="step-identity"
              className={styles.panel}
              aria-labelledby="identity-panel-heading"
            >
              <h2 id="identity-panel-heading" className={styles.panelTitle}>
                2. Identity
              </h2>
              <p className={styles.hint}>Upload the ID, take a photo, pick its type.</p>
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
                      {serverCurrentDocument.reviewedFields?.idType
                        ? (GOVERNMENT_ID_TYPE_LABELS[
                            serverCurrentDocument.reviewedFields.idType as GovernmentIdType
                          ] ?? serverCurrentDocument.reviewedFields.idType)
                        : 'Missing: choose the type and upload again'}
                    </p>
                  </>
                ) : null}
                {idFile ? (
                  <div role="status" className={styles.idReady}>
                    <p className={styles.hint}>Ready to upload on save.</p>
                    {idPreviewUrl ? (
                      <button
                        type="button"
                        className={styles.thumbnailButton}
                        onClick={() => setPreviewOpen(true)}
                        aria-label="Open full ID preview"
                      >
                        <img
                          src={idPreviewUrl}
                          alt="ID preview thumbnail"
                          className={styles.thumbnailLarge}
                        />
                        <span className={styles.thumbnailZoom}>
                          {idFile.name} · {formatFileSize(idFile.size)} · Click to enlarge
                        </span>
                      </button>
                    ) : (
                      <p className={styles.hint}>
                        {idFile.name} · {formatFileSize(idFile.size)}
                      </p>
                    )}
                  </div>
                ) : null}
                <label className={styles.filterLabel}>
                  ID Type *
                  <Select
                    aria-label="ID Type"
                    value={idType}
                    disabled={saveAndSubmit.isPending}
                    onChange={(event) => setIdType(event.target.value)}
                    options={[
                      { value: '', label: 'Select ID type' },
                      ...governmentIdTypeSchema.options.map((value) => ({
                        value,
                        label: GOVERNMENT_ID_TYPE_LABELS[value],
                      })),
                    ]}
                  />
                </label>
                <IdCapturePicker
                  onFile={setIdFile}
                  disabled={saveAndSubmit.isPending}
                  resetVersion={pickerVersion}
                  showCancel={Boolean(idFile)}
                  onCancel={() => {
                    setIdFile(null);
                    setPickerVersion((version) => version + 1);
                  }}
                />
                <Dialog
                  open={previewOpen && Boolean(idPreviewUrl)}
                  onClose={() => setPreviewOpen(false)}
                  title="ID preview"
                >
                  {idPreviewUrl ? (
                    <img src={idPreviewUrl} alt="Full ID preview" className={styles.previewImage} />
                  ) : null}
                </Dialog>
                {currentDocument.isError ? (
                  <p role="status">Current ID could not be loaded. Retry before saving.</p>
                ) : null}
              </fieldset>
            </section>
          )}
          {(!isNew || activeStep === 2) && (
            <div id="step-holders">
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
                  title="Secondary holder (gold optional)"
                  value={secondary}
                  onChange={setSecondary}
                />
              ) : null}
            </div>
          )}
          {(!isNew || activeStep === 3) && (
            <fieldset id="step-recommender" className={styles.panel}>
              <legend className={styles.panelTitle}>4. Recommender details</legend>
              <p className={styles.hint}>Referrer and VIP recommender are active OST staff.</p>
              <div className={styles.editorGrid}>
                <RecommenderFields
                  meta={meta}
                  chainNames={chainNames}
                  onChange={(key, value) => setMeta((current) => ({ ...current, [key]: value }))}
                  onChain={(next) => setMeta((current) => ({ ...current, ...next }))}
                />
              </div>
            </fieldset>
          )}
          {(!isNew || activeStep === 4) && (
            <fieldset id="step-channel" className={styles.panel}>
              <legend className={styles.panelTitle}>5. Acquisition channel</legend>
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
          )}
          {(!isNew || activeStep === 5) && (
            <fieldset id="step-cert" className={styles.panel}>
              <legend className={styles.panelTitle}>6. Certification</legend>
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
          )}
        </fieldset>
        {blockers.length > 0 ? (
          <Alert variant="warning" title="Cannot save and submit yet:">
            <ul>
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className={styles.stickyFooter}>
          <div className={styles.stickyFooterActions}>
            {isNew && activeStep > 0 ? (
              <Button variant="secondary" onClick={() => goStep(activeStep - 1)}>
                Back
              </Button>
            ) : null}
            {isNew && activeStep < steps.length - 1 ? (
              <Button
                onClick={goNext}
                disabled={stepBlockers[activeStep] !== null}
                title={stepBlockers[activeStep] ?? undefined}
              >
                Next
              </Button>
            ) : null}
            {saveAction}
          </div>
        </div>
        {id ? (
          <section aria-label="Record actions" className={styles.panel}>
            <h2 className={styles.panelTitle}>Record actions</h2>
            <div className={styles.recordGroups}>
              {id && existing.data?.status === 'submitted' ? (
                <div className={styles.actionGroup}>
                  <h3 className={styles.actionGroupTitle}>Decision</h3>
                  <div className={styles.actions}>
                    <Button
                      onClick={() => decide.mutate('approved')}
                      loading={decide.isPending}
                      loadingLabel="Approving…"
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => decide.mutate('rejected')}
                      loading={decide.isPending}
                      loadingLabel="Rejecting…"
                    >
                      Reject
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => reopen.mutate()}
                      loading={reopen.isPending}
                      loadingLabel="Reopening…"
                    >
                      {existing.data.purchaseTermsId
                        ? 'Reopen to draft'
                        : 'Reopen to review purchase terms'}
                    </Button>
                  </div>
                  <p className={styles.hint}>
                    Approval needs reviewed purchase terms; reopening returns the record to
                    draft for corrections.
                  </p>
                </div>
              ) : null}
              <div className={styles.actionGroup}>
                <h3 className={styles.actionGroupTitle}>Application data</h3>
                <div className={styles.actions}>
                  {editable ? (
                    <Button variant="secondary" type="button" onClick={focusApplicationForm}>
                      Edit application
                    </Button>
                  ) : null}
                </div>
                {!editable ? (
                  <p className={styles.hint}>
                    {existing.data && ['submitted', 'rejected'].includes(existing.data.status)
                      ? 'Data is read-only once submitted. Reopen to draft to edit it.'
                      : 'Data is read-only in this status.'}
                  </p>
                ) : null}
              </div>
              {id && existing.data?.status === 'rejected' ? (
                <div className={styles.actionGroup}>
                  <h3 className={styles.actionGroupTitle}>Lifecycle</h3>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      onClick={() => reopen.mutate()}
                      loading={reopen.isPending}
                      loadingLabel="Reopening…"
                    >
                      Reopen to draft
                    </Button>
                  </div>
                </div>
              ) : null}
              {id && existing.data?.status === 'approved' && !proposal.data ? (
                <div className={styles.actionGroup}>
                  <h3 className={styles.actionGroupTitle}>Purchase terms</h3>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      onClick={() => void proposal.refetch()}
                      loading={proposal.isFetching}
                      loadingLabel="Loading offer…"
                      type="button"
                    >
                      Load purchase terms offer
                    </Button>
                  </div>
                </div>
              ) : null}
              {id && existing.data?.status === 'approved' && proposal.data ? (
                <div className={styles.actionGroup}>
                  <h3 className={styles.actionGroupTitle}>Purchase terms</h3>
                  <TextAreaField
                    id="application-review-reason"
                    name="reviewReason"
                    label="Review reason"
                    optional
                    rows={2}
                    value={reviewReason}
                    onChange={setReviewReason}
                  />
                  <div className={styles.actions}>
                    <Button
                      onClick={() => review.mutate()}
                      disabled={reviewReason.trim().length < 5}
                      loading={review.isPending}
                      loadingLabel="Confirming…"
                    >
                      Confirm purchase terms
                    </Button>
                  </div>
                </div>
              ) : null}
              {id &&
              existing.data &&
              canTransitionCustomerApplication(existing.data.status, 'cancelled') ? (
                <div className={styles.actionGroup}>
                  <h3 className={styles.actionGroupTitle}>Cancel</h3>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      onClick={() => decide.mutate('cancelled')}
                      loading={decide.isPending}
                      loadingLabel="Cancelling…"
                    >
                      Cancel
                    </Button>
                  </div>
                  <p className={styles.hint}>Cancelling ends this application. This cannot be undone.</p>
                </div>
              ) : null}
              <div className={styles.actionGroup}>
                <h3 className={styles.actionGroupTitle}>Next step</h3>
                <div className={styles.actions}>
                  {existing.data && ['submitted', 'approved'].includes(existing.data.status) && (
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`/admin/sales/reservations/new?application=${id}`)}
                    >
                      Create Reservation
                    </Button>
                  )}
                </div>
              </div>
              <div className={styles.actionGroup}>
                <h3 className={styles.actionGroupTitle}>Exports</h3>
                <div className={styles.actions}>
                  <Button
                    variant="secondary"
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
                    variant="secondary"
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
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </section>
    </HumanInputValidity.Provider>
  );
}
