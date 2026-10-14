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
import { useSession } from '../../lib/session';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { formatDateTime } from '../../lib/format';
import { applicationKeys, businessKeys, reservationKeys, sharedScopes } from './queryKeys';
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
} from './official-forms-fields';

export function CustomerApplicationsPage() {
  const navigate = useNavigate();
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
  const pickCustomer = (next: string) => {
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
        const checkedForSubmit = createCustomerApplicationSchema.safeParse(payload());
        if (!checkedForSubmit.success)
          throw new Error(humanizeApplicationIssues(checkedForSubmit.error.issues));
        if (!checkedForSubmit.data.consentAcknowledged)
          throw new Error('Certification and consent are required.');

        let appId: string;
        if (!id && !customerId) {
          const registration = registerCustomerApplicationSchema.safeParse({
            ...payload(),
            registerNewCustomer: true,
          });
          if (!registration.success)
            throw new Error(humanizeApplicationIssues(registration.error.issues));
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
        } else if (id) {
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
  const steps = [
    { id: 'step-application', label: 'Application', done: Boolean(planId && customerId) },
    {
      id: 'step-identity',
      label: 'Identity',
      done: Boolean(serverCurrentDocument?.reviewedFields?.idType || idFile),
    },
    { id: 'step-primary', label: 'Primary', done: Boolean(primary.firstName && primary.lastName) },
    { id: 'step-recommender', label: 'Recommender', done: Boolean(meta.acknowledgedAt) },
    { id: 'step-channel', label: 'Channel', done: channels.length > 0 },
    { id: 'step-cert', label: 'Certify', done: consent },
  ];
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
        {relatedCustomer ? (
          <section aria-label="Linked company record">
            <h2>Linked company record — read-only</h2>
            <p>
              Combined customer record for {relatedCustomer.fullName} (
              {relatedCustomer.customerNumber}). Edit it on the customer detail page; application
              holders below stay separate transaction facts. Stated figures never affect the
              purchase offer above.
            </p>
            <dl className="form-grid">
              <dt>RA NO</dt>
              <dd>{relatedCustomer.raNumber ?? '—'}</dd>
              <dt>STATUS (company)</dt>
              <dd>{relatedCustomer.companyStatus ?? '—'}</dd>
              <dt>CITIZENSHIP</dt>
              <dd>{relatedCustomer.citizenship ?? '—'}</dd>
              <dt>SUPPLEMENTARY</dt>
              <dd>{relatedCustomer.supplementaryFullName ?? '—'}</dd>
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
              <dt>STATED PACKAGE</dt>
              <dd>{relatedCustomer.statedVipPackage ?? '—'}</dd>
            </dl>
            <p>
              <Link to={`/admin/customers/${relatedCustomer.id}`}>
                Open customer record to view or edit all 37 company fields
              </Link>
            </p>
          </section>
        ) : null}
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
          </section>
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
                    {serverCurrentDocument.reviewedFields?.idType?.replace(/_/g, ' ') ??
                      'Missing: choose the type and upload again'}
                  </p>
                </>
              ) : null}
              {idFile ? (
                <div role="status" className={styles.idReady}>
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
                        className={styles.thumbnail}
                      />
                    </button>
                  ) : (
                    <p className={styles.hint}>Ready to upload on save.</p>
                  )}
                  <div className={styles.idReadyActions}>
                    <span className={styles.hint}>Ready to upload on save.</span>
                    <Button
                      variant="secondary"
                      disabled={saveAndSubmit.isPending}
                      onClick={() => {
                        setIdFile(null);
                        setPickerVersion((version) => version + 1);
                      }}
                    >
                      Cancel selection
                    </Button>
                  </div>
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
                      label: value
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
                    })),
                  ]}
                />
              </label>
              <IdCapturePicker
                onFile={setIdFile}
                disabled={saveAndSubmit.isPending}
                resetVersion={pickerVersion}
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
          <div id="step-primary">
            <HolderFields title="3. Primary holder" value={primary} onChange={setPrimary} />
          </div>
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
          <fieldset id="step-recommender" className={styles.panel}>
            <legend className={styles.panelTitle}>5. Recommender details</legend>
            <p className={styles.hint}>Referrer is OST staff. Recommender is free text.</p>
            <div className={styles.editorGrid}>
              <RecommenderFields
                meta={meta}
                chainNames={chainNames}
                onChange={(key, value) => setMeta((current) => ({ ...current, [key]: value }))}
                onChain={(next) => setMeta((current) => ({ ...current, ...next }))}
              />
            </div>
          </fieldset>
          <fieldset id="step-channel" className={styles.panel}>
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
          <fieldset id="step-cert" className={styles.panel}>
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
          <div className={styles.stickyFooterActions}>{saveAction}</div>
        </div>
        <p>
          {' '}
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
