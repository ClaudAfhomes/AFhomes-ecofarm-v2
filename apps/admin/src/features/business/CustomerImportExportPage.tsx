import { useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useNavigate } from 'react-router';
import {
  CUSTOMER_CATEGORY_LABELS,
  customerSellerOptionSchema,
  CUSTOMER_WORKBOOK_FIELDS,
  CUSTOMER_WORKBOOK_HEADERS,
  CUSTOMER_WORKBOOK_SHEETS,
} from '@afhomes/contracts';
import type {
  CustomerImportJob,
  CustomerImportParseResponse,
  ImportJobStatus,
} from '@afhomes/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  DateField,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  Tabs,
} from '@afhomes/ui';
import { requestList } from '../../lib/api/client';
import { formatDateTime } from '../../lib/format';
import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { formatCount, formatCountOrDash } from '@afhomes/shared';
import { useSession } from '../../lib/session';
import {
  cancelCustomerImport,
  confirmCustomerImport,
  exportCustomers,
  getCustomerImportJobs,
  getCustomerImportJob,
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
/**
 * The tab's question, answered before the list: how many jobs, how many rows
 * actually landed, and how many rows are still broken. Three figures, because
 * without them an operator has to read every card's count strip to learn
 * whether anything needs their attention at all.
 *
 * Every figure is summed from the jobs on screen - never typed in - and the
 * third is the only one that can take colour, and only when it is not zero.
 */
function JobSummary({ jobs }: { jobs: CustomerImportJob[] }) {
  const written = jobs.reduce((sum, job) => sum + job.insertedRows + job.updatedRows, 0);
  const failed = jobs.reduce((sum, job) => sum + job.failedRows, 0);
  return (
    <dl className={styles.jobSummary} aria-label="Import job summary">
      <div className={styles.jobSummaryCell}>
        <dt>Jobs</dt>
        <dd>{formatCount(jobs.length)}</dd>
      </div>
      <div className={styles.jobSummaryCell}>
        <dt>Rows written</dt>
        <dd>{formatCount(written)}</dd>
      </div>
      <div className={styles.jobSummaryCell} data-alert={failed > 0 ? 'true' : undefined}>
        <dt>Needs attention</dt>
        <dd>{formatCount(failed)}</dd>
      </div>
    </dl>
  );
}

/**
 * One job's row breakdown. These five figures are a decomposition of Total, not
 * five independent columns, so they read as one unit on a shared baseline
 * instead of as the fifth through eleventh column of a table. Failed is the one
 * an operator acts on, so it is the only figure that takes colour.
 */
function JobCounts({ job }: { job: CustomerImportJob }) {
  const counts: Array<[string, number]> = [
    ['Total', job.totalRows],
    ['Inserted', job.insertedRows],
    ['Updated', job.updatedRows],
    ['Skipped', job.skippedRows],
    ['Failed', job.failedRows],
  ];
  return (
    <dl className={styles.jobCounts}>
      {counts.map(([label, value]) => (
        <div
          key={label}
          className={styles.jobCount}
          data-alert={label === 'Failed' && value > 0 ? 'true' : undefined}
        >
          <dt>{label}</dt>
          <dd>{formatCountOrDash(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

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

const workbookFieldLabel = (field: string, rowNumber?: number) => {
  if (rowNumber === undefined) return field;
  for (const sheet of CUSTOMER_WORKBOOK_SHEETS) {
    const column = CUSTOMER_WORKBOOK_FIELDS[sheet]!.indexOf(field);
    if (column >= 0)
      return `${sheet}!${String.fromCharCode(65 + column)}${rowNumber} (${CUSTOMER_WORKBOOK_HEADERS[sheet][column]})`;
  }
  return field;
};
const renderRowErrors = (
  errors: CustomerImportParseResponse['rows'][number]['errors'],
  rowNumber?: number,
) => {
  if (errors.length === 0) return '✓';
  const shown = errors.slice(0, 2);
  const hidden = errors.length - shown.length;
  const full = errors.map((error) => `${error.field}: ${error.message}`).join('; ');
  return (
    <ul title={full}>
      {shown.map((error, i) => (
        <li key={i}>
          {workbookFieldLabel(error.field, rowNumber)}: {error.message}
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
  const mayConfirm =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'governance.customer_import' && permission.canUpdate,
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
  const previewQuery = useQuery({
    queryKey: ['customer-import-preview', preview?.job.id, previewPage],
    queryFn: () =>
      getCustomerImportJob(preview!.job.id, previewPage * PREVIEW_PAGE_SIZE, PREVIEW_PAGE_SIZE),
    enabled: Boolean(preview?.pageSize && previewPage > 0),
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
    mutationFn: async (jobId: string) => {
      let result = await confirmCustomerImport(jobId);
      while (result.job.status === 'committing') {
        say(
          `Importing: ${result.job.insertedRows + result.job.updatedRows + result.job.skippedRows + result.job.failedRows} of ${result.job.totalRows} rows processed.`,
          'info',
        );
        result = await confirmCustomerImport(jobId);
      }
      return result;
    },
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
            <Button variant="secondary" onClick={() => navigate('/admin/customers/applications')}>
              Back to applications
            </Button>
          }
        />
        <Alert variant="danger">
          You do not have permission to import customers. Exports are also server-gated.
        </Alert>
      </section>
    );

  const serverPagination = Boolean(preview?.pageSize);
  const previewRows =
    serverPagination && previewPage > 0 ? (previewQuery.data?.rows ?? []) : (preview?.rows ?? []);
  const previewTotal = preview?.job.totalRows ?? 0;
  const previewPageCount = Math.max(1, Math.ceil(previewTotal / PREVIEW_PAGE_SIZE));
  const safePreviewPage = Math.min(previewPage, previewPageCount - 1);
  const previewPageRows = serverPagination
    ? previewRows
    : previewRows.slice(
        safePreviewPage * PREVIEW_PAGE_SIZE,
        (safePreviewPage + 1) * PREVIEW_PAGE_SIZE,
      );
  const previewRangeFrom = previewRows.length === 0 ? 0 : safePreviewPage * PREVIEW_PAGE_SIZE + 1;
  const previewRangeTo = Math.min(previewTotal, (safePreviewPage + 1) * PREVIEW_PAGE_SIZE);

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
        description="Migrate customer records in bulk."
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/customers/applications')}>
            Back to applications
          </Button>
        }
      />
      <Alert variant="warning" title="Historical data rules">
        History needs real payment facts.
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
                <p className={styles.templateDesc}>Four tabs guide entry. Dropdowns included.</p>
                <div className={styles.actions}>
                  <Button onClick={() => downloadTemplate('xlsx')}>Download XLSX template</Button>
                </div>
              </div>
              <div className={styles.templateCard}>
                <h3 className={styles.templateName}>Plain text (.csv)</h3>
                <p className={styles.templateDesc}>One file. No dropdowns.</p>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={() => downloadTemplate('csv')}>
                    Download CSV template
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby={`${TAB_BASE_ID}-upload-heading`}>
            <h2 id={`${TAB_BASE_ID}-upload-heading`} className={styles.panelTitle}>
              2. Upload and preview
            </h2>
            <div className={styles.fileRow}>
              <div className={styles.filePickers}>
                <div className={styles.filePicker}>
                <input
                  ref={excelInput}
                  hidden
                  aria-label="Import Excel (.xlsx or .xlsm)"
                  type="file"
                  accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
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
            </div>
            <div className={styles.sheetRow}>
                <label className={styles.sheetField}>
                  Import Google Sheet
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
                  {serverPagination && previewPage > 0 && previewQuery.isFetching ? (
                    <p role="status">Loading preview rows…</p>
                  ) : null}
                  {serverPagination && previewPage > 0 && previewQuery.isError ? (
                    <Alert variant="danger">
                      Preview rows could not be loaded.{' '}
                      <Button onClick={() => void previewQuery.refetch()}>Retry</Button>
                    </Alert>
                  ) : null}
                  <table>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Customer</th>
                        <th>Membership #</th>
                        <th>Tier</th>
                        <th>Age</th>
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
                          <td data-label="Age">
                            {row.normalized.person &&
                            typeof row.normalized.person === 'object' &&
                            'age' in row.normalized.person
                              ? String(row.normalized.person.age)
                              : '—'}
                          </td>
                          <td data-label="Source status">
                            {row.fields.stated_status || row.fields.source_status || '—'}
                          </td>
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
                          <td data-label="Errors">
                            {row.customerId ? <span>Customer match: {row.customerId}</span> : null}
                            {renderRowErrors(
                              row.errors,
                              row.fields.workbook_format === 'company_v1'
                                ? row.rowNumber
                                : undefined,
                            )}
                            {row.warnings.length ? (
                              <div>
                                Review:{' '}
                                {renderRowErrors(
                                  row.warnings,
                                  row.fields.workbook_format === 'company_v1'
                                    ? row.rowNumber
                                    : undefined,
                                )}
                              </div>
                            ) : null}
                            {row.fields.workbook_format === 'company_v1' ? (
                              <span>
                                {row.action === 'CREATE'
                                  ? 'Create customer identity and preserve application details; no financial changes.'
                                  : row.action === 'SKIP'
                                    ? 'Unchanged import; no changes.'
                                    : 'Manual review required; existing records will be preserved.'}
                              </span>
                            ) : null}
                            {row.customerId && row.action === 'CONFLICT' ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => navigate(`/admin/customers/${row.customerId}`)}
                              >
                                Review existing customer
                              </Button>
                            ) : null}
                            {row.fields.workbook_format === 'company_v1' ? (
                              <details>
                                <summary>Review mapped fields</summary>
                                <dl>
                                  {Object.values(CUSTOMER_WORKBOOK_FIELDS)
                                    .flat()
                                    .filter((field) => row.fields[field])
                                    .map((field) => (
                                      <div key={field}>
                                        <dt>{workbookFieldLabel(field, row.rowNumber)}</dt>
                                        <dd>
                                          {['tin', 'secondary_tin'].includes(field)
                                            ? 'Provided (restricted)'
                                            : row.fields[field]}
                                        </dd>
                                      </div>
                                    ))}
                                </dl>
                              </details>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previewTotal > PREVIEW_PAGE_SIZE ? (
                  <nav aria-label="Import preview pagination" className={styles.pagination}>
                    <span role="status" className={styles.paginationRange}>
                      Showing {previewRangeFrom}-{previewRangeTo} of {previewTotal}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={safePreviewPage === 0}
                      onClick={() => setPreviewPage(Math.max(0, safePreviewPage - 1))}
                      aria-label="Previous preview page"
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={safePreviewPage >= previewPageCount - 1}
                      onClick={() =>
                        setPreviewPage(Math.min(previewPageCount - 1, safePreviewPage + 1))
                      }
                      aria-label="Next preview page"
                    >
                      Next
                    </Button>
                  </nav>
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
                    disabled={!mayConfirm || preview.job.validRows === 0}
                    onClick={() => setConfirming(true)}
                  >
                    Confirm Import ({preview.job.validRows} rows)
                  </Button>
                </div>
                <ConfirmDialog
                  open={confirming}
                  confirmDisabled={!mayConfirm || confirm.isPending}
                  confirmLoading={confirm.isPending}
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
              <>
                <JobSummary jobs={jobs.data} />
                <div className={styles.jobList}>
                  {jobs.data.map((job) => (
                    <article key={job.id} className={styles.jobCard}>
                      <header className={styles.jobHead}>
                        <StatusChip label={job.status} tone={JOB_STATUS_TONES[job.status]} />
                        <span className={styles.jobName} title={job.sourceName}>
                          {job.sourceName}
                        </span>
                        <span className={styles.jobWhen}>{formatDateTime(job.createdAt)}</span>
                      </header>
                      <p className={styles.jobMeta}>
                        <span>{job.sourceType}</span>
                        {job.jobNumber ? (
                          <span className={styles.jobRef}>{job.jobNumber}</span>
                        ) : null}
                      </p>
                      <JobCounts job={job} />
                      {job.status === 'committing' && mayConfirm ? (
                        <div className={styles.jobActions}>
                          <Button
                            size="sm"
                            loading={confirm.isPending}
                            loadingLabel="Resuming…"
                            onClick={() => confirm.mutate(job.id)}
                          >
                            Resume Import
                          </Button>
                        </div>
                      ) : null}
                      {mayConfirm && (job.status === 'ready' || job.status === 'validated') ? (
                        <div className={styles.jobActions}>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={cancel.isPending}
                            loadingLabel="Cancelling…"
                            onClick={() => cancel.mutate(job.id)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
