import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CUSTOMER_CATEGORY_LABELS, customerSellerOptionSchema } from '@jad/contracts';
import type { CustomerImportParseResponse } from '@jad/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusChip,
} from '@jad/ui';
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
  const { user } = useSession();
  const mayImport =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'governance.customer_import' && permission.canCreate,
    ) === true;
  const [preview, setPreview] = useState<CustomerImportParseResponse | null>(null);
  const [message, setMessage] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [filters, setFilters] = useState({
    category: '',
    tier: '',
    seller: '',
    from: '',
    to: '',
    search: '',
  });

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
      setMessage(
        `Preview ready: ${result.job.validRows} valid, ${result.job.invalidRows} invalid of ${result.job.totalRows} rows. Nothing is written until Confirm Import.`,
      );
      void client.invalidateQueries({ queryKey: ['business', 'customer-import-jobs'] });
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : 'Import preview failed.'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelCustomerImport(id),
    onSuccess: () => {
      setMessage('Job cancelled.');
      void client.invalidateQueries({ queryKey: ['business', 'customer-import-jobs'] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Cancel failed.'),
  });

  const confirm = useMutation({
    mutationFn: (jobId: string) => confirmCustomerImport(jobId),
    onSuccess: (result) => {
      setConfirming(false);
      setMessage(
        `Import committed: ${result.committed} written, ${result.failed} failed. Statuses: see job history.`,
      );
      setPreview(null);
      void client.invalidateQueries({ queryKey: ['business', 'customer-import-jobs'] });
      void client.invalidateQueries({ queryKey: ['business', 'customers'] });
      void client.invalidateQueries({ queryKey: ['memberships'] });
      void client.invalidateQueries({ queryKey: ['member-lookup'] });
      void client.invalidateQueries({ queryKey: ['analytics'] });
      void client.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (error) => {
      setConfirming(false);
      setMessage(error instanceof Error ? error.message : 'Import commit failed.');
    },
  });

  const upload = async (kind: 'excel' | 'csv', file: File) => {
    setMessage('');
    try {
      const contentBase64 = await toBase64(file);
      parse.mutate({ source: kind, contentBase64, sourceName: file.name });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not read the file.');
    }
  };

  if (!mayImport)
    return (
      <section>
        <p>
          Active VIP imports require historical payment data and a historical sale total. One
          historical payment per row is supported; do not consolidate distinct payments into an
          invented transaction. Secondary holder imported as legacy reference only.
        </p>
        <PageHeader
          title="Customer Import / Export"
          description="Bulk customer migration is restricted to authorized Admin accounts."
        />
        <p role="alert">
          You do not have permission to import customers. Exports are also server-gated.
        </p>
        <p>
          <Link to="/admin/customers">Back to customers</Link>
        </p>
      </section>
    );

  return (
    <section>
      <PageHeader
        title="Customer Import / Export"
        description="Migrate existing customer records from Excel, CSV, or a link-readable Google Sheet. Valid rows are written only after explicit confirmation, one transaction per row."
        actions={<Link to="/admin/customers">Back to customers</Link>}
      />
      <p>
        Active VIP imports require the actual historical sale total, payment amount, date, method
        and scheme. Reservation and down-payment categories need their historical fee snapshots.
        Only one historical payment per member is supported; use the normal payment workflow for
        multiple payments. Secondary holder imported as legacy reference only; normalized membership
        holders require a separate design change.
      </p>
      {message ? <Alert variant="info">{message}</Alert> : null}

      <h2>1. Download a template</h2>
      <p>
        <Button onClick={() => void getCustomerImportTemplate('xlsx').then(downloadFile)}>
          Download XLSX template
        </Button>{' '}
        <Button onClick={() => void getCustomerImportTemplate('csv').then(downloadFile)}>
          Download CSV template
        </Button>
      </p>

      <h2>2. Upload and preview (nothing is written yet)</h2>
      <p>
        <label>
          Import Excel (.xlsx){' '}
          <input
            type="file"
            accept=".xlsx"
            disabled={parse.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload('excel', file);
              e.target.value = '';
            }}
          />
        </label>
      </p>
      <p>
        <label>
          Import CSV (UTF-8){' '}
          <input
            type="file"
            accept=".csv"
            disabled={parse.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload('csv', file);
              e.target.value = '';
            }}
          />
        </label>
      </p>
      <p>
        <label>
          Import Google Sheet (link-readable URL){' '}
          <input
            value={sheetUrl}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            onChange={(e) => setSheetUrl(e.target.value)}
            style={{ width: '100%', maxWidth: 480, minWidth: 0 }}
          />
        </label>{' '}
        <Button
          disabled={parse.isPending || !sheetUrl.trim()}
          onClick={() => parse.mutate({ source: 'google_sheets', sheetUrl: sheetUrl.trim() })}
        >
          {parse.isPending ? 'Reading…' : 'Read sheet'}
        </Button>
      </p>
      <p>
        Private sheets need Google OAuth/service credentials (not configured): only link-readable
        sheets can be imported. No Google secrets belong in browser code.
      </p>

      {preview ? (
        <>
          <h2>3. Review preview</h2>
          <p role="status">
            Total {preview.job.totalRows} · valid {preview.job.validRows} · invalid{' '}
            {preview.job.invalidRows} · status {preview.job.status}
          </p>
          <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
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
                {preview.rows.map((row) => (
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
                    <td>
                      {row.errors.length === 0 ? (
                        '✓'
                      ) : (
                        <ul>
                          {row.errors.map((error, i) => (
                            <li key={i}>
                              {error.field}: {error.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>4. Confirm import</h2>
          <p>
            <Button
              disabled={confirm.isPending || preview.job.validRows === 0}
              onClick={() => setConfirming(true)}
            >
              Confirm Import ({preview.job.validRows} rows)
            </Button>
          </p>
          <ConfirmDialog
            open={confirming}
            onCancel={() => setConfirming(false)}
            onConfirm={() => confirm.mutate(preview!.job.id)}
            title="Confirm bulk import"
            message={`Write ${preview.job.validRows} valid rows to the database, one transaction per row? Invalid rows are skipped, never written.`}
          />
        </>
      ) : null}

      <h2>Import jobs</h2>
      {jobs.isPending ? (
        <p role="status">Loading jobs…</p>
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={jobs.refetch} />
      ) : !jobs.data?.length ? (
        <EmptyState title="No import jobs" description="Parse a file to start the first job." />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
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
                  <td>{job.createdAt}</td>
                  <td>
                    {job.status === 'committing' ? (
                      <Button
                        size="sm"
                        disabled={confirm.isPending}
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

      <h2>Export customers</h2>
      <p>
        Exports respect the filters below (max 5000 rows, contact fields included for authorized
        staff).
      </p>
      <div className="form-grid">
        <label>
          Category
          <select
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          >
            <option value="">All</option>
            {Object.entries(CUSTOMER_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tier
          <select
            value={filters.tier}
            onChange={(e) => setFilters({ ...filters, tier: e.target.value })}
          >
            <option value="">All</option>
            {['BRONZE', 'SILVER', 'GOLD'].map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </label>
        <label>
          Seller
          <select
            value={filters.seller}
            onChange={(e) => setFilters({ ...filters, seller: e.target.value })}
          >
            <option value="">All sellers</option>
            {sellers.data?.map((seller) => (
              <option key={seller.id} value={seller.id}>
                {seller.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        <label>
          Search
          <input
            value={filters.search}
            placeholder="Name, number, or email"
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </label>
      </div>
      <p>
        <Button
          onClick={() =>
            void exportCustomers(
              'xlsx',
              Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
            ).then(downloadFile)
          }
        >
          Export XLSX
        </Button>{' '}
        <Button
          onClick={() =>
            void exportCustomers(
              'csv',
              Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
            ).then(downloadFile)
          }
        >
          Export CSV
        </Button>
      </p>
    </section>
  );
}
