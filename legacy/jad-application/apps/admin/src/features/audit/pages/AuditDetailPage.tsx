import { useMemo } from 'react';
import { useParams, Link } from 'react-router';

import { ErrorState, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import { formatMoney } from '@jad/shared';
import type { StatusTone } from '@jad/ui';

import { useAudit } from '../hooks/useAudit';
import { useAdjustments } from '../../adjustments/hooks/useAdjustments';
import { formatDateTime } from '../../../lib/format';
import styles from './AuditDetail.module.css';

const ADJUSTMENT_TYPE_LABEL: Record<string, string> = {
  FINANCIAL_ADJUSTMENT: 'Financial Adjustment',
  COMMISSION_REVERSAL: 'Commission Reversal',
  WITHDRAWAL_REVERSAL: 'Withdrawal Reversal',
};

const ADJUSTMENT_TYPE_TONE: Record<string, StatusTone> = {
  FINANCIAL_ADJUSTMENT: 'info',
  COMMISSION_REVERSAL: 'warning',
  WITHDRAWAL_REVERSAL: 'danger',
};

/** Audit detail - read-only detail view for an audit entry or ledger adjustment. */
export function AuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const {
    data: auditData,
    isPending: auditPending,
    isError: auditError,
    error: auditErr,
  } = useAudit();
  const {
    data: adjData,
    isPending: adjPending,
    isError: adjError,
    error: adjErr,
  } = useAdjustments();

  const isPending = auditPending || adjPending;
  const isError = auditError || adjError;
  const error = auditErr ?? adjErr;

  const record = useMemo(() => {
    if (!id) return null;
    const auditEntry = auditData?.find((r) => r.id === id);
    if (auditEntry) return { kind: 'AUDIT' as const, data: auditEntry };
    const adjEntry = adjData?.find((r) => r.id === id);
    if (adjEntry) return { kind: 'ADJUSTMENT' as const, data: adjEntry };
    return null;
  }, [id, auditData, adjData]);

  return (
    <section>
      <PageHeader
        title="Record Detail"
        description="View audit entry or adjustment details"
        actions={
          <Link className={styles.backLink} to="/admin/audit">
            Back to audit
          </Link>
        }
      />

      {isPending ? (
        <div className={styles.detailGrid}>
          <div className={styles.card}>
            <Skeleton className={styles.skeletonBlock} />
          </div>
        </div>
      ) : isError ? (
        <ErrorState error={error} />
      ) : !record ? (
        <ErrorState title="Record not found" message="The requested record does not exist." />
      ) : (
        <>
          <div className={styles.detailGrid}>
            {record.kind === 'AUDIT' ? (
              <>
                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Audit Entry</h2>
                  <dl className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <dt>Record ID</dt>
                      <dd>
                        <code
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-body-s)',
                            padding: '2px 8px',
                            background: 'var(--color-bg-surface)',
                            border: '1px solid var(--color-border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          {record.data.id}
                        </code>
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Action</dt>
                      <dd>
                        <StatusChip label={record.data.action} tone="neutral" />
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Date & time</dt>
                      <dd>{formatDateTime(record.data.createdAt)}</dd>
                    </div>
                  </dl>
                </div>

                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Actor</h2>
                  <dl className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <dt>Name</dt>
                      <dd style={{ fontWeight: 600 }}>{record.data.actor}</dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Role</dt>
                      <dd>{record.data.actorRole}</dd>
                    </div>
                  </dl>
                </div>

                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Target</h2>
                  <dl className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <dt>Target</dt>
                      <dd style={{ fontWeight: 600 }}>{record.data.targetName}</dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Type</dt>
                      <dd>{record.data.targetType}</dd>
                    </div>
                    <div className={styles.field}>
                      <dt>ID</dt>
                      <dd>
                        <code
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body-s)' }}
                        >
                          {record.data.targetId}
                        </code>
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Detail</dt>
                      <dd>{record.data.detail}</dd>
                    </div>
                  </dl>
                </div>
              </>
            ) : (
              <>
                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Adjustment</h2>
                  <dl className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <dt>Record ID</dt>
                      <dd>
                        <code
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-body-s)',
                            padding: '2px 8px',
                            background: 'var(--color-bg-surface)',
                            border: '1px solid var(--color-border-subtle)',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          {record.data.id}
                        </code>
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Type</dt>
                      <dd>
                        <StatusChip
                          label={
                            ADJUSTMENT_TYPE_LABEL[
                              record.data.entryType as keyof typeof ADJUSTMENT_TYPE_LABEL
                            ] ?? record.data.entryType
                          }
                          tone={
                            ADJUSTMENT_TYPE_TONE[
                              record.data.entryType as keyof typeof ADJUSTMENT_TYPE_TONE
                            ] ?? 'neutral'
                          }
                        />
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Direction</dt>
                      <dd>
                        <StatusChip
                          label={record.data.direction}
                          tone={record.data.direction === 'CREDIT' ? 'success' : 'danger'}
                        />
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Amount</dt>
                      <dd
                        className={
                          record.data.direction === 'CREDIT'
                            ? styles.moneyCredit
                            : styles.moneyDebit
                        }
                      >
                        {formatMoney(record.data.amount)}
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Date & time</dt>
                      <dd>{formatDateTime(record.data.createdAt)}</dd>
                    </div>
                  </dl>
                </div>

                <div className={styles.card}>
                  <h2 className={styles.cardTitle}>Details</h2>
                  <dl className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <dt>Member</dt>
                      <dd style={{ fontWeight: 600 }}>{record.data.memberName}</dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Member ID</dt>
                      <dd>
                        <code
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body-s)' }}
                        >
                          {record.data.memberId}
                        </code>
                      </dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Reason</dt>
                      <dd>{record.data.reason}</dd>
                    </div>
                    <div className={styles.field}>
                      <dt>Created by</dt>
                      <dd>{record.data.createdBy}</dd>
                    </div>
                  </dl>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
