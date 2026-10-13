import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button,
  DateField,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Skeleton,
} from '@afhomes/ui';

import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { downloadExport, exportAudit, getAudit, humanizeReportLabel } from './services';
import styles from './AuditPage.module.css';

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
    // Keep the previous page visible while the next one loads: without this
    // the data gap reads as an empty result during every page turn.
    placeholderData: keepPreviousData,
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

  // First load skeletonizes the whole page - header, filters, and table - so
  // no static content flashes before the data it describes. Refetches keep the
  // previous page visible via placeholderData and never reach this branch.
  if (query.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading audit events"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
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
            busy={query.isFetching && !query.isPending}
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
            <DateField
              id="audit-from"
              name="from"
              label="From"
              optional
              value={from}
              onChange={(value) => {
                setFrom(value);
                resetPage();
              }}
            />
            <DateField
              id="audit-to"
              name="to"
              label="To"
              optional
              value={to}
              onChange={(value) => {
                setTo(value);
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

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !query.data || query.data.data.length === 0 ? (
        <EmptyState title="No audit events" description="Nothing matches these filters." />
      ) : (
        <>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
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
                    <td data-label="Time">{formatDateTime(event.createdAt)}</td>
                    <td
                      data-label="Actor"
                      style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {event.actorName ??
                        (event.actorId ? 'Former staff account' : 'System / public applicant')}
                      {event.actorRole && <small>{event.actorRole}</small>}
                    </td>
                    <td data-label="Action">{humanizeReportLabel(event.action)}</td>
                    <td data-label="Entity">{humanizeReportLabel(event.entityType)}</td>
                    <td data-label="Summary">{event.summary}</td>
                    <td data-label="Details">
                      <Button size="sm" variant="secondary" onClick={() => setOpenId(event.id)}>
                        Metadata
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actionsRow}>
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

      <Dialog
        open={openId !== null && Boolean(query.data)}
        onClose={() => setOpenId(null)}
        title="Event metadata (redacted)"
        footer={
          <Button variant="secondary" onClick={() => setOpenId(null)}>
            Close
          </Button>
        }
      >
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(
            query.data?.data.find((event) => event.id === openId)?.metadata ?? {},
            null,
            2,
          )}
        </pre>
      </Dialog>

      {exportError ? (
        <ErrorState error={new Error(exportError)} onRetry={() => setExportError(null)} />
      ) : null}
    </section>
  );
}
