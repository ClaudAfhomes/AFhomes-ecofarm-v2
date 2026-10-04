import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Skeleton,
} from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { downloadExport, exportAudit, getAudit, humanizeReportLabel } from './services';

const PAGE_SIZE = 50;

/**
 * Audit Center. Backed by `audit_events`; metadata shown here already passed
 * through the server's recursive redaction, so tokens, hashes, storage paths
 * and OCR text can never render. Requires `governance.audit` (the route guard
 * enforces it; the server re-checks on every request).
 */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const resetPage = useCallback(() => setOffset(0), []);
  const debouncedAction = useDebouncedValue(action, 300, resetPage);
  const debouncedEntityType = useDebouncedValue(entityType, 300, resetPage);

  const filters = {
    ...(debouncedAction ? { action: debouncedAction } : {}),
    ...(debouncedEntityType ? { entityType: debouncedEntityType } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: PAGE_SIZE,
    offset,
  };
  const query = useQuery({
    queryKey: ['audit', debouncedAction, debouncedEntityType, from, to, offset],
    queryFn: () => getAudit(filters),
    refetchInterval: 30_000,
  });

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      downloadExport(await exportAudit({ ...filters, limit: 5000, offset: 0 }, 'csv'));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="Audit Log"
        description="Append-only governance trail. Metadata is redacted server-side before it reaches this screen."
      />

      <FilterBar
        search={
          <SearchField
            label="Action"
            placeholder="e.g. COMMISSION_QUALIFIED"
            value={action}
            onChange={(value) => {
              setAction(value);
            }}
          />
        }
        filters={
          <>
            <SearchField
              label="Entity type"
              placeholder="e.g. card_sale"
              value={entityType}
              onChange={(value) => {
                setEntityType(value);
              }}
            />
            <input
              aria-label="From"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                resetPage();
              }}
            />
            <input
              aria-label="To"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                resetPage();
              }}
            />
          </>
        }
        actions={
          <Button variant="secondary" disabled={exporting} onClick={() => void runExport()}>
            {exporting ? 'Exporting CSV…' : 'Export CSV'}
          </Button>
        }
      />

      {query.isPending ? (
        <div
          style={{ display: 'grid', gap: 'var(--space-3)' }}
          role="status"
          aria-label="Loading audit events"
        >
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data.data.length === 0 ? (
        <EmptyState title="No audit events" description="Nothing matches these filters." />
      ) : (
        <>
          <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Summary</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((event) => (
                  <tr key={String(event.id)}>
                    <td>{formatDateTime(event.createdAt)}</td>
                    <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {event.actorName ??
                        (event.actorId ? 'Former staff account' : 'System / public applicant')}
                      {event.actorRole && <small>{event.actorRole}</small>}
                    </td>
                    <td>{humanizeReportLabel(event.action)}</td>
                    <td>{humanizeReportLabel(event.entityType)}</td>
                    <td>{event.summary}</td>
                    <td>
                      <Button size="sm" variant="secondary" onClick={() => setOpenId(event.id)}>
                        Metadata
                      </Button>
                    </td>
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

      {openId !== null && query.data ? (
        <div style={{ marginTop: 16 }}>
          <h2>Event metadata (redacted)</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(
              query.data.data.find((event) => event.id === openId)?.metadata ?? {},
              null,
              2,
            )}
          </pre>
          <Button variant="secondary" onClick={() => setOpenId(null)}>
            Close
          </Button>
        </div>
      ) : null}

      {exportError ? (
        <ErrorState error={new Error(exportError)} onRetry={() => setExportError(null)} />
      ) : null}
    </section>
  );
}
