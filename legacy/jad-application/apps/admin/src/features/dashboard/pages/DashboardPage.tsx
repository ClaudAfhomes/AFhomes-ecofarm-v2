import type { AdminQueues } from '@jad/contracts';
import { EmptyState, ErrorState, Icon, PageHeader, Skeleton, Spinner, StatusChip } from '@jad/ui';
import { Link } from 'react-router';

import { canAccess, findNavItem, ROLE_LABELS } from '../../../app/navigation';
import { useSession } from '../../../lib/session';
import { useAdminQueues } from '../hooks/useAdminQueues';
import { SalesTrendChart } from '../components/SalesTrendChart';
import styles from './DashboardPage.module.css';

const QUEUE_LINKS: {
  to: string;
  label: string;
  key: keyof AdminQueues;
  icon: 'user' | 'check' | 'wallet' | 'list' | 'dollar-sign';
  description: string;
}[] = [
  {
    to: '/admin/registrations',
    label: 'Registrations',
    key: 'registrations',
    icon: 'user',
    description: 'New member applications awaiting review',
  },
  {
    to: '/admin/sales',
    label: 'Sales Request',
    key: 'salesSubmitted',
    icon: 'dollar-sign',
    description: 'Submitted sales awaiting review',
  },
  {
    to: '/admin/withdrawals',
    label: 'Withdrawals',
    key: 'withdrawals',
    icon: 'list',
    description: 'Withdrawal requests to process',
  },
];

/** Total-members stat card - a head-count snapshot, not a pending queue. */
const MEMBER_STAT: {
  to: string;
  label: string;
  key: keyof AdminQueues;
  icon: 'user' | 'check' | 'wallet' | 'list' | 'dollar-sign';
  description: string;
} = {
  to: '/admin/members',
  label: 'Members',
  key: 'members',
  icon: 'user',
  description: 'Total registered members',
};

/** Dashboard queue card - professional SaaS style with icon, count, and navigation. */
function QueueCard({
  to,
  label,
  icon,
  description,
  data,
  stat = false,
}: {
  to: string;
  label: string;
  icon: 'user' | 'check' | 'wallet' | 'list' | 'dollar-sign';
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

/** Dashboard - Sales Overview plus pending-action counts per queue the role may access. */
export function DashboardPage() {
  const { role, user } = useSession();
  const { data, isPending, isError, error, refetch } = useAdminQueues();

  // Sales Overview is gated by the sales module: server-resolved roleModules
  // are authoritative; mock/dev sessions without them fall back to the shell
  // role (admin - which holds sales in the system matrix).
  const salesModuleOk = user?.roleModules ? user.roleModules.includes('sales') : role === 'admin';

  const baseVisible = QUEUE_LINKS.filter((queue) => {
    const item = findNavItem(queue.to);
    return item === undefined || canAccess(role, item);
  });

  const memberItem = findNavItem(MEMBER_STAT.to);
  const memberVisible = memberItem === undefined || canAccess(role, memberItem);

  // Q2: action needed first
  const visible = [...baseVisible].sort((a, b) => (data?.[b.key] ?? 0) - (data?.[a.key] ?? 0));

  const sum = visible.reduce((s, q) => s + (data?.[q.key] ?? 0), 0);
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : null;
  const description =
    !isPending && data && roleLabel
      ? `Welcome back, ${roleLabel} - ${sum} pending`
      : 'Pending action queues for your role';
  const allClear =
    !isPending &&
    !isError &&
    visible.length > 0 &&
    visible.every((q) => (data?.[q.key] ?? 0) === 0);

  return (
    <section>
      <PageHeader title="Dashboard" description={description} />
      {isPending ? (
        <>
          <p className={styles.loadingRow} role="status" aria-live="polite" aria-busy="true">
            <Spinner size="sm" /> Loading queues…
          </p>
          <ul className={styles.queues} aria-hidden="true">
            {memberVisible ? (
              <li key={MEMBER_STAT.to}>
                <Skeleton className={styles.card} />
              </li>
            ) : null}
            {visible.map((queue) => (
              <li key={queue.to}>
                <Skeleton className={styles.card} />
              </li>
            ))}
          </ul>
        </>
      ) : isError ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <ul className={styles.queues}>
            {memberVisible ? (
              <li key={MEMBER_STAT.to}>
                <QueueCard
                  to={MEMBER_STAT.to}
                  label={MEMBER_STAT.label}
                  icon={MEMBER_STAT.icon}
                  description={MEMBER_STAT.description}
                  data={data?.[MEMBER_STAT.key]}
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
                  data={data?.[queue.key]}
                />
              </li>
            ))}
          </ul>
          {allClear ? (
            <EmptyState title="All clear" description="No pending items for your role." />
          ) : null}
        </>
      )}
      {salesModuleOk ? <SalesTrendChart /> : null}
      <p className={styles.timeframe}>As of today</p>
    </section>
  );
}
