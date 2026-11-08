import { downloadFile } from '../../lib/download';
import { draftReservationPaper, reservationPdf, printReservation } from './reservation-print';
import { type ApplicationRaDraft, applicationRaDraftSchema } from '@afhomes/contracts';
import { ApplicationRaReview, suggestedRaTerms } from './ApplicationRaReview';
/**

 * Customer-application pages.

 *

 * Transaction headers for the paper-form flow: the queue and the editor.

 */

import { HumanInputValidity } from '../../lib/human-input-validity';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import type { ApplicationHolder, CustomerApplication } from '@afhomes/contracts';
import { getImportRowIntake } from './import-workflow-services';
import { ImportContinuationPanel } from './ImportContinuationPanel';
import { canViewImportContinuations } from './import-continuation-access';
import {
  createCustomerApplicationSchema,
  applicationHolderSchema,
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
import { formatDate } from '../../lib/format';
import {
  applicationKeys,
  businessKeys,
  membershipKeys,
  reservationKeys,
  sharedScopes,
} from './queryKeys';
import {
  notifySuccess,
  notifyWarning,
  Alert,
  Button,
  Dialog,
  DateField,
  IdCapturePicker,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  EmptyState,
  ErrorState,
  FilterBar,
  Icon,
  type IconName,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';
import { TierBadge } from './TierBadge';
import v4 from './CustomerApplicationV4.module.css';
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

import { ApplicationChoiceCards } from './ApplicationChoiceCards';
import { ApplicationReview } from './ApplicationReview';
import { ApplicationProgress } from './ApplicationProgress';
import { getGenealogy } from '../genealogy/services';
import { filterGovernmentIdInput } from '../../lib/normalize';

import {
  today,
  emptyHolder,
  HolderFields,
  HOLDER_SECTIONS,
  holderSectionBlocker,
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
  const canSeeImportedPurchases = canViewImportContinuations(user);
  // The tab is URL state so the queue is shareable and the browser back
  // button works. An unauthorized imports link falls back to applications.
  const activeTab: 'applications' | 'imports' =
    urlParams.get('tab') === 'imports' && canSeeImportedPurchases ? 'imports' : 'applications';
  const [status, setStatus] = useState('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState(() => urlParams.get('search') ?? '');
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
    queryKey: applicationKeys.list(status, tier, debouncedSearch, applicationWorkOnly, page),
    // Keep the previous page visible while the next one loads: without this
    // the data gap reads as an empty result during every page turn.
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      getCustomerApplicationsPage({
        ...(status ? { status } : {}),
        ...(tier ? { tier } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(applicationWorkOnly ? { queue: 'application_work' as const } : {}),
        limit: QUEUE_PAGE_SIZE,
        offset: page * QUEUE_PAGE_SIZE,
      }),
    // The applications queue is not the active tab's concern. Switching back
    // re-enables it and fetches the current page.
    enabled: activeTab === 'applications',
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
  const tabHref = (tab: 'applications' | 'imports') => {
    const next = new URLSearchParams(urlParams);
    next.set('tab', tab);
    return `?${next.toString()}`;
  };
  return (
    <section className={styles.listSection}>
      <PageHeader
        title="Customer Applications"
        description="Applications and imported purchases."
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
            <Button onClick={() => navigate('/admin/customers/new')}>New application</Button>
          </>
        }
      />
      {canSeeImportedPurchases ? (
        <nav className={styles.tabs} aria-label="Customer application views">
          <Link
            to={tabHref('applications')}
            className={
              activeTab === 'applications' ? `${styles.tab} ${styles.tabCurrent}` : styles.tab
            }
            aria-current={activeTab === 'applications' ? 'page' : undefined}
          >
            Applications
          </Link>
          <Link
            to={tabHref('imports')}
            className={activeTab === 'imports' ? `${styles.tab} ${styles.tabCurrent}` : styles.tab}
            aria-current={activeTab === 'imports' ? 'page' : undefined}
          >
            Imported purchases
          </Link>
        </nav>
      ) : null}
      {activeTab === 'imports' ? (
        <ImportContinuationPanel variant="page" />
      ) : query.isPending ? (
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading applications"
        >
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
      ) : (
        <>
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

          {!query.isError && total > 0 ? (
            <div className={styles.pagination}>
              <Pagination
                page={safePage + 1}
                pageCount={pageCount}
                onChange={(next) => setPage(next - 1)}
                label="Customer applications pagination"
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Raw Zod issues (`customerId: Invalid uuid`) are never user-facing.
 * Known selector/field failures map to actionable guidance; anything else
 * keeps its path but with a readable message.
 */
export function humanizeApplicationIssues(issues: { path: PropertyKey[]; message: string }[]) {
  const messages = issues.map((issue) => {
    const [head, ...rest] = issue.path;
    if (head === 'customerId') return 'Select a customer for this application.';
    if (head === 'planId') return 'Select a VIP plan for this application.';
    if (head === 'saleId') return 'Select a sale for this reservation.';
    if (head === 'customerApplicationId')
      return 'This reservation must stay linked to its customer application.';
    if (head === 'primary' || head === 'secondary')
      return `Review the ${head} holder's identity, address and contact fields.`;
    const tail = [head, ...rest].filter((p) => typeof p === 'string').join('.');
    return tail ? `${tail}: ${issue.message}` : issue.message;
  });
  return [...new Set(messages)].join(' ');
}

/**
 * Actionable detail-load guidance per failure cause. Raw server internals and
 * stored values are never rendered (see `ErrorState`); each branch names the
 * next step instead. Returns `undefined` for unknown errors so the shared
 * generic message applies.
 */
/** One icon per government ID type, matching the reference's own tile
 * glyphs (which reused one glyph across more than one type too - exact
 * per-type icon variety was never the point, a recognizable tile is). */
const GOVERNMENT_ID_TYPE_ICONS: Record<GovernmentIdType, IconName> = {
  philippine_id: 'file-text',
  drivers_license: 'image',
  passport: 'file-text',
  tax_id: 'file-text',
  other: 'file-text',
};

function describeApplicationLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFhomes support.';
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
    { label: 'Application Submitted', done: status !== 'draft', current: status === 'draft' },
    { label: 'Application Approved', done: approved, current: status === 'submitted' },
    {
      label: 'Reservation Created',
      done: hasReservation,
      current: status === 'approved' && !hasReservation,
    },
    { label: 'Payment Processing', done: finalized, current: hasReservation && !finalized },
    { label: 'Activation', done: false, current: finalized },
    { label: 'Commission', done: false, current: false },
  ];

  const next = !hasReservation
    ? status === 'submitted'
      ? {
          label: 'Review terms',
          detail: 'Review the offer, then decide.',
          to: null,
        }
      : status === 'approved'
        ? {
            label: 'Create Reservation',
            detail: 'Create the agreement for this approved application.',
            to: `/admin/sales/reservations/new?application=${encodeURIComponent(application.id)}`,
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

  const doneCount = steps.filter((s) => s.done).length;
  return (
    <section aria-label="Purchase workflow" className={styles.panel}>
      <div className={styles.workflowHeader}>
        <h2 className={styles.panelTitle}>Purchase workflow</h2>
        <span className={styles.workflowProgress}>
          {doneCount} of {steps.length} complete
        </span>
      </div>
      <ol className={styles.workflowTimeline}>
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={styles.workflowTimelineItem}
            data-state={step.done ? 'Done' : step.current ? 'Current' : 'Pending'}
          >
            <span className={styles.workflowNode} aria-hidden="true">
              {step.done ? '✓' : String(index + 1)}
            </span>
            <div className={styles.workflowTimelineBody}>
              <span className={styles.workflowTimelineLabel}>{step.label}</span>
              {step.current ? (
                <Icon name="chevron-right" size={14} className={styles.workflowTimelineStatus} />
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <span className={styles.workflowConnector} aria-hidden="true" />
            ) : null}
          </li>
        ))}
      </ol>
      <div className={styles.workflowNextCard}>
        <div className={styles.workflowNextHead}>
          <span className={styles.workflowNextEyebrow}>Next step</span>
          <h3 className={styles.workflowNextTitle}>{next.label}</h3>
        </div>
        {reservations.isError ? (
          <ErrorState error={reservations.error} onRetry={() => void reservations.refetch()} />
        ) : null}
        {reservations.isSuccess && next.to ? (
          <Button onClick={() => navigate(next.to!)}>{next.label}</Button>
        ) : null}
      </div>
    </section>
  );
}

/** Compact date-only instant for dense record cards. */
function shortInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function CustomerApplicationEditorPage() {
  const formScrollRef = useRef<HTMLDivElement>(null);
  const { user: applicationUser } = useSession();
  const mayLoadImport =
    applicationUser?.roleSlug === 'super_admin' ||
    (applicationUser?.afHomesPermissions.some(
      (p) => p.moduleKey === 'governance.customer_import' && p.canView,
    ) ??
      false);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const reportValidity = useCallback((field: string, invalid: boolean) => {
    setInvalidFields((current) =>
      current[field] === invalid ? current : { ...current, [field]: invalid },
    );
  }, []);
  const { id } = useParams();
  const isNew = !id;
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
  const [applicationSearch, setApplicationSearch] = useSearchParams();
  const importRowId = applicationSearch.get('importRowId');
  const [importPurchaseReference, setImportPurchaseReference] = useState('');
  const importIntake = useQuery({
    queryKey: ['customer-import-intake', importRowId],
    queryFn: () => getImportRowIntake(importRowId!),
    enabled: Boolean(importRowId && !id && mayLoadImport),
    retry: false,
  });
  const [customerId, setCustomerId] = useState(() =>
    isNew && !importRowId ? '' : (applicationSearch.get('customerId') ?? ''),
  );
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
  const [holderSection, setHolderSection] = useState('personal');
  const [raNumberMode, setRaNumberMode] = useState<'automatic' | 'manual'>('automatic');
  const [secondary, setSecondary] = useState<ApplicationHolder | null>(null);
  const [meta, setMeta] = useState({
    svdStaffId: '',
    ssmStaffId: '',
    smStaffId: '',
    referrerStaffId: '',
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
    acknowledgedAt: importRowId ? '' : today(),
    // `referrerAaNumber` and `recommenderStaffId` are local-only - the
    // request schemas don't declare them, so Zod strips both before
    // anything is sent. `recommenderAaNumber` IS declared and IS sent,
    // transiently, so the server can re-verify the same-team rule itself.
    referrerAaNumber: '',
    recommenderAaNumber: '',
    recommenderStaffId: '',
  });
  const [raDraft, setRaDraft] = useState<ApplicationRaDraft>({});
  const [raTermsSource, setRaTermsSource] = useState('');
  const [networkTeamError, setNetworkTeamError] = useState('');
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
  // Write-only (never returned): starts blank on every open, blank never clears
  // the stored value.
  const [idNumber, setIdNumber] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const DRAFT_KEY = 'afhomes.customerApplication.draft';
  const [activeStep, setActiveStep] = useState(() => {
    const step = Number(applicationSearch.get('step'));
    return !isNew && Number.isFinite(step) && step >= 0 && step <= 6 ? step : 0;
  });
  const [maxReached, setMaxReached] = useState(() => (id ? 5 : 0));
  useEffect(() => {
    const current = applicationSearch.get('step');
    const desired = activeStep > 0 ? String(activeStep) : null;
    if (current === desired) return;
    const next = new URLSearchParams(applicationSearch);
    if (desired) next.set('step', desired);
    else next.delete('step');
    setApplicationSearch(next, { replace: true });
  }, [activeStep, applicationSearch, setApplicationSearch]);

  // Hydrate a saved draft on mount (new applications only).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isNew) return;
    if (import.meta.env.MODE === 'test') return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Record<string, unknown>;
      if (draft.raDraft) setRaDraft(draft.raDraft as ApplicationRaDraft);
      if (typeof draft.raTermsSource === 'string') setRaTermsSource(draft.raTermsSource);
      if (draft.primary) setPrimary(draft.primary as typeof primary);
      if (draft.secondary !== undefined) setSecondary(draft.secondary as ApplicationHolder | null);
      if (draft.meta) setMeta(draft.meta as typeof meta);
      if (Array.isArray(draft.channels)) setChannels(draft.channels as string[]);
      if (typeof draft.tier === 'string') setTier(draft.tier as 'BRONZE' | 'SILVER' | 'GOLD');
      if (typeof draft.paymentScheme === 'string')
        setPaymentScheme(draft.paymentScheme as typeof paymentScheme);
      if (importRowId && typeof draft.customerId === 'string') setCustomerId(draft.customerId);
      if (typeof draft.planId === 'string') setPlanId(draft.planId);
      if (draft.raNumberMode === 'automatic' || draft.raNumberMode === 'manual')
        setRaNumberMode(draft.raNumberMode);
      if (typeof draft.idType === 'string') setIdType(draft.idType);
      if (typeof draft.idNumber === 'string') setIdNumber(draft.idNumber);
      if (typeof draft.activeStep === 'number' && draft.activeStep >= 0 && draft.activeStep <= 6) {
        setActiveStep(draft.activeStep);
        setMaxReached(draft.activeStep);
      }
    } catch {
      /* ignore corrupt draft */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist the draft on change (new applications only).
  useEffect(() => {
    if (!isNew) return;
    if (import.meta.env.MODE === 'test') return;
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          raDraft, raTermsSource,
          primary,
          secondary,
          meta,
          channels,
          tier,
          paymentScheme,
          customerId,
          planId,
          raNumberMode,
          idType,
          idNumber,
          activeStep,
        }),
      );
    } catch {
      /* ignore storage errors */
    }
  }, [
    raDraft, raTermsSource,
    isNew,
    primary,
    secondary,
    meta,
    channels,
    tier,
    paymentScheme,
    customerId,
    planId,
    raNumberMode,
    idType,
    idNumber,
    activeStep,
  ]);
  // Track successful submission to hide the ID verification note in the Certify step.
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  // Steps unlock only by moving forward. Going back is always free; jumping
  // ahead never is, so an operator cannot skip a step's own checks. Existing
  // records open unlocked: their data was entered before, or the form below
  // is read-only review anyway.
  // The wizard guides NEW applications step by step. Existing records keep
  // the full page: reviewers need every section and decision button at once.
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
      client.setQueryData(sharedScopes.documentsCurrentCustomer(targetCustomerId), document);
      return { documentId: grant.documentId, filename: file.name };
    },
    [client],
  );
  const runSave = useSingleFlight<Awaited<ReturnType<typeof createCustomerApplication>>>();
  const applicationRequest = useMutationRequest();
  const registeredApplication = useRef<Awaited<
    ReturnType<typeof registerCustomerApplication>
  > | null>(null);
  const [pickerVersion, setPickerVersion] = useState(0);
  // Customer dropdown: one bounded page (the server max), so every option is
  // reachable without loading an unbounded directory into the control. The
  // chosen record resolves to a display name through the same single-customer
  // query the detail page uses (shared cache key).
  const customerOptions = useQuery({
    queryKey: applicationKeys.picker,
    queryFn: () => getCustomersPage({ limit: 200, offset: 0 }),
    enabled: !isNew || Boolean(importRowId),
  });
  const linkedCustomer = useQuery({
    queryKey: businessKeys.customer(customerId),
    queryFn: () => getCustomerById(customerId),
    enabled: Boolean(customerId) && (!isNew || Boolean(importRowId)),
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
      // Layer the workbook's richer fields on top of whatever the customer's
      // own profile already prefilled - never dropped back to a blank holder,
      // so a field the workbook doesn't carry keeps its profile-sourced value.
      setPrimary((current) => ({ ...current, ...data.primary, holderType: 'PRIMARY' }));
      setRaNumberMode(data.primary?.raNumber ? 'manual' : 'automatic');
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
    onError: (error) => {
      // Missing workbook data is normal, not a failure (the customer's own
      // profile already prefilled the form above) - never show it as a
      // warning. Anything else is a genuine failure and keeps the warning.
      if (error instanceof ApiError && error.code === 'NOT_FOUND') {
        notifySuccess({
          title: 'No workbook import found',
          message:
            'This customer has no committed workbook import on file. Their existing profile details are already filled in - continue the application by hand.',
        });
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not load imported details.');
    },
  });
  const loadedImport = useRef<string | null>(null);
  useEffect(() => {
    const source = importIntake.data;
    if (!source || !importRowId || loadedImport.current === importRowId || plans.isPending) return;
    if (source.continuation.applicationId) {
      navigate(`/admin/customers/applications/${source.continuation.applicationId}`, {
        replace: true,
      });
      return;
    }
    const timer = window.setTimeout(() => {
      loadedImport.current = importRowId;
      const data = source.prefill;
      setImportPurchaseReference(source.purchaseReference ?? '');
      if (source.continuation.customerId) {
        setCustomerId(source.continuation.customerId);
        selectedCustomerRef.current = source.continuation.customerId;
        setPrefilledCustomerId(source.continuation.customerId);
      }
      setPrimary({ ...emptyHolder('PRIMARY'), ...data.primary, holderType: 'PRIMARY' });
      setRaNumberMode(data.primary?.raNumber ? 'manual' : 'automatic');
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
      setMeta((current) => ({
        ...current,
        ...source.team,
        acknowledgedAt: '',
        vipRecommenderName: data.recommenderName,
        recommenderContact: data.recommenderContact,
        recommenderEmail: data.recommenderEmail,
      }));
      setMessage(
        'Imported details loaded for review. Enter the actual acknowledgement date and confirm the required evidence. Imported payment claims are reviewed separately by Finance.',
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [importIntake.data, importRowId, plans.data, plans.isPending, navigate]);
  const pickCustomer = (next: string) => {
    if (importRowId && next !== importIntake.data?.continuation.customerId) {
      setMessage(
        'This imported purchase belongs to its linked customer. Open a separate application to select another customer.',
      );
      return;
    }
    selectedCustomerRef.current = next;
    if (prefilledCustomerId && next !== prefilledCustomerId) {
      setPrimary(emptyHolder('PRIMARY'));
      setRaNumberMode('automatic');
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
    staleTime: 30_000,
    retry: false,
  });
  // There is no current document when the server says none, including all-rejected histories.
  const serverCurrentDocument =
    currentDocument.data?.isCurrent === true &&
    currentDocument.data.hasFile &&
    currentDocument.data.verificationStatus !== 'rejected'
      ? currentDocument.data
      : null;
  const network = useQuery({
    queryKey: ['genealogy', 'referral-chain'],
    queryFn: getGenealogy,
    enabled: isNew && !importRowId && activeStep >= 3,
    retry: false,
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
  const primaryComplete = applicationHolderSchema.safeParse(primary).success;
  const blockers: string[] = [];
  if (!primaryComplete) blockers.push('Complete primary holder fields.');
  if (secondary && !applicationHolderSchema.safeParse(secondary).success)
    blockers.push('Complete secondary holder fields.');
  if (isNew && !importRowId && networkTeamError) blockers.push(networkTeamError);
  if (importRowId) {
    if (!mayLoadImport)
      blockers.push('Customer import access is required to review this purchase.');
    else if (importIntake.isError)
      blockers.push(
        'Imported purchase review could not be loaded. Return to the customer record and retry.',
      );
    else if (!importIntake.data) blockers.push('Wait for the imported purchase review to load.');
    if (!importPurchaseReference.trim()) blockers.push('Enter the actual purchase reference.');
    if (importIntake.data?.continuation.conflicts.length)
      blockers.push('Resolve the imported customer conflicts before saving.');
    if (!meta.acknowledgedAt) blockers.push('Enter the actual acknowledgement date.');
  }
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
      setRaDraft(app.raDraft ?? {});
      setRaTermsSource(`${app.planId}:${app.paymentScheme}`);
      setSecondary(app.secondary ?? null);
      setMeta({
        svdStaffId: app.svdStaffId ?? '',
        ssmStaffId: app.ssmStaffId ?? '',
        smStaffId: app.smStaffId ?? '',
        referrerStaffId: app.referrerStaffId ?? '',
        vipRecommenderName: app.vipRecommenderName ?? '',
        recommenderContact: app.recommenderContact ?? '',
        recommenderEmail: app.recommenderEmail ?? '',
        acknowledgedAt: app.acknowledgedAt ?? '',
        // Edit mode never uses the AA-number flow (`networkSelection` is
        // only ever true for a brand-new application), so these stay blank.
        referrerAaNumber: '',
        recommenderAaNumber: '',
        recommenderStaffId: '',
      });
      setChannels(app.acquisitionChannels);
      setConsent(app.consentAcknowledged);
      setValidId(app.validIdReceived);
      setPaymentProof(app.reservationPaymentProofReceived);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [existing.data]);
  const currentRaSource = `${planId}:${paymentScheme}`;
  const raDefaults = suggestedRaTerms(plans.data?.find(p => p.id === planId), paymentScheme);
  const effectiveRaDraft = raTermsSource === currentRaSource ? raDraft : { ...raDraft, ...raDefaults };
  const changeRaDraft = (value: ApplicationRaDraft) => { setRaTermsSource(currentRaSource); setRaDraft(value); };
  const printRaDraft = async () => {
    const checked = applicationRaDraftSchema.parse(effectiveRaDraft);
    await printReservation(draftReservationPaper(primary, secondary, tier, paymentScheme, plans.data?.find(p => p.id === planId), checked));
  };
  const downloadRaDraft = async () => {
    const checked = applicationRaDraftSchema.parse(effectiveRaDraft);
    downloadFile(await reservationPdf(draftReservationPaper(primary, secondary, tier, paymentScheme, plans.data?.find(p => p.id === planId), checked)));
  };
  const payload = () => ({
    raDraft: effectiveRaDraft,
    // Unchosen selectors stay absent: never send "" as a UUID.
    customerId: customerId || undefined,
    planId: planId || undefined,
    tier,
    paymentScheme,
    // Company-stated mirror: the selected card tier and payment scheme are the
    // company-stated VIP package / payment terms, so the customer record's
    // "Package and Payment (company stated)" block reflects the application
    // without a separate "Edit stated record" pass. Prices stay manual.
    statedVipPackage: tier,
    statedPaymentTerms: paymentScheme,
    primary: { ...primary, holderType: 'PRIMARY' as const },
    secondary: secondary ? { ...secondary, holderType: 'SECONDARY' as const } : undefined,
    governmentIdNumber: idNumber.trim() || undefined,
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
        if (isNew && !importRowId) {
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
          const alreadyRegistered = registeredApplication.current;
          const created =
            alreadyRegistered ??
            (await registerCustomerApplication({
              ...registration.data,
              requestId: applicationRequest.forPayload(registration.data),
            }));
          registeredApplication.current = created;
          appId = created.id;
          if (alreadyRegistered) {
            const latest = await getCustomerApplication(created.id);
            if (latest.status === 'submitted') {
              const offer = await getPurchaseTermsProposal(created.id);
              return submitCustomerApplication(created.id, {
                requestId: applicationRequest.forPayload({
                  applicationId: created.id,
                  expectedProposalHash: offer.expectedProposalHash,
                }),
                expectedProposalHash: offer.expectedProposalHash,
              });
            }
            await updateCustomerApplication(
              created.id,
              createCustomerApplicationSchema.parse({
                ...registration.data,
                customerId: created.customerId,
              }),
            );
          }
          // New customer now exists: upload the picked ID on Save.
          if (idFile) {
            if (!idType) throw new Error('Choose ID type first.');
            await uploadPendingId(created.customerId, idFile, idType);
            setIdFile(null);
            setPickerVersion((version) => version + 1);
            setValidId(true);
            setCustomerId(created.customerId);
            // `currentDocument`'s queryFn is still closed over this render's
            // (empty) `customerId` - refetching it here would ask the server
            // for the current document of no one ("A valid subject is
            // required"). Nothing below reads its result, and the next
            // render's `enabled`/query-key change (now that `customerId` is
            // set) fetches the right one on its own, so there is nothing to
            // wait for here.
          }
        } else {
          if (importRowId && (!importIntake.data || importIntake.isError))
            throw new Error('Load the imported purchase review before saving.');
          if (importRowId && !importPurchaseReference.trim())
            throw new Error(
              'Enter the actual purchase reference. Reuse the same reference for the same purchase.',
            );
          if (importIntake.data?.continuation.conflicts.length)
            throw new Error('Resolve the imported purchase conflicts before saving.');
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
              // A UI-display refresh only; nothing below reads it, so it must
              // not hold up the save.
              void currentDocument.refetch();
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
              // A UI-display refresh only; nothing below reads it, so it must
              // not hold up the save.
              void currentDocument.refetch();
            }
            const created = await createCustomerApplication({
              ...checkedForSubmit.data,
              requestId: applicationRequest.forPayload(checkedForSubmit.data),
              ...(importRowId && importIntake.data
                ? {
                    importContext: {
                      rowId: importRowId,
                      purchaseReference: importPurchaseReference.trim(),
                      requestId: applicationRequest.forPayload(checkedForSubmit.data),
                      expectedSourceHash: importIntake.data.continuation.expectedSourceHash,
                      expectedTargetVersion: importIntake.data.continuation.expectedTargetVersion,
                    },
                  }
                : {}),
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
      setSubmissionSuccess(true);
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      if (!id) navigate(`/admin/customers/applications/${app.id}`, { replace: true });
      if (isEditRoute) navigate(`/admin/customers/applications/${id}`, { replace: true });
      // Cache refresh is bookkeeping, not part of "did this succeed" - it runs
      // in the background so the success state and redirect above never wait
      // on it. A brand-new application has no route `id` yet (this page is
      // about to navigate away to one), so `existing`/`proposal` would only
      // ever refetch with an undefined id and 404 ("Official form endpoint
      // not found") - only refresh them when editing an existing application.
      void Promise.all([
        id ? existing.refetch() : Promise.resolve(),
        id ? proposal.refetch() : Promise.resolve(),
        client.invalidateQueries({ queryKey: applicationKeys.scope }),
        client.invalidateQueries({ queryKey: reservationKeys.scope }),
        client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope }),
        client.invalidateQueries({ queryKey: sharedScopes.reports }),
      ]).catch(() => {
        /* best-effort cache refresh; a stale list self-heals on next visit */
      });
    },
    onError: (e) => {
      setSubmissionSuccess(false);
      setMessage(e instanceof Error ? e.message : 'Save and submit failed.');
    },
  });
  // One stable request identity per logical action, so a timeout-after-commit
  // retry replays the original decision instead of attempting a second one.
  const decisionRequest = useMutationRequest();
  const decide = useBusinessMutation({
    mutationFn: (decision: 'approved' | 'rejected' | 'cancelled') => {
      setDecidingDecision(decision);
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
      setDecidingDecision(null);
      notifySuccess({ title: 'Success', message: 'Decision recorded.' });
      decisionRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
      void client.invalidateQueries({ queryKey: applicationKeys.reservations(id!) });
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: ['reservation-payments'] });
      void client.invalidateQueries({ queryKey: ['reservation-finance'] });
      void client.invalidateQueries({ queryKey: businessKeys.queue });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
      void client.invalidateQueries({ queryKey: sharedScopes.reports });
    },
    onError: (e) => {
      setDecidingDecision(null);
      setMessage(e instanceof Error ? e.message : 'Decision failed.');
    },
  });
  // Old approved applications have no stored commercial evidence. Reviewing is an
  // explicit confirmation of the offer currently shown, never an override price.
  const [decidingDecision, setDecidingDecision] = useState<
    'approved' | 'rejected' | 'cancelled' | null
  >(null);
  const reviewRequest = useMutationRequest();
  const review = useBusinessMutation({
    mutationFn: async () => {
      // Always fetch fresh: proposal.data may be a stale snapshot from the
      // current render (React Query cache updates before component re-renders).
      const offer = await getPurchaseTermsProposal(id!);
      if (!offer) throw new Error('Load the purchase terms offer before confirming.');
      const reason = 'Auto-confirmed on approval';
      return reviewApplicationPurchaseTerms(id!, {
        requestId: reviewRequest.forPayload({
          applicationId: id,
          expectedProposalHash: offer.expectedProposalHash,
          reason,
        }),
        expectedProposalHash: offer.expectedProposalHash,
        reason,
      });
    },
    onSuccess: () => {
      notifySuccess({
        title: 'Success',
        message: 'Purchase terms confirmed and frozen for this application.',
      });
      reviewRequest.complete();
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
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
      navigate(`/admin/customers/applications/${id}/edit`);
      void existing.refetch();
      void proposal.refetch();
      void client.invalidateQueries({ queryKey: applicationKeys.scope });
      void client.invalidateQueries({ queryKey: reservationKeys.scope });
      void client.invalidateQueries({ queryKey: membershipKeys.customerLookupScope });
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : 'Reopen failed.'),
  });
  const location = useLocation();
  const editable = !existing.data || existing.data.status === 'draft';
  const isEditRoute = location.pathname.endsWith('/edit');
  const showForm = isNew || editable || isEditRoute;
  // Compute whether any action button in the Actions card would be enabled.
  const hasRecordActions =
    id &&
    !isEditRoute &&
    existing.data &&
    (existing.data.status === 'submitted' || existing.data.status === 'rejected');
  const selectedPlan = plans.data?.find((p) => p.id === planId);
  const planPreview = selectedPlan ? (
    <DetailCard className={`${styles.planBenefits} ${styles[`plan${selectedPlan.code}`] ?? ''}`}>
      <div className={styles.planBenefitsHead}>
        <div>
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
        <DetailField label="Total loyalty value">
          {formatMoneyOrDash(selectedPlan.totalLoyaltyValue)}
        </DetailField>
        <DetailField label="Holders">{selectedPlan.cardholderLimit} maximum</DetailField>
      </DetailFieldGrid>
      <details className={styles.planDetails}>
        <summary>View plan details</summary>
        <DetailFieldGrid className={styles.planGrid}>
          <DetailField label="Discount">{selectedPlan.discountPercent}% off</DetailField>
          <DetailField label="Yearly points">
            {formatCountOrDash(selectedPlan.yearlyPoints)} × {selectedPlan.annualPointsTranches}
          </DetailField>
          <DetailField label="Validity">
            {selectedPlan.baseValidityYears}+{selectedPlan.validityExtensionYears} yrs
          </DetailField>
        </DetailFieldGrid>
      </details>
      <p className={styles.hint}>
        Plan details are frozen when the application is submitted, not when you select a card.
      </p>
    </DetailCard>
  ) : null;
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
      className={isNew ? `${v4.btn} ${v4.primary}` : undefined}
      onClick={() => {
        if (!isNew || activeStep === 6) saveAndSubmit.mutate();
      }}
      disabled={!editable || saveAndSubmit.isPending || blockers.length > 0 || !applicationRaDraftSchema.safeParse(effectiveRaDraft).success}
      loading={saveAndSubmit.isPending}
      loadingLabel="Saving…"
    >
      {isNew ? 'Submit application' : 'Submit'}
    </Button>
  );
  // Per-step Next gates. Each mirrors a save blocker, never more: Save stays
  // the final authority, and Next can never refuse what Save allows.
  const holderSectionIndex = HOLDER_SECTIONS.indexOf(
    holderSection as (typeof HOLDER_SECTIONS)[number],
  );
  const nextHolderSection = HOLDER_SECTIONS[holderSectionIndex + 1];
  const nextHolderSectionLabel =
    nextHolderSection === 'work'
      ? 'Additional'
      : nextHolderSection
        ? nextHolderSection.charAt(0).toUpperCase() + nextHolderSection.slice(1)
        : '';
  const stepBlockers: (string | null)[] = [
    !planId ? 'Select a VIP plan.' : null,
    !serverCurrentDocument?.reviewedFields?.idType && !idFile
      ? 'Upload a valid ID and choose its ID type.'
      : idFile && !idType
        ? 'Choose ID type first.'
        : null,
    holderSectionBlocker(primary, holderSection, holderSection === 'work') ??
      (secondary ? holderSectionBlocker(secondary, holderSection, holderSection === 'work') : null),
    !optionalPhonesValid
      ? 'Correct the recommender contact or landline number.'
      : isNew && !importRowId && networkTeamError
        ? networkTeamError
        : null,
    null,
    !consent ? 'Certification and consent must be ticked.' : null,
    null,
  ];
  const steps = [
    { id: 'step-application', label: 'Application', done: Boolean(planId) },
    {
      id: 'step-identity',
      label: 'Identity',
      done: Boolean(serverCurrentDocument?.reviewedFields?.idType || idFile),
    },
    {
      id: 'step-holders',
      label: 'Holders',
      done: primaryComplete && (!secondary || applicationHolderSchema.safeParse(secondary).success),
    },
    {
      id: 'step-recommender',
      label: 'Network',
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
    ...(isNew ? [{ id: 'step-review', label: 'Review', done: blockers.length === 0 }] : []),
  ];
  const revealStep = (targetId?: string) => {
    window.setTimeout(() => {
      const panel = formScrollRef.current;
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
      // Existing record layouts may own a scroll pane; V4 uses the page.
      if (!isNew && panel && window.getComputedStyle(panel).overflowY === 'auto') {
        panel.scrollTo({
          top: target
            ? panel.scrollTop +
              target.getBoundingClientRect().top -
              panel.getBoundingClientRect().top -
              16
            : 0,
          left: 0,
        });
      } else if (target) target.scrollIntoView?.({ block: 'start' });
      else window.scrollTo({ top: 0, left: 0 });
    }, 0);
  };
  const goStep = (index: number, targetId?: string) => {
    if (index < 0 || index > steps.length - 1 || index > maxReached) return;
    if (index === 2) {
      setHolderSection(targetId?.split('-').at(-1) ?? 'personal');
    }
    setActiveStep(index);
    revealStep(
      index === 2 && targetId?.endsWith('-identity')
        ? targetId.replace(/-identity$/, '-personal')
        : targetId,
    );
  };
  const goNext = () => {
    if (stepBlockers[activeStep] || activeStep >= steps.length - 1) return;
    if (activeStep === 2 && nextHolderSection) {
      setHolderSection(nextHolderSection);
      revealStep(`primary-${nextHolderSection}`);
      return;
    }
    const next = activeStep + 1;
    setMaxReached((reached) => Math.max(reached, next));
    setActiveStep(next);
    revealStep();
  };
  // Edit entry point for the record-actions panel: the form below is the only
  // editor (there is no separate edit route), so editing means revealing it.
  // Draft-only by construction — the fieldset stays disabled past draft and
  // the server refuses non-draft writes regardless.
  return (
    <HumanInputValidity.Provider value={reportValidity}>
      <section className={isNew ? `${v4.application} ${v4.wrap}` : styles.editorSection}>
        {isNew ? (
          <div className={v4.pageTop}>
            <div>
              <h1>New Customer Application</h1>
              <p>Create and submit a customer application for staff review.</p>
            </div>
            <button
              type="button"
              className={v4.plainlink}
              onClick={() => navigate('/admin/customers/applications')}
            >
              ← Back to applications
            </button>
          </div>
        ) : (
          <PageHeader
            title={existing.data?.applicationNumber ?? 'New Customer Application'}
            description={
              isNew
                ? 'Create and submit a customer application for staff review.'
                : 'Manual entry or ID capture.'
            }
            actions={
              <>
                <Button
                  variant="secondary"
                  onClick={() => navigate('/admin/customers/applications')}
                >
                  Back to applications
                </Button>
              </>
            }
          />
        )}
        <div className={isNew ? v4.workspace : styles.recordWorkspace}>
          {isNew ? (
            <aside aria-label="Selected VIP card" className={v4.vip}>
              <h2 className={v4.vipTitle}>VIP card</h2>
              <p className={v4.subtle}>
                Choose a plan. The selection stays here throughout your application.
              </p>
              {plans.isPending ? (
                <p role="status">Loading VIP plans…</p>
              ) : plans.isError ? (
                <ErrorState
                  title="VIP plans could not be loaded"
                  onRetry={() => void plans.refetch()}
                />
              ) : (
                <ApplicationChoiceCards
                  required
                  segmented
                  label="VIP plan *"
                  value={planId}
                  options={(plans.data ?? [])
                    .filter((plan) => ['BRONZE', 'SILVER', 'GOLD'].includes(plan.code))
                    .sort(
                      (a, b) =>
                        ['BRONZE', 'SILVER', 'GOLD'].indexOf(a.code) -
                        ['BRONZE', 'SILVER', 'GOLD'].indexOf(b.code),
                    )
                    .map((plan) => ({
                      value: plan.id,
                      label: plan.code[0] + plan.code.slice(1).toLowerCase(),
                    }))}
                  onChange={(next) => {
                    const plan = plans.data?.find((p) => p.id === next);
                    setPlanId(next);
                    setTier((plan?.code ?? 'BRONZE') as typeof tier);
                    if (plan?.code !== 'GOLD') setSecondary(null);
                  }}
                />
              )}
              {!plans.isPending &&
              !plans.isError &&
              !plans.data?.some((plan) => ['BRONZE', 'SILVER', 'GOLD'].includes(plan.code)) ? (
                <Alert variant="warning">
                  No VIP plans are available. Contact an administrator.
                </Alert>
              ) : null}
              {selectedPlan ? (
                <>
                  <div className={v4.vipcard}>
                    <img {...tierArtwork(selectedPlan.code)} />
                  </div>
                  <div className={v4.planmeta}>
                    <strong>
                      {selectedPlan.code[0] + selectedPlan.code.slice(1).toLowerCase()} VIP
                    </strong>
                    <span className={v4.tag}>{selectedPlan.code}</span>
                  </div>
                  <div className={v4.statline}>
                    <span>Total loyalty value</span>
                    <b>{formatMoneyOrDash(selectedPlan.totalLoyaltyValue)}</b>
                  </div>
                  <div className={v4.statline}>
                    <span>Holders</span>
                    <b>{selectedPlan.cardholderLimit} maximum</b>
                  </div>
                  <details className={v4.planDisclosure}>
                    <summary className={v4.textlink}>View plan details</summary>
                    <div className={v4.statline}>
                      <span>Discount</span>
                      <b>{selectedPlan.discountPercent}% off</b>
                    </div>
                    <div className={v4.statline}>
                      <span>Yearly points</span>
                      <b>
                        {formatCountOrDash(selectedPlan.yearlyPoints)} ×{' '}
                        {selectedPlan.annualPointsTranches}
                      </b>
                    </div>
                    <div className={v4.statline}>
                      <span>Validity</span>
                      <b>
                        {selectedPlan.baseValidityYears}+{selectedPlan.validityExtensionYears} yrs
                      </b>
                    </div>
                  </details>
                  <div className={v4.viphint}>
                    Plan details are frozen when the application is submitted, not when you select a
                    card.
                  </div>
                </>
              ) : (
                <div className={v4.viphint}>
                  Choose a plan above to preview your card and its benefits.
                </div>
              )}
            </aside>
          ) : null}
          <div
            ref={formScrollRef}
            className={isNew ? v4.right : styles.recordControls}
            role={isNew ? 'region' : undefined}
            aria-label={isNew ? 'Application form' : undefined}
            tabIndex={isNew ? 0 : undefined}
          >
            {isNew ? (
              <ApplicationProgress
                steps={steps}
                activeStep={activeStep}
                maxReached={maxReached}
                onNavigate={goStep}
              />
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
            {existing.data && !isEditRoute ? (
              <section aria-label="Application record status" className={styles.panel}>
                <ol className={styles.statusTimeline} aria-label="Application lifecycle">
                  <li
                    className={styles.statusMilestone}
                    data-state={existing.data.submittedAt ? 'Done' : 'Pending'}
                  >
                    <span className={styles.statusMarker} aria-hidden="true">
                      {existing.data.submittedAt ? '✓' : '○'}
                    </span>
                    <div className={styles.statusMilestoneBody}>
                      <span className={styles.statusMilestoneLabel}>Submitted</span>
                      <span className={styles.statusMilestoneTime}>
                        {shortInstant(existing.data.submittedAt) ?? 'Not recorded'}
                      </span>
                    </div>
                  </li>
                  <li
                    className={styles.statusMilestone}
                    data-state={existing.data.status === 'approved' ? 'Done' : 'Pending'}
                  >
                    <span className={styles.statusMarker} aria-hidden="true">
                      {existing.data.approvedAt ? '✓' : '○'}
                    </span>
                    <div className={styles.statusMilestoneBody}>
                      <span className={styles.statusMilestoneLabel}>Approved</span>
                      <span className={styles.statusMilestoneTime}>
                        {existing.data.status === 'approved'
                          ? (shortInstant(existing.data.approvedAt) ?? 'Not recorded')
                          : 'Not recorded'}
                      </span>
                    </div>
                  </li>
                  <li
                    className={styles.statusMilestone}
                    data-state={existing.data.status === 'rejected' ? 'Done' : 'Pending'}
                  >
                    <span className={styles.statusMarker} aria-hidden="true">
                      {existing.data.rejectedAt ? '✓' : '○'}
                    </span>
                    <div className={styles.statusMilestoneBody}>
                      <span className={styles.statusMilestoneLabel}>Rejected</span>
                      <span className={styles.statusMilestoneTime}>
                        {existing.data.status === 'rejected'
                          ? (shortInstant(existing.data.rejectedAt) ?? 'Not recorded')
                          : 'Not recorded'}
                      </span>
                    </div>
                  </li>
                </ol>
                {relatedCustomer ? (
                  <div className={styles.linkedCustomerRow}>
                    <div className={styles.linkedCustomerBody}>
                      <Link
                        to={`/admin/customers/${relatedCustomer.id}`}
                        className={styles.linkedCustomerName}
                      >
                        {relatedCustomer.fullName}
                      </Link>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      style={{
                        backgroundColor: 'var(--color-success)',
                        borderColor: 'var(--color-success)',
                        color: '#fff',
                      }}
                      onClick={() => navigate(`/admin/customers/${relatedCustomer.id}`)}
                    >
                      Open customer
                    </Button>
                  </div>
                ) : (
                  <dl className={styles.snapshotGrid}>
                    <div className={styles.snapshotField}>
                      <dt>Customer</dt>
                      <dd>{existing.data.customerId ?? 'Not recorded'}</dd>
                    </div>
                  </dl>
                )}
              </section>
            ) : null}
            {existing.data ? <PurchaseWorkflowPanel application={existing.data} /> : null}
            {!isNew && existing.data ? <ApplicationRaReview onPrint={printRaDraft} onDownload={downloadRaDraft} value={effectiveRaDraft} onChange={changeRaDraft} defaults={raDefaults} disabled={!editable} /> : null}

            {proposal.data && !isEditRoute ? (
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
                    <dd>{paymentSchemeLabel(proposal.data.terms.paymentScheme)}</dd>
                  </div>
                  <div className={styles.snapshotField}>
                    <dt>Total amount</dt>
                    <dd>{formatMoneyOrDash(proposal.data.terms.totalPrice)}</dd>
                  </div>
                  <div className={styles.snapshotField}>
                    <dt>Reservation amount</dt>
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
                    <dd>{proposal.data.terms.spotCashDays} days</dd>
                  </div>
                  <div className={styles.snapshotField}>
                    <dt>Yearly points</dt>
                    <dd>{formatCountOrDash(proposal.data.terms.yearlyPoints)}</dd>
                  </div>
                  <div className={styles.snapshotField}>
                    <dt>Validity</dt>
                    <dd>{proposal.data.terms.validityMonths} months</dd>
                  </div>
                  <div className={styles.snapshotField}>
                    <dt>Commission</dt>
                    <dd>{formatMoneyOrDash(proposal.data.terms.expectedCommission)}</dd>
                  </div>
                  <div className={styles.snapshotField}>
                    <dt>Offer as of</dt>
                    <dd>{formatDate(proposal.data.asOf)}</dd>
                  </div>
                </dl>
                {proposal.data.offerKind === 'newly_confirmed_offer' ? (
                  <p className={styles.hint}>
                    This record predates stored evidence. Confirming adds your name, time and
                    reason. Figures are not historical terms.
                  </p>
                ) : null}
              </section>
            ) : null}
            <div
              className={isNew ? v4.panel : styles.recordWorkspace}
              role={isNew ? 'group' : undefined}
              aria-label={isNew ? 'Current application step' : undefined}
            >
              {isNew ? (
                <div className={v4.panelHead}>
                  <span className={v4.eyebrow}>
                    {String(activeStep + 1).padStart(2, '0')} / 07 · {steps[activeStep]?.label}
                  </span>
                  <h2>
                    {
                      [
                        'VIP plan & payment',
                        'Identity verification',
                        'Cardholders',
                        'Network & recommender',
                        'Acquisition channel',
                        'Certification',
                        'Review application',
                      ][activeStep]
                    }
                  </h2>
                  <p>
                    {
                      [
                        'Choose the payment arrangement for the selected VIP card.',
                        'Capture the government ID evidence before moving on.',
                        'Enter the holder records, organized into smaller sections.',
                        'Identify the referrer and VIP recommender using AA numbers.',
                        'Record how this customer reached AFhomes.',
                        'Confirm the declarations required before submission.',
                        'Review the complete application before submitting for approval.',
                      ][activeStep]
                    }
                  </p>
                </div>
              ) : null}
              <div className={isNew ? v4.panelBody : undefined}>
                {showForm ? (
                  <fieldset
                    disabled={!editable}
                    className={isNew ? v4.formFields : styles.formRoot}
                  >
                    {!isNew ? planPreview : null}
                    {(!isNew || activeStep === 0) && (
                      <section
                        id="step-application"
                        className={isNew ? v4.stepContent : styles.panel}
                        aria-labelledby="application-panel-heading"
                      >
                        <h2
                          id="application-panel-heading"
                          className={isNew ? v4.sr : styles.panelTitle}
                        >
                          {isNew ? 'VIP plan & payment' : 'Application'}
                        </h2>
                        {!isNew ? (
                          <p className={styles.hint}>Applicant, plan, and payment scheme.</p>
                        ) : null}
                        {importRowId ? (
                          <>
                            <label className={styles.filterLabel}>
                              Purchase reference
                              <input
                                value={importPurchaseReference}
                                maxLength={200}
                                onChange={(e) => setImportPurchaseReference(e.target.value)}
                                readOnly={Boolean(importIntake.data?.purchaseReference)}
                              />
                              <span>
                                Use the actual purchase reference. Reuse the same reference for this
                                purchase; Customer ID (RA No.) identifies the person.
                              </span>
                            </label>
                            <DateField
                              id="import-acknowledgement-date"
                              name="acknowledgedAt"
                              label="Actual acknowledgement date"
                              value={meta.acknowledgedAt}
                              max={today()}
                              onChange={(value) =>
                                setMeta((current) => ({ ...current, acknowledgedAt: value }))
                              }
                              hint="Enter the date the customer actually acknowledged the application."
                            />
                          </>
                        ) : null}
                        <div className={styles.editorGrid}>
                          {!isNew || importRowId ? (
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
                                  <Button
                                    variant="secondary"
                                    onClick={() => void linkedCustomer.refetch()}
                                  >
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
                          ) : null}
                          <div
                            className={isNew ? v4.stepContent : styles.applicationChoices}
                            style={{ gridColumn: '1 / -1' }}
                          >
                            {/* For a new application, plan choice lives in the left
                            preview pane instead (persistent selection + preview
                            together, nothing duplicated on this side). Editing
                            an existing record has no left pane, so it keeps the
                            chooser here. */}
                            {!isNew ? (
                              plans.isPending ? (
                                <p role="status">Loading VIP plans?</p>
                              ) : plans.isError ? (
                                <ErrorState
                                  title="VIP plans could not be loaded"
                                  onRetry={() => void plans.refetch()}
                                />
                              ) : (
                                <ApplicationChoiceCards
                                  required
                                  label="VIP plan *"
                                  value={planId}
                                  options={(plans.data ?? [])
                                    .filter((plan) =>
                                      ['BRONZE', 'SILVER', 'GOLD'].includes(plan.code),
                                    )
                                    .map((plan) => ({
                                      value: plan.id,
                                      label: plan.name,
                                      icon: 'wallet' as const,
                                      description: plan.code,
                                    }))}
                                  onChange={(next) => {
                                    const plan = plans.data?.find((p) => p.id === next);
                                    setPlanId(next);
                                    setTier((plan?.code ?? 'BRONZE') as typeof tier);
                                    if (plan?.code !== 'GOLD') setSecondary(null);
                                  }}
                                />
                              )
                            ) : null}
                            {!isNew &&
                            !plans.isPending &&
                            !plans.isError &&
                            !plans.data?.some((plan) =>
                              ['BRONZE', 'SILVER', 'GOLD'].includes(plan.code),
                            ) ? (
                              <Alert variant="warning">
                                No VIP plans are available. Contact an administrator.
                              </Alert>
                            ) : null}
                            <ApplicationChoiceCards
                              required
                              twoColumn={isNew}
                              label={
                                isNew ? 'Choose how the customer will pay' : 'Payment scheme *'
                              }
                              value={paymentScheme}
                              options={(
                                [
                                  'spot_cash',
                                  'move_a',
                                  'installment_4_month',
                                  'move_b1_40_12',
                                  'move_b2_25_12',
                                ] as const
                              ).map((value) => ({
                                value,
                                label: isNew
                                  ? {
                                      spot_cash: 'Spot Cash',
                                      move_a: 'Move A',
                                      installment_4_month: '4-Month Installment',
                                      move_b1_40_12: 'Move B1',
                                      move_b2_25_12: 'Move B2',
                                    }[value]
                                  : paymentSchemeLabel(value),
                                ariaLabel: paymentSchemeLabel(value),
                                description: isNew
                                  ? {
                                      spot_cash: 'Single-payment arrangement',
                                      move_a: 'Pay over 4 months',
                                      installment_4_month: 'Standard installment schedule',
                                      move_b1_40_12: '40% down payment + 12 months',
                                      move_b2_25_12: '25% down payment + 12 months',
                                    }[value]
                                  : undefined,
                                icon: 'dollar-sign' as const,
                                glyph: isNew ? '\u20b1' : undefined,
                              }))}
                              onChange={(next) => setPaymentScheme(next as typeof paymentScheme)}
                            />
                            {isNew ? (
                              <div className={v4.infobar}>
                                The selected VIP plan stays on the left. The payment scheme is
                                recorded with the application and verified again during approval and
                                purchase terms review.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </section>
                    )}
                    {(!isNew || activeStep === 1) && (
                      <section
                        id="step-identity"
                        className={isNew ? v4.stepContent : styles.panel}
                        aria-labelledby="identity-panel-heading"
                      >
                        <h2
                          id="identity-panel-heading"
                          className={isNew ? v4.sr : styles.panelTitle}
                        >
                          {isNew ? 'Identity verification' : 'Identity'}
                        </h2>
                        {!isNew ? (
                          <p className={styles.hint}>Upload the ID, take a photo, pick its type.</p>
                        ) : null}
                        <fieldset className={isNew ? v4.stepContent : styles.subGroup}>
                          <legend className={isNew ? v4.sr : styles.subGroupTitle}>Valid ID</legend>
                          {isNew ? (
                            <>
                              <ApplicationChoiceCards
                                label="ID Type *"
                                legend="Select a valid government ID"
                                threeColumn
                                required
                                disabled={saveAndSubmit.isPending}
                                value={idType}
                                onChange={(next) => setIdType(next)}
                                options={governmentIdTypeSchema.options.map((value) => ({
                                  value,
                                  label: GOVERNMENT_ID_TYPE_LABELS[value],
                                  icon: GOVERNMENT_ID_TYPE_ICONS[value],
                                  glyph: ['\u25a3', '\u25b1', '\u25a4', '\u25a3', '\u25fb'][
                                    governmentIdTypeSchema.options.indexOf(value)
                                  ],
                                }))}
                              />
                              <hr className={v4.sepline} />
                            </>
                          ) : null}
                          <div
                            className={
                              isNew ? `${v4.grid2} ${v4.identityLayout}` : styles.recordWorkspace
                            }
                          >
                            <div className={isNew ? v4.field : styles.recordWorkspace}>
                              {!isNew ? (
                                <ApplicationChoiceCards
                                  label="ID Type *"
                                  required
                                  compact
                                  disabled={saveAndSubmit.isPending}
                                  value={idType}
                                  onChange={(next) => setIdType(next)}
                                  options={governmentIdTypeSchema.options.map((value) => ({
                                    value,
                                    label: GOVERNMENT_ID_TYPE_LABELS[value],
                                  }))}
                                />
                              ) : null}
                              <TextField
                                id="application-government-id-number"
                                name="governmentIdNumber"
                                label="Government ID number"
                                optional
                                value={idNumber}
                                onChange={(value) => setIdNumber(filterGovernmentIdInput(value))}
                                maxLength={40}
                                disabled={saveAndSubmit.isPending}
                              />
                            </div>
                            <div className={isNew ? v4.uploadCard : styles.recordWorkspace}>
                              {isNew && !idFile && !serverCurrentDocument ? (
                                <div className={`${v4.uploadPreview} ${v4.uploadEmpty}`}>
                                  <span aria-hidden="true">▧</span>
                                  <strong>Government ID</strong>
                                  <small>Preview appears here</small>
                                </div>
                              ) : null}
                              <p className={isNew ? v4.sr : undefined}>
                                <StatusChip
                                  label={
                                    validId
                                      ? 'Valid ID: Uploaded ✓'
                                      : 'Valid ID: Required / Missing'
                                  }
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
                                          serverCurrentDocument.reviewedFields
                                            .idType as GovernmentIdType
                                        ] ?? serverCurrentDocument.reviewedFields.idType)
                                      : 'Missing: choose the type and upload again'}
                                  </p>
                                </>
                              ) : null}
                              {idFile ? (
                                <div role="status" className={styles.idReady}>
                                  <p className={isNew ? v4.sr : styles.hint}>
                                    Ready to upload on save.
                                  </p>
                                  {idPreviewUrl ? (
                                    <button
                                      type="button"
                                      className={isNew ? v4.uploadPreview : styles.thumbnailButton}
                                      onClick={() => setPreviewOpen(true)}
                                      aria-label="Open full ID preview"
                                    >
                                      <img
                                        src={idPreviewUrl}
                                        alt="ID preview thumbnail"
                                        className={isNew ? v4.evidenceImage : styles.thumbnailLarge}
                                      />
                                      <span className={isNew ? v4.sr : styles.thumbnailZoom}>
                                        {idFile.name} · {formatFileSize(idFile.size)} · Click to
                                        enlarge
                                      </span>
                                    </button>
                                  ) : (
                                    <p className={styles.hint}>
                                      {idFile.name} · {formatFileSize(idFile.size)}
                                    </p>
                                  )}
                                </div>
                              ) : null}
                              <div className={isNew ? v4.uploadActions : undefined}>
                                <IdCapturePicker
                                  uploadLabel={isNew ? 'Choose photo / PDF' : undefined}
                                  cancelLabel={isNew ? 'Remove' : undefined}
                                  onFile={setIdFile}
                                  disabled={saveAndSubmit.isPending}
                                  resetVersion={pickerVersion}
                                  showCancel={Boolean(idFile)}
                                  onCancel={() => {
                                    setIdFile(null);
                                    setPickerVersion((version) => version + 1);
                                  }}
                                />
                              </div>
                              {isNew ? (
                                <small className={v4.uploadHint}>
                                  {idFile
                                    ? `${idFile.name} · Ready to upload on save.`
                                    : 'JPG, PNG or PDF. Evidence is uploaded when you save.'}
                                </small>
                              ) : null}
                            </div>
                          </div>
                          <Dialog
                            open={previewOpen && Boolean(idPreviewUrl)}
                            onClose={() => setPreviewOpen(false)}
                            title="ID preview"
                          >
                            {idPreviewUrl ? (
                              <img
                                src={idPreviewUrl}
                                alt="Full ID preview"
                                className={styles.previewImage}
                              />
                            ) : null}
                          </Dialog>
                          {currentDocument.isError ? (
                            <p role="status">
                              Current ID could not be loaded. Retry before saving.
                            </p>
                          ) : null}
                          {isNew ? (
                            <div className={v4.infobar}>
                              Selected evidence is previewed locally and uploaded when the
                              application is saved. A preview does not verify the document.
                            </div>
                          ) : null}
                        </fieldset>
                      </section>
                    )}
                    {(!isNew || activeStep === 2) && (
                      <div id="step-holders" className={isNew ? v4.stepContent : undefined}>
                        {/* The frame's own panelHead already shows "Cardholders" and its
                          subtitle for a new application; the edit-mode record never had
                          a page-level heading here either (HolderFields' own legend
                          names each holder) - so neither mode repeats it. */}
                        <HolderFields
                          key="primary"
                          title="Primary holder"
                          value={primary}
                          onChange={setPrimary}
                          sectioned
                          tabbed={isNew}
                          initialSection={holderSection}
                          section={isNew ? holderSection : undefined}
                          onSectionChange={isNew ? setHolderSection : undefined}
                        />
                        {isNew ? <div className={v4.sepline} /> : null}
                        <div className={isNew ? v4.inlineRow : undefined}>
                          {isNew ? (
                            <div>
                              <strong className={v4.raTitle}>RA number (customer ID)</strong>
                              <p className={v4.helper}>
                                Normally assigned by the server. Manual entry requires an existing
                                company-issued RA number.
                              </p>
                            </div>
                          ) : null}
                          <ApplicationChoiceCards
                            appearance={isNew ? 'inline' : 'tiles'}
                            label="RA Number (Customer ID) mode"
                            value={raNumberMode}
                            options={[
                              {
                                value: 'automatic',
                                label: 'Automatic',
                                description: isNew ? undefined : 'Assigned by the server.',
                              },
                              {
                                value: 'manual',
                                label: 'Manual',
                                description: isNew
                                  ? undefined
                                  : 'Enter an existing company-issued RA number.',
                              },
                            ]}
                            onChange={(next) => {
                              setRaNumberMode(next as typeof raNumberMode);
                              if (next === 'automatic')
                                setPrimary((current) => ({ ...current, raNumber: '' }));
                            }}
                          />
                        </div>
                        {raNumberMode === 'manual' ? (
                          <div style={{ marginTop: 8 }}>
                            <TextField
                              id="app-primary-ra"
                              name="primaryRaNumber"
                              label="RA Number (Customer ID)"
                              value={primary.raNumber ?? ''}
                              onChange={(value) =>
                                setPrimary((current) => ({ ...current, raNumber: value }))
                              }
                            />
                          </div>
                        ) : null}
                        {isNew ? <div className={v4.sepline} /> : null}
                        <label className={isNew ? v4.choiceToggle : styles.checkRow}>
                          <input
                            type="checkbox"
                            checked={Boolean(secondary)}
                            disabled={tier !== 'GOLD'}
                            onChange={(e) => {
                              setSecondary(e.target.checked ? emptyHolder('SECONDARY') : null);
                              if (isNew && e.target.checked) setHolderSection('personal');
                            }}
                          />{' '}
                          Add optional Gold secondary cardholder
                        </label>
                        {isNew ? (
                          <div className={v4.infobar}>
                            Every section belongs to the holder record. The application validates
                            the primary holder and any selected secondary holder before continuing.
                          </div>
                        ) : null}
                        {secondary ? (
                          <HolderFields
                            key="secondary"
                            tabbed={isNew}
                            initialSection={holderSection}
                            section={isNew ? holderSection : undefined}
                            onSectionChange={isNew ? setHolderSection : undefined}
                            sectioned
                            title="Secondary holder (gold optional)"
                            value={secondary}
                            onChange={setSecondary}
                          />
                        ) : null}
                      </div>
                    )}
                    {(!isNew || activeStep === 3) && (
                      <fieldset
                        id="step-recommender"
                        className={isNew ? v4.stepContent : styles.panel}
                      >
                        <legend className={isNew ? v4.sr : styles.panelTitle}>
                          {isNew ? 'Network & recommender' : 'Application and network information'}
                        </legend>
                        {!isNew ? (
                          <p className={styles.hint}>
                            Select the SVD, SSM, SM and Referrer from the existing organization
                            chain, and the VIP recommender separately.
                          </p>
                        ) : null}
                        <div className={isNew ? v4.networkFields : styles.editorGrid}>
                          <RecommenderFields
                            networkSelection={isNew && !importRowId}
                            meta={meta}
                            chainNames={chainNames}
                            onChange={(key, value) =>
                              setMeta((current) => ({ ...current, [key]: value }))
                            }
                            onChain={(next) => setMeta((current) => ({ ...current, ...next }))}
                            onNetworkError={setNetworkTeamError}
                          />
                        </div>
                      </fieldset>
                    )}
                    {(!isNew || activeStep === 4) && (
                      <fieldset id="step-channel" className={isNew ? v4.stepContent : styles.panel}>
                        <legend className={isNew ? v4.sr : styles.panelTitle}>
                          Acquisition channel
                        </legend>
                        <p className={v4.subtle}>
                          Select any applicable acquisition channels. The original application
                          allows multiple selections.
                        </p>
                        <div className={isNew ? v4.chipgrid : undefined}>
                          {[
                            'CMP',
                            'DRP',
                            'GDP Corporate',
                            'Walk-In',
                            'GDP Public Servant',
                            'Referral',
                            'FB Ads',
                          ].map((channel) => (
                            <label
                              key={channel}
                              className={
                                isNew
                                  ? `${v4.chip} ${channels.includes(channel) ? v4.sel : ''}`
                                  : styles.checkRow
                              }
                            >
                              <input
                                type="checkbox"
                                className={isNew ? v4.sr : undefined}
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
                              {isNew ? (
                                <span className={v4.tick} aria-hidden="true">
                                  {channels.includes(channel) ? '✓' : '+'}
                                </span>
                              ) : null}
                            </label>
                          ))}
                        </div>
                        {isNew ? (
                          <div className={v4.infobar}>
                            Optional in the current application workflow. Continue even if no
                            channel is selected.
                          </div>
                        ) : null}
                      </fieldset>
                    )}
                    {(!isNew || activeStep === 5) && (
                      <fieldset id="step-cert" className={isNew ? v4.stepContent : styles.panel}>
                        <legend className={isNew ? v4.sr : styles.panelTitle}>Certification</legend>
                        {isNew ? (
                          <div className={v4.minihead}>
                            <h3>Confirm application details</h3>
                          </div>
                        ) : null}
                        {isNew ? (
                          <div className={`${v4.reviewbox} ${v4.certification}`}>
                            <label className={v4.choiceToggle}>
                              <input
                                type="checkbox"
                                checked={consent}
                                onChange={(e) => setConsent(e.target.checked)}
                              />{' '}
                              I certify the information and consent to verification and processing
                              under RA 10173.
                            </label>
                          </div>
                        ) : (
                          <label className={styles.checkRow}>
                            <input
                              type="checkbox"
                              checked={consent}
                              onChange={(e) => setConsent(e.target.checked)}
                            />{' '}
                            I certify the information and consent to verification and processing
                            under RA 10173.
                          </label>
                        )}
                        <div
                          className={isNew ? `${v4.reviewbox} ${v4.certification}` : undefined}
                          style={isNew ? { marginTop: 13 } : undefined}
                        >
                          {submissionSuccess ? (
                            <p className={styles.hint} style={{ color: 'var(--color-success)' }}>
                              ✓ Valid government ID with specimen signatures received — verified on
                              submission.
                            </p>
                          ) : (
                            <label className={isNew ? v4.choiceToggle : styles.checkRow}>
                              <input
                                type="checkbox"
                                checked={validId}
                                onChange={(e) => setValidId(e.target.checked)}
                              />{' '}
                              Valid government ID with specimen signatures received
                            </label>
                          )}
                          {isNew ? (
                            <p className={v4.helper} style={{ marginLeft: 25 }}>
                              Evidence recorded in Identity:{' '}
                              <b>
                                {idFile?.name ||
                                  serverCurrentDocument?.originalFilename ||
                                  'No file selected'}
                              </b>
                            </p>
                          ) : null}
                        </div>
                        {isNew ? (
                          <div className={v4.infobar}>
                            Certification is part of the application. Signed agreement upload and
                            payment confirmation are not extra fields at this stage.
                          </div>
                        ) : null}
                      </fieldset>
                    )}
                    {isNew && activeStep === 6 ? (
                      <>
                      <h2>Application form review</h2>
                      <ApplicationReview
                        separateRaReview
                        raDraft={effectiveRaDraft}
                        primary={primary}
                        secondary={secondary}
                        planName={plans.data?.find((plan) => plan.id === planId)?.name}
                        plan={selectedPlan}
                        tier={tier}
                        paymentScheme={paymentScheme}
                        idType={idType || serverCurrentDocument?.reviewedFields?.idType || ''}
                        idNumber={idNumber}
                        idFilename={idFile?.name || serverCurrentDocument?.originalFilename}
                        nodes={network.data ?? []}
                        meta={meta}
                        channels={channels}
                        consent={consent}
                        validId={validId}
                        referenceLayout
                        onEdit={goStep}
                      />
                      <ApplicationRaReview onPrint={printRaDraft} onDownload={downloadRaDraft} value={effectiveRaDraft} onChange={changeRaDraft} defaults={raDefaults} />
                      </>
                    ) : null}
                  </fieldset>
                ) : null}
                {blockers.length > 0 &&
                (!isNew ||
                  activeStep === 6 ||
                  !optionalPhonesValid ||
                  Boolean(networkTeamError)) ? (
                  <Alert variant="warning" title="Cannot save and submit yet:">
                    <ul>
                      {blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}
              </div>
              {showForm ? (
                <div className={isNew ? v4.panelFoot : styles.stickyFooter}>
                  <div className={isNew ? v4.footerContents : styles.stickyFooterInner}>
                    {isNew ? (
                      <p className={v4.footnote}>
                        {stepBlockers[activeStep] ??
                          (activeStep === 6
                            ? 'Submission creates a submitted application, not an approved sale.'
                            : activeStep === 2 && nextHolderSection
                              ? `Next: ${nextHolderSectionLabel}`
                              : `Next: ${steps[activeStep + 1]?.label}`)}
                      </p>
                    ) : null}
                    <div className={isNew ? v4.buttons : undefined}>
                      {isNew ? (
                        <Button
                          className={v4.btn}
                          variant="secondary"
                          disabled={activeStep === 0}
                          onClick={() => {
                            if (activeStep === 2 && holderSection !== 'personal') {
                              const previous =
                                HOLDER_SECTIONS[holderSectionIndex - 1] ?? 'personal';
                              setHolderSection(previous);
                              revealStep(`primary-${previous}`);
                            } else goStep(activeStep - 1);
                          }}
                        >
                          Back
                        </Button>
                      ) : null}
                      {isNew && activeStep < steps.length - 1 ? (
                        <Button
                          className={`${v4.btn} ${v4.primary}`}
                          onClick={goNext}
                          disabled={stepBlockers[activeStep] !== null}
                          title={stepBlockers[activeStep] ?? undefined}
                        >
                          Continue <span aria-hidden="true">→</span>
                        </Button>
                      ) : null}
                      {!(isNew && activeStep < steps.length - 1) ? saveAction : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            {hasRecordActions ? (
              <section aria-label="Record actions" className={styles.panel}>
                <div className={styles.recordGroups}>
                  <div className={styles.actions}>
                    <Button
                      onClick={async () => {
                        try {
                          await decide.mutateAsync('approved');
                          const reservations = await getReservationAgreements({
                            application: id!,
                          }).catch((error: unknown) => {
                            setMessage(
                              error instanceof Error
                                ? error.message
                                : 'Reservation status could not be loaded.',
                            );
                            throw error;
                          });
                          if (
                            !reservations.some((reservation) => reservation.status !== 'cancelled')
                          ) {
                            await proposal.refetch();
                            await review.mutateAsync();
                          }
                        } catch {
                          // Each mutation reports its own failure; the reservation lookup reports above.
                        }
                      }}
                      disabled={
                        decide.isPending ||
                        review.isPending ||
                        existing.data?.status !== 'submitted'
                      }
                      loading={
                        (decide.isPending && decidingDecision === 'approved') || review.isPending
                      }
                      loadingLabel="Approving…"
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => decide.mutate('rejected')}
                      disabled={decide.isPending || existing.data?.status !== 'submitted'}
                      loading={decide.isPending && decidingDecision === 'rejected'}
                      loadingLabel="Rejecting…"
                    >
                      Reject
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => reopen.mutate()}
                      disabled={
                        reopen.isPending ||
                        !(
                          existing.data?.status === 'submitted' ||
                          existing.data?.status === 'rejected'
                        )
                      }
                      loading={reopen.isPending}
                      loadingLabel="Reopening…"
                    >
                      Reopen
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </HumanInputValidity.Provider>
  );
}
