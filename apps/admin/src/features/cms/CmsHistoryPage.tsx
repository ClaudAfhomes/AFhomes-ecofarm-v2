import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@afhomes/ui';
import { getCmsHistory } from './services';
import { formatDateTime } from '../../lib/format';
import styles from './cms.module.css';
export function CmsHistoryPage() {
  const history = useQuery({
    queryKey: ['cms', 'history'],
    queryFn: getCmsHistory,
    // Refetches keep the previous rows visible instead of blanking the table.
    placeholderData: keepPreviousData,
  });
  // First load skeletonizes the whole page - header and table - so no static
  // content flashes before the data it describes. Refetches keep the previous
  // rows visible via placeholderData and never reach this branch.
  if (history.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading CMS history"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );
  if (history.isError)
    return (
      <section className={styles.page}>
        <PageHeader
          title="CMS History"
          description="Immutable content revisions with staff attribution and change summaries."
        />
        <ErrorState
          title="CMS history could not be loaded"
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      </section>
    );
  return (
    <section className={styles.page}>
      <PageHeader
        title="CMS History"
        description="Immutable content revisions with staff attribution and change summaries."
      />
      {!history.data?.length ? (
        <EmptyState
          title="No CMS history yet"
          description="Saving the first draft creates the first revision."
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Content</th>
                <th>Action</th>
                <th>Summary</th>
                <th>Author</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((item) => (
                <tr key={item.id}>
                  <td data-label="When">{formatDateTime(item.createdAt)}</td>
                  <td data-label="Content">
                    {item.entityType}: {item.entityId}
                  </td>
                  <td data-label="Action">{item.action}</td>
                  <td data-label="Summary">{item.changeSummary}</td>
                  <td data-label="Author">{item.authorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
