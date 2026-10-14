import { useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useNavigate } from 'react-router';
import { CUSTOMER_CATEGORY_LABELS, customerSellerOptionSchema } from '@afhomes/contracts';
import type { CustomerImportParseResponse, ImportJobStatus } from '@afhomes/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  Tabs,
} from '@afhomes/ui';
import { requestList } from '../../lib/api/client';
import { formatDateTime } from '../../lib/format';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { formatCountOrDash } from '@afhomes/shared';
import { useSession } from '../../lib/session';
import {
  cancelCustomerImport,
  confirmCustomerImport,
  exportCustomers,
  getCustomerImportJobs,
  getCustomerImportTemplate,
  parseCustomerImport,
} from './services';
import { applicationKeys, businessKeys, sharedScopes } from './queryKeys';
import styles from './CustomerImportExportPage.module.css';

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const downloadFile = (file: { filename: string; mime: string; content: string }) => {
  const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
};

type WorkspaceTab = 'import' | 'export' | 'history';
type FeedbackTone = 'info' | 'success' | 'danger';

/** Preview rows per page. Large files stay navigable instead of one long table. */
const PREVIEW_PAGE_SIZE = 10;

const TAB_BASE_ID = 'customer-import-export';

const JOB_STATUS_TONES: Record<
  ImportJobStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  uploaded: 'warning',
  parsing: 'warning',
  validated: 'info',
  ready: 'info',
  committing: 'warning',
  completed: 'success',
  completed_with_errors: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

/**
 * Actionable job-history load guidance per failure cause. Raw server internals
 * are never rendered; each branch names the next step instead.
 */
function describeJobsLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot view import jobs right now. Contact an administrator.';
  if (error instanceof ApiParseError)
    return 'The saved jobs contain values this screen cannot display. Note the job number and ask an administrator to review the records.';
  return undefined;
}

const renderRowErrors = (errors: CustomerImportParseResponse['rows'][number]['errors']) => {
  if (errors.length === 0) return '✓';
  const shown = errors.slice(0, 2);
  const hidden = errors.length - shown.length;
  const full = errors.map((error) => `${error.field}: ${error.message}`).join('; ');
  return (
    <ul title={full}>
      {shown.map((error, i) => (
        <li key={i}>
          {error.field}: {error.message}
        </li>
      ))}
      {hidden > 0 ? <li className={styles.errorMore}>+{hidden} more</li> : null}
    </ul>
  );
};

/**
 * Bulk customer import/export (Admin-gated).
 *
 * Upload Excel/CSV or a link-readable Google Sheet URL, review the
 * server-validated preview, then confirm: only then are valid rows written,
 * each in its own transaction. Display categories come from the SAME resolver
 * the Customers screen uses; only authoritative statuses and verified payment
 * rows are ever persisted. The server re-checks every permission and value.
 */
export function CustomerImportExportPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { user } = useSession();
  const mayImport =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'governance.customer_import' && permission.canCreate,
    ) === true;
  const [tab, setTab] = useState<WorkspaceTab>('import');
  const [preview, setPreview] = useState<CustomerImportParseResponse | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<FeedbackTone>('info');
  const [sheetUrl, setSheetUrl] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);
  const [chosenFile, setChosenFile] = useState<{ kind: 'excel' | 'csv'; name: string } | null>(
    null,
  );
  const excelInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState({
    category: '',
    tier: '',
    seller: '',
    from: '',
    to: '',
    search: '',
  });

  const say = (text: string, feedback: FeedbackTone = 'info') => {
    setMessage(text);
    setTone(feedback);
  };

  const jobs = useQuery({
    queryKey: businessKeys.customerImportJobs,
    queryFn: () => getCustomerImportJobs(),
    // Import jobs progress server-side: poll so parse/commit/cancel status
    // advances without reload (mutations still invalidate instantly).
    // Previous jobs stay visible during each poll so the list never blanks.
    placeholderData: keepPreviousData,
    refetchInterval: 5_000,
  });

  const sellers = useQuery({
    queryKey: applicationKeys.sellerOptions,
    enabled: mayImport,
    queryFn: () => requestList('/customers/filter-options', customerSellerOptionSchema),
  });
  const parse = useBusinessMutation({
    mutationFn: (input: {
      source: 'excel' | 'csv' | 'google_sheets';
      contentBase64?: string;
      sheetUrl?: string;
      sourceName?: string;
    }) => parseCustomerImport(input),
    onSuccess: (result) => {
      setPreview(result);
      setPreviewPage(0);
      say(
        `Preview ready: ${result.job.validRows} valid, ${result.job.invalidRows} invalid of ${result.job.totalRows} rows. Nothing is written until Confirm Import.`,
        result.job.invalidRows > 0 ? 'info' : 'success',
      );
      void client.invalidateQueries({ queryKey: businessKeys.customerImportJobs });
    },
    onError: (error) =>
      say(error instanceof Error ? error.message : 'Import preview failed.', 'danger'),
  });

  const cancel = useBusinessMutation({
    mutationFn: (id: string) => cancelCustomerImport(id),
    onSuccess: () => {
      say('Job cancelled.', 'success');
      void client.invalidateQueries({ queryKey: businessKeys.customerImportJobs });
    },
    onError: (error) => say(error instanceof Error ? error.message : 'Cancel failed.', 'danger'),
  });

  const confirm = useBusinessMutation({
    mutationFn: (jobId: string) => confirmCustomerImport(jobId),
    onSuccess: (result) => {
      setConfirming(false);
      say(
        `Import committed: ${result.committed} written, ${result.failed} failed. Statuses: see job history.`,
        result.failed > 0 ? 'info' : 'success',
      );
      setPreview(null);
      setPreviewPage(0);
      void client.invalidateQueries({ queryKey: businessKeys.customerImportJobs });
      void client.invalidateQueries({ queryKey: businessKeys.customersScope });
      void client.invalidateQueries({ queryKey: sharedScopes.memberships });
      void client.invalidateQueries({ queryKey: sharedScopes.memberLookup });
      void client.invalidateQueries({ queryKey: sharedScopes.analytics });
      void client.invalidateQueries({ queryKey: sharedScopes.reports });
    },
    onError: (error) => {
      setConfirming(false);
      say(error instanceof Error ? error.message : 'Import commit failed.', 'danger');
    },
  });

  const upload = async (kind: 'excel' | 'csv', file: File) => {
    setMessage('');
    setChosenFile({ kind, name: file.name });
    try {
      const contentBase64 = await toBase64(file);
      parse.mutate({ source: kind, contentBase64, sourceName: file.name });
    } catch (error) {
      say(error instanceof Error ? error.message : 'Could not read the file.', 'danger');
    }
  };

  const downloadTemplate = (format: 'xlsx' | 'csv') => {
    void getCustomerImportTemplate(format)
      .then(downloadFile)
      .catch((error: unknown) =>
        say(error instanceof Error ? error.message : 'Template download failed.', 'danger'),
      );
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    setExporting(format);
    try {
      const file = await exportCustomers(
        format,
        Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      );
      downloadFile(file);
      say(`Export ready: ${file.filename}.`, 'success');
    } catch (error) {
      say(error instanceof Error ? error.message : 'Export failed.', 'danger');
    } finally {
      setExporting(null);
    }
  };

  if (!mayImport)
    return (
      <section className={styles.workspace}>
        <PageHeader
          title="Customer Import / Export"
          description="Bulk customer migration is restricted to authorized Admin accounts."
          actions={
            <Button variant="secondary" onClick={() => navigate('/admin/customers')}>
              Back to customers
            </Button>
          }
        />
        <Alert variant="danger">
          You do not have permission to import customers. Exports are also server-gated.
        </Alert>
      </section>
    );

  const previewRows = preview?.rows ?? [];
  const previewPageCount = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const safePreviewPage = Math.min(previewPage, previewPageCount - 1);
  const previewPageRows = previewRows.slice(
    safePreviewPage * PREVIEW_PAGE_SIZE,
    (safePreviewPage + 1) * PREVIEW_PAGE_SIZE,
  );

  // Tab switcher stays mounted across every state: it is navigation, not data,
  // so an operator can move between tabs while jobs are still loading. The
  // switcher instance never unmounts (no early-return branch around it): a
  // remount between role lookup and click would drop the click on a detached
  // node and leave the tab unchanged. Only the history panel below reads the
  // jobs query; import and export need no data and stay interactive at once.
  // Polling refetches keep previous jobs visible via placeholderData.
  const tabSwitcher = (
    <div className={styles.tabs}>
      <Tabs
        items={[
          { value: 'import', label: 'Import' },
          { value: 'export', label: 'Export' },
          { value: 'history', label: 'Job history' },
        ]}
        value={tab}
        onChange={(next) => setTab(next as WorkspaceTab)}
        baseId={TAB_BASE_ID}
        ariaLabel="Customer import and export sections"
      />
    </div>
  );

  return (
    <section className={styles.workspace}>
      <PageHeader
        title="Customer Import / Export"
        description="Migrate existing customer records from Excel, CSV, or a link-readable Google Sheet. Valid rows are written only after explicit confirmation, one transaction per row."
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/customers')}>
            Back to customers
          </Button>
        }
      />
      <Alert variant="warning" title="Historical data rules">
        Active VIP imports require the actual historical sale total, payment amount, date, method
        and scheme. Reservation and down-payment categories need their historical fee snapshots.
        Only one historical payment per member is supported; use the normal payment workflow for
        multiple payments. Secondary holder imported as legacy reference only.
      </Alert>
      {message ? <Alert variant={tone}>{message}</Alert> : null}

      {tabSwitcher}

      {tab === 'import' ? (
        <div
          id={`${TAB_BASE_ID}-import-panel`}
          role="tabpanel"
          aria-labelledby={`${TAB_BASE_ID}-import-tab`}
        >
          <section className={styles.panel} aria-labelledby={`${TAB_BASE_ID}-template-heading`}>
            <h2 id={`${TAB_BASE_ID}-template-heading`} className={styles.panelTitle}>
              1. Download a template
            </h2>
            <div className={styles.templateGrid}>
              <div className={styles.templateCard}>
                <h3 className={styles.templateName}>Excel workbook (.xlsx)</h3>
                <p className={styles.templateDesc}>
                  Best for filling in Excel: frozen header row, sized columns, and text cells that
                  keep leading zeros on IDs and reference numbers.
                </p>
                <p className={styles.templateMeta}>45 columns · header row only · no sample data</p>
                <div className={styles.actions}>
                  <Button onClick={() => downloadTemplate('xlsx')}>Download XLSX template</Button>
                </div>
              </div>
              <div className={styles.templateCard}>
                <h3 className={styles.templateName}>Plain text (.csv)</h3>
                <p className={styles.templateDesc}>
                  Best for Google Sheets and quick edits: lightweight UTF-8 text with the same 45
                  headers in the same order.
                </p>
                <p className={styles.templateMeta}>45 columns · header row only · no sample data</p>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={() => downloadTemplate('csv')}>
                    Download CSV template
                  </Button>
                </div>
              </div>
            </div>
            <p className={styles.hint}>
              Single 45-column company membership template: primary and supplementary members,
              related persons and referral, package and payment. Unmapped columns are reported as
              ignored warnings on preview; rows still require split first/last names.
            </p>
          </section>

          <section className={styles.panel} aria-labelledby={`${TAB_BASE_ID}-upload-heading`}>
            <h2 id={`${TAB_BASE_ID}-upload-heading`} className={styles.panelTitle}>
              2. Upload and preview (nothing is written yet)
            </h2>
            <div className={styles.fileRow}>
              <div className={styles.filePicker}>
                <input
                  ref={excelInput}
                  hidden
                  aria-label="Import Excel (.xlsx)"
                  type="file"
                  accept=".xlsx"
                  disabled={parse.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload('excel', file);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="secondary"
                  disabled={parse.isPending}
                  onClick={() => excelInput.current?.click()}
                >
                  Choose Excel file
                </Button>
                {chosenFile?.kind === 'excel' ? (
                  <span role="status" className={styles.fileName}>
                    {parse.isPending
                      ? `Reading ${chosenFile.name}…`
                      : `Selected: ${chosenFile.name}`}
                  </span>
                ) : null}
              </div>
              <div className={styles.filePicker}>
                <input
                  ref={csvInput}
                  hidden
                  aria-label="Import CSV (UTF-8)"
                  type="file"
                  accept=".csv"
                  disabled={parse.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload('csv', file);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="secondary"
                  disabled={parse.isPending}
                  onClick={() => csvInput.current?.click()}
                >
                  Choose CSV file
                </Button>
                {chosenFile?.kind === 'csv' ? (
                  <span role="status" className={styles.fileName}>
                    {parse.isPending
                      ? `Reading ${chosenFile.name}…`
                      : `Selected: ${chosenFile.name}`}
                  </span>
                ) : null}
              </div>
              <div className={styles.sheetRow}>
                <label className={styles.sheetField}>
                  Import Google Sheet (link-readable URL)
                  <input
                    value={sheetUrl}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    onChange={(e) => setSheetUrl(e.target.value)}
                    className={styles.sheetInput}
                  />
                </label>
                <Button
                  loading={parse.isPending}
                  loadingLabel="Reading…"
                  disabled={parse.isPending || !sheetUrl.trim()}
                  onClick={() => {
                    setChosenFile(null);
                    parse.mutate({ source: 'google_sheets', sheetUrl: sheetUrl.trim() });
                  }}
                >
                  Read sheet
                </Button>
              </div>
            </div>
            <p className={styles.hint}>
              Private sheets need Google OAuth/service credentials (not configured): only
              link-readable sheets can be imported. No Google secrets belong in browser code.
            </p>
          </section>

          {preview ? (
            <>
              <section className={styles.panel} aria-labelledby={`${TAB_BASE_ID}-review-heading`}>
                <h2 id={`${TAB_BASE_ID}-review-heading`} className={styles.panelTitle}>
                  3. Review preview
                </h2>
                <div role="status" className={styles.summaryChips}>
                  <StatusChip
                    label={`Total ${formatCountOrDash(preview.job.totalRows)}`}
                    tone="neutral"
                  />
                  <StatusChip
                    label={`${formatCountOrDash(preview.job.validRows)} valid`}
                    tone="success"
                  />
                  <StatusChip
                    label={`${formatCountOrDash(preview.job.invalidRows)} invalid`}
                    tone={preview.job.invalidRows > 0 ? 'danger' : 'neutral'}
                  />
                  <StatusChip
                    label={preview.job.status}
                    tone={JOB_STATUS_TONES[preview.job.status]}
                  />
                </div>
                <div
                  role="region"
                  aria-label="Import preview records"
                  tabIndex={0}
                  className={`table-scroll ${styles.tableWrap}`}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Customer</th>
                        <th>Membership #</th>
                        <th>Tier</th>
                        <th>Source status</th>
                        <th>Category</th>
                        <th>Action</th>
                        <th>Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewPageRows.map((row) => (
                        <tr key={row.id}>
                          <td data-label="Row">{formatCountOrDash(row.rowNumber)}</td>
                          <td data-label="Customer">
                            {row.fields.first_name} {row.fields.last_name} ({row.fields.email})
                          </td>
                          <td data-label="Membership #">{row.fields.membership_number || '—'}</td>
                          <td data-label="Tier">{row.fields.vip_tier || '—'}</td>
                          <td data-label="Source status">{row.fields.source_status || '—'}</td>
                          <td data-label="Category">
                            {typeof row.normalized.category === 'string' &&
                            row.normalized.category in CUSTOMER_CATEGORY_LABELS
                              ? CUSTOMER_CATEGORY_LABELS[
                                  row.normalized.category as keyof typeof CUSTOMER_CATEGORY_LABELS
                                ]
                              : '—'}
                          </td>
                          <td data-label="Action">
                            <StatusChip label={row.action} />
                          </td>
                          <td data-label="Errors">{renderRowErrors(row.errors)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previewRows.length > PREVIEW_PAGE_SIZE ? (
                  <div className={styles.pagination}>
                    <Pagination
                      page={safePreviewPage + 1}
                      pageCount={previewPageCount}
                      onChange={(next) => setPreviewPage(next - 1)}
                      label="Import preview pagination"
                    />
                  </div>
                ) : null}
              </section>

              <section className={styles.panel} aria-labelledby={`${TAB_BASE_ID}-confirm-heading`}>
                <h2 id={`${TAB_BASE_ID}-confirm-heading`} className={styles.panelTitle}>
                  4. Confirm import
                </h2>
                {preview.job.validRows === 0 ? (
                  <Alert variant="warning">
                    No valid rows to import. Correct the errors above and upload again before
                    confirming.
                  </Alert>
                ) : null}
                <div className={styles.actions}>
                  <Button
                    loading={confirm.isPending}
                    loadingLabel="Confirming…"
                    disabled={preview.job.validRows === 0}
                    onClick={() => setConfirming(true)}
                  >
                    Confirm Import ({preview.job.validRows} rows)
                  </Button>
                </div>
                <ConfirmDialog
                  open={confirming}
                  onCancel={() => setConfirming(false)}
                  onConfirm={() => confirm.mutate(preview!.job.id)}
                  title="Confirm bulk import"
                  message={`Write ${preview.job.validRows} valid rows to the database, one transaction per row? Invalid rows are skipped, never written.`}
                />
              </section>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'export' ? (
        <div
          id={`${TAB_BASE_ID}-export-panel`}
          role="tabpanel"
          aria-labelledby={`${TAB_BASE_ID}-export-tab`}
        >
          <section className={styles.panel} aria-labelledby={`${TAB_BASE_ID}-export-heading`}>
            <h2 id={`${TAB_BASE_ID}-export-heading`} className={styles.panelTitle}>
              Export customers
            </h2>
            <p className={styles.hint}>
              Exports respect the filters below (max 5000 rows, contact fields included for
              authorized staff).
            </p>
            <FilterBar
              search={
                <SearchField
                  label="Search customers"
                  placeholder="Name, number, or email"
                  value={filters.search}
                  onChange={(value) => setFilters({ ...filters, search: value })}
                />
              }
              filters={
                <>
                  <label className={styles.filterLabel}>
                    Category
                    <Select
                      aria-label="Category"
                      value={filters.category}
                      onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                      options={[
                        { value: '', label: 'All' },
                        ...Object.entries(CUSTOMER_CATEGORY_LABELS).map(([value, label]) => ({
                          value,
                          label,
                        })),
                      ]}
                    />
                  </label>
                  <label className={styles.filterLabel}>
                    Tier
                    <Select
                      aria-label="Tier"
                      value={filters.tier}
                      onChange={(e) => setFilters({ ...filters, tier: e.target.value })}
                      options={[
                        { value: '', label: 'All' },
                        ...['BRONZE', 'SILVER', 'GOLD'].map((tier) => ({
                          value: tier,
                          label: tier,
                        })),
                      ]}
                    />
                  </label>
                  <label className={styles.filterLabel}>
                    Seller
                    <Select
                      aria-label="Seller"
                      value={filters.seller}
                      onChange={(e) => setFilters({ ...filters, seller: e.target.value })}
                      options={[
                        { value: '', label: 'All sellers' },
                        ...(sellers.data?.map((seller) => ({
                          value: seller.id,
                          label: seller.name,
                        })) ?? []),
                      ]}
                    />
                  </label>
                  <DateField
                    id="import-from"
                    name="from"
                    label="From date"
                    optional
                    value={filters.from}
                    onChange={(value) => setFilters({ ...filters, from: value })}
                  />
                  <DateField
                    id="import-to"
                    name="to"
                    label="To date"
                    optional
                    value={filters.to}
                    onChange={(value) => setFilters({ ...filters, to: value })}
                  />
                </>
              }
            />
            <div className={styles.actions}>
              <Button
                loading={exporting === 'xlsx'}
                loadingLabel="Exporting…"
                onClick={() => void runExport('xlsx')}
              >
                Export XLSX
              </Button>
              <Button
                variant="secondary"
                loading={exporting === 'csv'}
                loadingLabel="Exporting…"
                onClick={() => void runExport('csv')}
              >
                Export CSV
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'history' ? (
        <div
          id={`${TAB_BASE_ID}-history-panel`}
          role="tabpanel"
          aria-labelledby={`${TAB_BASE_ID}-history-tab`}
        >
          <section className={styles.panel} aria-labelledby={`${TAB_BASE_ID}-history-heading`}>
            <h2 id={`${TAB_BASE_ID}-history-heading`} className={styles.panelTitle}>
              Import jobs
            </h2>
            {jobs.isPending ? (
              <div
                style={{ display: 'grid', gap: 'var(--space-3)' }}
                role="status"
                aria-label="Loading import jobs"
              >
                <Skeleton style={{ height: 48 }} />
                <Skeleton style={{ height: 48 }} />
                <Skeleton style={{ height: 48 }} />
              </div>
            ) : jobs.isError ? (
              <ErrorState
                error={jobs.error}
                message={describeJobsLoadError(jobs.error)}
                onRetry={jobs.refetch}
              />
            ) : !jobs.data?.length ? (
              <EmptyState
                title="No import jobs"
                description="Parse a file to start the first job."
              />
            ) : (
              <div
                role="region"
                aria-label="Import job records"
                tabIndex={0}
                className={`table-scroll ${styles.tableWrap} ${styles.jobsWrap}`}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Source</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Inserted</th>
                      <th>Updated</th>
                      <th>Skipped</th>
                      <th>Failed / invalid</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.data.map((job) => (
                      <tr key={job.id}>
                        <td data-label="Job">{job.jobNumber ?? '—'}</td>
                        <td data-label="Source">{job.sourceName}</td>
                        <td data-label="Type">{job.sourceType}</td>
                        <td data-label="Status">
                          <StatusChip label={job.status} tone={JOB_STATUS_TONES[job.status]} />
                        </td>
                        <td data-label="Total">{formatCountOrDash(job.totalRows)}</td>
                        <td data-label="Inserted">{formatCountOrDash(job.insertedRows)}</td>
                        <td data-label="Updated">{formatCountOrDash(job.updatedRows)}</td>
                        <td data-label="Skipped">{formatCountOrDash(job.skippedRows)}</td>
                        <td data-label="Failed / invalid">{formatCountOrDash(job.failedRows)}</td>
                        <td data-label="Created">{formatDateTime(job.createdAt)}</td>
                        <td data-label="Actions">
                          {job.status === 'committing' ? (
                            <Button
                              size="sm"
                              loading={confirm.isPending}
                              loadingLabel="Resuming…"
                              onClick={() => confirm.mutate(job.id)}
                            >
                              Resume Import
                            </Button>
                          ) : null}
                          {job.status === 'ready' || job.status === 'validated' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={cancel.isPending}
                              loadingLabel="Cancelling…"
                              onClick={() => cancel.mutate(job.id)}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
