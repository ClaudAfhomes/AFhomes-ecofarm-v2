import { Link } from 'react-router';
import type { AfHomesModuleKey, DashboardQueues } from '@jad/contracts';
import { EmptyState, ErrorState, Icon, Skeleton, StatusChip } from '@jad/ui';
import type { IconName } from '@jad/ui';

import { canViewModule } from '../../app/navigation';
import { useSession } from '../../lib/session';
import { useAfHomesDashboardQueues } from './useAfHomesDashboardQueues';
import styles from './AfHomesDashboardPage.module.css';

type QueueKey = 'ostMembers' | 'ostApplications' | 'paymentVerification';

interface QueueCardDef {
  to: string;
  label: string;
  key: QueueKey;
  icon: IconName;
  description: string;
  module: AfHomesModuleKey;
  stat?: boolean;
}

/**
 * Dashboard queue cards (JAD QueueCard parity). The OST Members card is a
 * snapshot/stat card - it renders first and never participates in sorting or
 * all-clear logic. Action queues sort highest-pending-first. Withdrawals are
 * deliberately absent: the payout workflow does not exist yet.
 */
export const QUEUE_STAT_CARD: QueueCardDef = {
  to: '/admin/ost/members',
  label: 'OST Members',
  key: 'ostMembers',
  icon: 'user',
  description: 'Total registered OST members',
  module: 'network.ost_members',
  stat: true,
};

export const QUEUE_ACTION_CARDS: QueueCardDef[] = [
  {
    to: '/admin/ost/applications',
    label: 'OST Applications',
    key: 'ostApplications',
    icon: 'user',
    description: 'OST applications awaiting review',
    module: 'network.ost_registrations',
  },
  {
    to: '/admin/finance/payments',
    label: 'Payment Verification',
    key: 'paymentVerification',
    icon: 'dollar-sign',
    description: 'Payments awaiting Finance verification',
    module: 'finance.payment_verification',
  },
];

/** Operational queue card - clickable card with icon, status chip, count, and navigation. */
export function QueueCard({
  to,
  label,
  icon,
  description,
  data,
  stat = false,
}: {
  to: string;
  label: string;
  icon: IconName;
  description: string;
  data: number | undefined;
  stat?: boolean;
}) {
  const count = data ?? 0;
  const hasItems = count > 0;
  return (
    <Link
      className={styles.card}
      to={to}
      aria-label={stat ? `${label}: ${count} total` : `${label}: ${count} pending`}
    >
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>
          <Icon name={icon} size={20} />
        </span>
        {stat ? (
          <StatusChip label="registered" tone="neutral" />
        ) : (
          <StatusChip
            label={hasItems ? 'action needed' : 'clear'}
            tone={hasItems ? 'warning' : 'success'}
          />
        )}
      </div>
      <span className={styles.count}>{count}</span>
      <span className={styles.label}>{label}</span>
      <span className={styles.description}>{description}</span>
    </Link>
  );
}

export function AfHomesQueueCards() {
  const { user } = useSession();
  const { data, isPending, isError, error, refetch } = useAfHomesDashboardQueues();

  const statVisible = canViewModule(user?.afHomesPermissions, QUEUE_STAT_CARD.module);
  const permitted = QUEUE_ACTION_CARDS.filter((queue) =>
    canViewModule(user?.afHomesPermissions, queue.module),
  );

  if (isPending) {
    return (
      <>
        <p className={styles.loadingRow} role="status" aria-live="polite" aria-busy="true">
          Loading queues…
        </p>
        <ul className={styles.queues} aria-hidden="true">
          {statVisible ? (
            <li key={QUEUE_STAT_CARD.to}>
              <Skeleton className={styles.card} />
            </li>
          ) : null}
          {permitted.map((queue) => (
            <li key={queue.to}>
              <Skeleton className={styles.card} />
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const counts: DashboardQueues | undefined = data;
  // A null count is an unauthorized queue: hidden even when the session
  // snapshot still lists the module (the server is authoritative).
  const statCount = statVisible ? (counts?.ostMembers ?? null) : null;
  const visible = permitted
    .filter((queue) => (counts?.[queue.key] ?? null) !== null)
    .sort((a, b) => (counts?.[b.key] ?? 0) - (counts?.[a.key] ?? 0));
  const allClear =
    visible.length > 0 && visible.every((queue) => (counts?.[queue.key] ?? 0) === 0);

  if (statCount === null && visible.length === 0) return null;

  return (
    <>
      <ul className={styles.queues}>
        {statCount !== null ? (
          <li key={QUEUE_STAT_CARD.to}>
            <QueueCard
              to={QUEUE_STAT_CARD.to}
              label={QUEUE_STAT_CARD.label}
              icon={QUEUE_STAT_CARD.icon}
              description={QUEUE_STAT_CARD.description}
              data={statCount}
              stat
            />
          </li>
        ) : null}
        {visible.map((queue) => (
          <li key={queue.to}>
            <QueueCard
              to={queue.to}
              label={queue.label}
              icon={queue.icon}
              description={queue.description}
              data={counts?.[queue.key] ?? 0}
            />
          </li>
        ))}
      </ul>
      {allClear ? (
        <EmptyState title="All clear" description="No pending items for your role." />
      ) : null}
    </>
  );
}
