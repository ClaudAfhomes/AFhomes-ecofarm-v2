import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, PageHeader } from '@jad/ui';
import { getCmsHistory } from './services';
import styles from './cms.module.css';
export function CmsHistoryPage() {
  const history = useQuery({ queryKey: ['cms', 'history'], queryFn: getCmsHistory });
  if (history.isLoading) return <p role="status">Loading CMS history…</p>;
  if (history.isError)
    return (
      <ErrorState
        title="CMS history could not be loaded"
        error={history.error}
        onRetry={() => void history.refetch()}
      />
    );
  return (
    <>
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
        <div className="table-scroll">
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
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    {item.entityType}: {item.entityId}
                  </td>
                  <td>{item.action}</td>
                  <td>{item.changeSummary}</td>
                  <td>{item.authorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
