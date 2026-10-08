import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CUSTOMER_CATEGORY_LABELS, customerSellerOptionSchema } from '@afhomes/contracts';
import type { CustomerImportParseResponse } from '@afhomes/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  StatusChip,
  Tabs,
} from '@afhomes/ui';
import { requestList } from '../../lib/api/client';
import { useSession } from '../../lib/session';
import {
  cancelCustomerImport,
  confirmCustomerImport,
  exportCustomers,
  getCustomerImportJobs,
  getCustomerImportTemplate,
  parseCustomerImport,
} from './services';
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

const formatDateTime = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value;
};

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
    queryKey: ['business', 'customer-import-jobs'],
    queryFn: () => getCustomerImportJobs(),
    // Import jobs progress server-side: poll so parse/commit/cancel status
    // advances without reload (mutations still invalidate instantly).
    refetchInterval: 5_000,
  });

  const sellers = useQuery({
    queryKey: ['customer-seller-options'],
    enabled: mayImport,
    queryFn: () => requestList('/customers/filter-options', customerSellerOptionSchema),
  });
  const parse = useMutation({
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
      void client.invalidateQueries({ queryKey: ['business', 'customer-import-jobs'] });
    },
    onError: (error) =>
      say(error instanceof Error ? error.message : 'Import preview failed.', 'danger'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelCustomerImport(id),
    onSuccess: () => {
      say('Job cancelled.', 'success');
      void client.invalidateQueries({ queryKey: ['business', 'customer-import-jobs'] });
    },
    onError: (error) => say(error instanceof Error ? error.message : 'Cancel failed.', 'danger'),
  });

  const confirm = useMutation({
    mutationFn: (jobId: string) => confirmCustomerImport(jobId),
    onSuccess: (result) => {
      setConfirming(false);
      say(
        `Import committed: ${result.committed} written, ${result.failed} failed. Statuses: see job history.`,
        result.failed > 0 ? 'info' : 'success',
      );
      setPreview(null);
      setPreviewPage(0);
      void client.invalidateQueries({ queryKey: ['business', 'customer-import-jobs'] });
      void client.invalidateQueries({ queryKey: ['business', 'customers'] });
      void client.invalidateQueries({ queryKey: ['memberships'] });
      void client.invalidateQueries({ queryKey: ['member-lookup'] });
      void client.invalidateQueries({ queryKey: ['analytics'] });
      void client.invalidateQueries({ queryKey: ['reports'] });
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
  const previewRangeFrom = previewRows.length === 0 ? 0 : safePreviewPage * PREVIEW_PAGE_SIZE + 1;
  const previewRangeTo = Math.min(previewRows.length, (safePreviewPage + 1) * PREVIEW_PAGE_SIZE);

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
            <div className={styles.actions}>
              <Button onClick={() => downloadTemplate('xlsx')}>Download XLSX template</Button>
              <Button variant="secondary" onClick={() => downloadTemplate('csv')}>
                Download CSV template
              </Button>
            </div>
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
                  disabled={parse.isPending || !sheetUrl.trim()}
                  onClick={() => {
                    setChosenFile(null);
                    parse.mutate({ source: 'google_sheets', sheetUrl: sheetUrl.trim() });
                  }}
                >
                  {parse.isPending ? 'Reading…' : 'Read sheet'}
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
                  <StatusChip label={`Total ${preview.job.totalRows}`} tone="neutral" />
                  <StatusChip label={`${preview.job.validRows} valid`} tone="success" />
                  <StatusChip
                    label={`${preview.job.invalidRows} invalid`}
                    tone={preview.job.invalidRows > 0 ? 'danger' : 'neutral'}
                  />
                  <StatusChip label={preview.job.status} />
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
                          <td>{row.rowNumber}</td>
                          <td>
                            {row.fields.first_name} {row.fields.last_name} ({row.fields.email})
                          </td>
                          <td>{row.fields.membership_number || '—'}</td>
                          <td>{row.fields.vip_tier || '—'}</td>
                          <td>{row.fields.source_status || '—'}</td>
                          <td>
                            {typeof row.normalized.category === 'string' &&
                            row.normalized.category in CUSTOMER_CATEGORY_LABELS
                              ? CUSTOMER_CATEGORY_LABELS[
                                  row.normalized.category as keyof typeof CUSTOMER_CATEGORY_LABELS
                                ]
                              : '—'}
                          </td>
                          <td>
                            <StatusChip label={row.action} />
                          </td>
                          <td>{renderRowErrors(row.errors)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previewRows.length > PREVIEW_PAGE_SIZE ? (
                  <nav aria-label="Import preview pagination" className={styles.pagination}>
                    <span role="status" className={styles.paginationRange}>
                      Showing {previewRangeFrom}–{previewRangeTo} of {previewRows.length}
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
                  <label className={styles.filterLabel}>
                    From
                    <input
                      aria-label="From date"
                      type="date"
                      value={filters.from}
                      onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                    />
                  </label>
                  <label className={styles.filterLabel}>
                    To
                    <input
                      aria-label="To date"
                      type="date"
                      value={filters.to}
                      onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                    />
                  </label>
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
              <p role="status">Loading jobs…</p>
            ) : jobs.isError ? (
              <ErrorState error={jobs.error} onRetry={jobs.refetch} />
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
                        <td>{job.jobNumber ?? '—'}</td>
                        <td>{job.sourceName}</td>
                        <td>{job.sourceType}</td>
                        <td>
                          <StatusChip label={job.status} />
                        </td>
                        <td>{job.totalRows}</td>
                        <td>{job.insertedRows}</td>
                        <td>{job.updatedRows}</td>
                        <td>{job.skippedRows}</td>
                        <td>{job.failedRows}</td>
                        <td>{formatDateTime(job.createdAt)}</td>
                        <td>
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
                              disabled={cancel.isPending}
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
