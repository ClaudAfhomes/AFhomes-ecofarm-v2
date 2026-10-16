import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';

import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { getGenealogyNode, getGenealogySummary, getGenealogyUpline } from './services';
import { humanizeCode } from '../business/format';
import { genealogyKeys } from '../business/queryKeys';
import styles from './GenealogyDetailsPage.module.css';

/**
 * One seller's network record: identity, upline chain, and team summary.
 *
 * Read-only by construction: every figure comes from the authorized genealogy
 * APIs, and nothing here edits attribution. The server remains the security
 * boundary; route guards only decide what is visible.
 */
export function GenealogyDetailsPage() {
  const { staffId = '' } = useParams();
  const navigate = useNavigate();
  const node = useQuery({
    queryKey: genealogyKeys.node(staffId),
    queryFn: () => getGenealogyNode(staffId),
    // A summary refresh elsewhere updates this view without blanking it.
    placeholderData: keepPreviousData,
  });
  const chain = useQuery({
    queryKey: genealogyKeys.upline(staffId),
    queryFn: () => getGenealogyUpline(staffId),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: genealogyKeys.summary(staffId),
    queryFn: () => getGenealogySummary(staffId),
    placeholderData: keepPreviousData,
  });

  // First load skeletonizes the whole page so no static content flashes
  // before the seller it describes. The sr-only line keeps the pending copy.
  if (node.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading seller"
        >
          <span className="sr-only">Loading seller…</span>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 120 }} />
            <Skeleton style={{ height: 120 }} />
          </div>
        </div>
      </section>
    );
  if (node.isError)
    return (
      <section className={styles.page}>
        <PageHeader
          title="Seller Record"
          description="The requested seller could not be opened."
          actions={
            <Button variant="secondary" onClick={() => navigate('/admin/genealogy')}>
              Back to sales network
            </Button>
          }
        />
        <ErrorState
          error={node.error}
          title="Seller could not be loaded"
          message={describeSellerLoadError(node.error)}
          onRetry={() => void node.refetch()}
        />
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Seller Record"
        description={`${node.data.fullName} · ${humanizeCode(node.data.role)}`}
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/genealogy')}>
            Back
          </Button>
        }
      />

      <section className={styles.hero} aria-label="Seller identity">
        <span className={styles.heroAvatar} aria-hidden="true">
          {(node.data.fullName.trim().charAt(0) || '•').toUpperCase()}
        </span>
        <div className={styles.heroText}>
          <div className={styles.heroNameRow}>
            <h2 className={styles.heroName}>{node.data.fullName}</h2>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Role</dt>
              <dd>{humanizeCode(node.data.role)}</dd>
            </div>
            <div>
              <dt>Staff status</dt>
              <dd>
                <StatusChip label={humanizeCode(node.data.status)} />
              </dd>
            </div>
            <div>
              <dt>Direct downline</dt>
              <dd>{formatCountOrDash(node.data.directDownlineCount)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className={styles.panel} aria-label="Head">
        <h2 className={styles.panelTitle}>Head</h2>
        {chain.isPending ? (
          <p role="status">
            <Skeleton style={{ height: 64 }} />
            <span className="sr-only">Loading head…</span>
          </p>
        ) : chain.isError ? (
          <ErrorState
            error={chain.error}
            title="Head could not be loaded"
            message={describeSellerLoadError(chain.error)}
            onRetry={() => void chain.refetch()}
          />
        ) : chain.data.length ? (
          <article className={styles.headCard} aria-label="Immediate head">
            <span className={styles.headAvatar} aria-hidden="true">
              {(chain.data[0]!.fullName.trim().charAt(0) || '•').toUpperCase()}
            </span>
            <div className={styles.headText}>
              <Link to={`/admin/genealogy/${chain.data[0]!.staffId}`} className={styles.headName}>
                {chain.data[0]!.fullName}
              </Link>
              <p className={styles.headMeta}>
                <StatusChip label={humanizeCode(chain.data[0]!.role)} />
                {chain.data.length > 1 ? (
                  <span className={styles.panelNote}> · reads through an unavailable head</span>
                ) : null}
              </p>
            </div>
          </article>
        ) : (
          <p className={styles.panelNote}>Top-level seller</p>
        )}
      </section>

      <section className={styles.panel} aria-label="Team summary">
        <h2 className={styles.panelTitle}>Team summary</h2>
        {summary.isPending ? (
          <p role="status">
            <Skeleton style={{ height: 88 }} />
            <span className="sr-only">Loading summary…</span>
          </p>
        ) : summary.isError ? (
          <ErrorState
            error={summary.error}
            title="Team summary could not be loaded"
            message={describeSellerLoadError(summary.error)}
            onRetry={() => void summary.refetch()}
          />
        ) : summary.data.totalDirectDownline === 0 ? (
          <>
            <div className={styles.badges}>
              <StatusChip
                label={`Direct downline: ${formatCountOrDash(summary.data.totalDirectDownline)}`}
                tone="neutral"
                icon="users"
              />
              <StatusChip
                label={`Active sellers: ${formatCountOrDash(summary.data.activeSellerCount)}`}
                tone="success"
                icon="user-check"
              />
              <StatusChip
                label={`Inactive sellers: ${formatCountOrDash(summary.data.inactiveSellerCount)}`}
                tone="neutral"
                icon="user-x"
              />
            </div>
            <div className={styles.emptyWrap}>
              <EmptyState title="No downline yet" description="New recruits appear here." />
            </div>
          </>
        ) : (
          <>
            <div className={styles.badges}>
              <StatusChip
                label={`Direct downline: ${formatCountOrDash(summary.data.totalDirectDownline)}`}
                tone="neutral"
                icon="users"
              />
              <StatusChip
                label={`Active sellers: ${formatCountOrDash(summary.data.activeSellerCount)}`}
                tone="success"
                icon="user-check"
              />
              <StatusChip
                label={`Inactive sellers: ${formatCountOrDash(summary.data.inactiveSellerCount)}`}
                tone="neutral"
                icon="user-x"
              />
            </div>
            <h3 className={styles.subTitle}>Team mix</h3>
            <ul className={styles.mix}>
              {(
                [
                  'vice_director',
                  'senior_sales_manager',
                  'sales_manager',
                  'ost',
                ] as const
              ).map((role) => (
                <li key={role}>
                  <span>{humanizeCode(role)}</span>
                  <strong>{formatCountOrDash(summary.data.roleCounts[role])}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </section>
  );
}

/**
 * Actionable seller-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeSellerLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open this seller right now. Contact an administrator.';
  return undefined;
}
