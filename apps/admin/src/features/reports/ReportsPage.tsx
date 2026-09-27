import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, PageHeader } from '@jad/ui';

import { useSession } from '../../lib/session';
import { REPORT_DEFS, availableReports } from './reports';
import { downloadExport, exportReport, formatCell, getReport } from './services';

const PAGE_SIZE = 50;

/**
 * Role-scoped reports. The selector only offers reports the session's
 * permissions allow (UX only); every table, total, and export below is the
 * server's scoped answer, paginated server-side.
 */
export function ReportsPage() {
  const { user } = useSession();
  const defs = availableReports(user?.afHomesPermissions);
  const [type, setType] = useState(defs[0]?.type ?? 'sales');
  const def = REPORT_DEFS.find((d) => d.type === type) ?? REPORT_DEFS[0]!;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(status ? { status } : {}),
    ...(type === 'ost' && kind ? { kind } : {}),
    ...(search ? { search } : {}),
    limit: PAGE_SIZE,
    offset,
  };
  const query = useQuery({
    queryKey: ['reports', type, from, to, status, kind, search, offset],
    queryFn: () => getReport(type, filters),
  });

  const runExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(format);
    setExportError(null);
    try {
      const envelope = await exportReport(type, { ...filters, limit: 5000, offset: 0 }, format);
      downloadExport(envelope);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const resetPage = () => setOffset(0);

  return (
    <section>
      <PageHeader
        title="Reports"
        description="Role-scoped operational reports. Every figure is computed server-side from your authorized scope."
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <label>
          Report
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              resetPage();
            }}
          >
            {defs.map((d) => (
              <option key={d.type} value={d.type}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPage();
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPage();
            }}
          />
        </label>
        <label>
          Status
          <input
            value={status}
            placeholder="exact status"
            onChange={(e) => {
              setStatus(e.target.value);
              resetPage();
            }}
          />
        </label>
        {type === 'ost' ? (
          <label>
            Kind
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                resetPage();
              }}
            >
              <option value="">Applications</option>
              <option value="members">Members</option>
            </select>
          </label>
        ) : null}
        <label>
          Search
          <input
            value={search}
            placeholder="name / number"
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          />
        </label>
      </div>

      <p style={{ opacity: 0.8 }}>{def.description}</p>

      {query.isPending ? (
        <p role="status">Loading report…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          title="No rows in scope"
          description="Nothing matches these filters within your authorized scope."
        />
      ) : (
        <>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {Object.entries(query.data.summary).map(([key, value]) => (
              <div key={key}>
                <dt style={{ opacity: 0.7 }}>{key}</dt>
                <dd>
                  <strong>
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </strong>
                </dd>
              </div>
            ))}
          </dl>
          <p style={{ opacity: 0.8 }}>
            Scope: {query.data.scope.label} · {query.data.meta.total} rows
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {def.columns.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((row, i) => (
                  <tr key={i}>
                    {def.columns.map((col) => (
                      <td key={col.key}>
                        {formatCell(col.key, (row as Record<string, unknown>)[col.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <span>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, query.data.meta.total)} of{' '}
              {query.data.meta.total}
            </span>
            <Button
              variant="secondary"
              disabled={offset + PAGE_SIZE >= query.data.meta.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
          <Button
            key={format}
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void runExport(format)}
          >
            {exporting === format
              ? `Exporting ${format.toUpperCase()}…`
              : `Export ${format.toUpperCase()}`}
          </Button>
        ))}
      </div>
      {exportError ? (
        <ErrorState error={new Error(exportError)} onRetry={() => setExportError(null)} />
      ) : null}
    </section>
  );
}
