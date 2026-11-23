import { useQuery } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState } from '@afhomes/ui';

import { formatDateTime } from '../../lib/format';
import { CommissionTableSkeleton } from './CommissionSkeletons';
import { sharedScopes } from './queryKeys';
import { getCommissionRuleHistory, type CommissionRuleHistory } from './services';
import styles from './CommissionSettingsPage.module.css';

const show = (value: unknown) =>
  value === null || value === undefined || value === ''
    ? '—'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);

/** Fields an audit event changed, so history reads as a diff instead of raw JSON. */
function ruleChanges(event: Pick<CommissionRuleHistory, 'before' | 'after'>) {
  const before = event.before ?? {};
  const after = event.after ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({
      field: key,
      before: event.before && key in before ? show(before[key]) : null,
      after: event.after && key in after ? show(after[key]) : null,
    }));
}

export function CommissionRuleHistoryDialog({
  ruleId,
  onClose,
}: {
  ruleId: string | null;
  onClose: () => void;
}) {
  const history = useQuery({
    queryKey: sharedScopes.commissionRuleHistory(ruleId),
    queryFn: () => getCommissionRuleHistory(ruleId!),
    enabled: Boolean(ruleId),
  });
  return (
    <Dialog
      open={ruleId !== null}
      onClose={onClose}
      title="Rule history"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close history
        </Button>
      }
    >
      {history.isPending ? (
        <CommissionTableSkeleton label="Loading history" rows={3} />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={history.refetch} />
      ) : history.data?.length ? (
        <ol className={styles.timeline} aria-label="Rule changes">
          {history.data.map((event) => {
            const changes = ruleChanges(event);
            return (
              <li key={event.id} className={styles.event}>
                <div className={styles.eventHead}>
                  <span className={styles.eventAction}>{event.action}</span>
                  <time className={styles.secondary} dateTime={event.createdAt}>
                    {formatDateTime(event.createdAt)}
                  </time>
                </div>
                <p className={styles.secondary}>
                  By <code className={styles.code}>{event.actorId ?? 'System'}</code>
                </p>
                {event.reason ? <p className={styles.eventReason}>{event.reason}</p> : null}
                {changes.length ? (
                  <dl className={styles.changes}>
                    {changes.map((change) => (
                      <div key={change.field}>
                        <dt>{change.field}</dt>
                        <dd>
                          {change.before !== null ? (
                            <span className={styles.before}>
                              <span className="sr-only">Before: </span>
                              {change.before}
                            </span>
                          ) : null}
                          {change.after !== null ? (
                            <span className={styles.after}>
                              <span className="sr-only">After: </span>
                              {change.after}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className={styles.secondary}>No field changes.</p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState title="No history" description="No audit events exist for this rule." />
      )}
    </Dialog>
  );
}
