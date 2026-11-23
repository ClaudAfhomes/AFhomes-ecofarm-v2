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
  Select,
  Skeleton,
} from '@afhomes/ui';
import type { AuditEvent } from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { downloadExport, exportAudit, getAudit, humanizeReportLabel } from './services';
import styles from './AuditPage.module.css';

const PAGE_SIZE = 50;

/** One row per field that changed: what it was, and what it became. */
export function auditChanges(
  event: Pick<AuditEvent, 'before' | 'metadata'>,
): Array<{ field: string; before: string; after: string }> {
  const before = event.before ?? {};
  const after = event.metadata ?? {};
  const show = (value: unknown) =>
    value === undefined || value === null || value === ''
      ? '—'
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => show(before[key]) !== show(after[key]))
    .map((key) => ({
      field: humanizeReportLabel(key),
      before: show(before[key]),
      after: show(after[key]),
    }));
}

/**
 * Audit Center. Backed by `audit_events`; metadata shown here already passed
 * through the server's recursive redaction, so tokens, hashes, storage paths
 * and OCR text can never render. Requires `governance.audit` (the route guard
 * enforces it; the server re-checks on every request).
 */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [role, setRole] = useState('');
  const [departmentId, setDepartmentId] = useState('');
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
    ...(role ? { role } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: PAGE_SIZE,
    offset,
  };
  const query = useQuery({
    queryKey: ['audit', debouncedAction, debouncedEntityType, role, departmentId, from, to, offset],
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

  const options = query.data?.options;
  const openEvent = query.data?.data.find((event) => event.id === openId);
  const changes = openEvent ? auditChanges(openEvent) : [];
  const activeFilters = [action, entityType, role, departmentId, from, to].filter(Boolean).length;
  const clearFilters = () => {
    setAction('');
    setEntityType('');
    setRole('');
    setDepartmentId('');
    setFrom('');
    setTo('');
    resetPage();
  };
  const actorName = (event: AuditEvent) =>
    event.actorName ??
    (event.actorId ? 'Customer or removed staff account' : 'System / public applicant');

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
        description="Every change made in the system: who did it, their role and department, and what changed. Sensitive values are hidden before they reach this screen."
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
            <Select
              aria-label="Category"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                resetPage();
              }}
              options={[
                { value: '', label: 'All categories' },
                { value: 'ist', label: 'IST (SM / SSM / VD)' },
                ...(options?.roles ?? []).map((r) => ({ value: r.slug, label: r.name })),
              ]}
            />
            <Select
              aria-label="Department"
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                resetPage();
              }}
              options={[
                { value: '', label: 'All departments' },
                ...(options?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
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
      <div className={styles.resultBar} aria-live="polite">
        <span>
          {query.data
            ? `${query.data.meta.total.toLocaleString()} event${query.data.meta.total === 1 ? '' : 's'}`
            : ''}
          {activeFilters > 0
            ? ` · ${activeFilters} filter${activeFilters === 1 ? '' : 's'} applied`
            : ''}
        </span>
        {activeFilters > 0 ? (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

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
                    <td data-label="Actor">
                      <span className={styles.actor}>
                        <span>{actorName(event)}</span>
                        {event.actorRole || event.actorDepartment ? (
                          <small>
                            {[event.actorRole, event.actorDepartment].filter(Boolean).join(' · ')}
                          </small>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="Action">{humanizeReportLabel(event.action)}</td>
                    <td data-label="Entity">{humanizeReportLabel(event.entityType)}</td>
                    <td data-label="Summary">{event.summary}</td>
                    <td data-label="Details">
                      <Button size="sm" variant="secondary" onClick={() => setOpenId(event.id)}>
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actionsRow}>
            <span className={styles.range}>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, query.data.meta.total)} of{' '}
              {query.data.meta.total.toLocaleString()}
            </span>
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
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
        title={openEvent ? humanizeReportLabel(openEvent.action) : 'Event details'}
        footer={
          <Button variant="secondary" onClick={() => setOpenId(null)}>
            Close
          </Button>
        }
      >
        {openEvent ? (
          <div className={styles.detailSection}>
            <dl className={styles.facts}>
              <div>
                <dt>Who</dt>
                <dd>
                  {actorName(openEvent)}
                  {openEvent.actorRole || openEvent.actorDepartment ? (
                    <small>
                      {[openEvent.actorRole, openEvent.actorDepartment].filter(Boolean).join(' · ')}
                    </small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>{formatDateTime(openEvent.createdAt)}</dd>
              </div>
              <div>
                <dt>Record</dt>
                <dd>
                  {humanizeReportLabel(openEvent.entityType)}
                  {openEvent.entityId ? <small>{openEvent.entityId}</small> : null}
                </dd>
              </div>
            </dl>
            <h3 className={styles.changesTitle}>What changed</h3>
            {changes.length === 0 ? (
              <p className={styles.muted}>No field values were recorded for this event.</p>
            ) : (
              <div className={styles.changesWrap}>
                <table aria-label="What changed" className={styles.changes}>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((change) => (
                      <tr key={change.field}>
                        <th scope="row">{change.field}</th>
                        <td data-tone="before">{change.before}</td>
                        <td data-tone="after">{change.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </Dialog>

      {exportError ? (
        <ErrorState error={new Error(exportError)} onRetry={() => setExportError(null)} />
      ) : null}
    </section>
  );
}
