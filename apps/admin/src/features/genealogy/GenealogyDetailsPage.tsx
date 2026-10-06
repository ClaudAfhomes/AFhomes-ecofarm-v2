import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ErrorState, MetricCard, PageHeader, StatusChip } from '@afhomes/ui';
import { getGenealogyNode, getGenealogySummary, getGenealogyUpline } from './services';
import styles from './GenealogyDetailsPage.module.css';

export function GenealogyDetailsPage() {
  const { staffId = '' } = useParams();
  const node = useQuery({
    queryKey: ['genealogy', staffId],
    queryFn: () => getGenealogyNode(staffId),
  });
  const chain = useQuery({
    queryKey: ['genealogy', staffId, 'upline'],
    queryFn: () => getGenealogyUpline(staffId),
  });
  const summary = useQuery({
    queryKey: ['genealogy', staffId, 'summary'],
    queryFn: () => getGenealogySummary(staffId),
  });
  if (node.isPending) return <p role="status">Loading seller…</p>;
  if (node.isError) return <ErrorState error={node.error} onRetry={node.refetch} />;
  return (
    <section>
      <PageHeader title={node.data.fullName} description={node.data.role.replace(/_/g, ' ')} />
      <StatusChip
        label={node.data.ostStatus ?? node.data.status}
        tone={node.data.status === 'active' ? 'success' : 'neutral'}
      />
      <h2>Upperline chain</h2>
      {chain.isPending ? (
        <p role="status">Loading upperline…</p>
      ) : chain.isError ? (
        <ErrorState error={chain.error} onRetry={chain.refetch} />
      ) : chain.data.length ? (
        <ol className={styles.chain}>
          {chain.data.map((n) => (
            <li key={n.staffId}>
              <Link to={`/admin/genealogy/${n.staffId}`}>{n.fullName}</Link>
              <StatusChip label={n.role.replace(/_/g, ' ')} />
            </li>
          ))}
        </ol>
      ) : (
        <p>Top-level seller</p>
      )}
      <h2>Team summary</h2>
      {summary.isPending ? (
        <p role="status">Loading summary…</p>
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={summary.refetch} />
      ) : (
        <div className={styles.summary}>
          <MetricCard label="Direct downline" value={summary.data.totalDirectDownline} />
          <MetricCard label="Total descendants" value={summary.data.totalDescendants} />
          <MetricCard label="Active sellers" value={summary.data.activeSellerCount} />
          <MetricCard label="Inactive sellers" value={summary.data.inactiveSellerCount} />
        </div>
      )}
    </section>
  );
}
