import { useQuery } from '@tanstack/react-query';
import { formatCountOrDash } from '@afhomes/shared';
import { MetricCard } from '@afhomes/ui';
import type { IconName } from '@afhomes/ui';

import { formatMoney } from './format';
import { businessKeys } from './queryKeys';
import { getFinanceSummary } from './services-periods';
import styles from './FinanceSummaryCards.module.css';

/**
 * Month figures from the server. Display-only: no card has a matching filter
 * on the queue. Forbidden/failed requests hide the cards entirely so a zero
 * is never shown as if it were real.
 */
export function FinanceSummaryCards() {
  const query = useQuery({
    queryKey: businessKeys.financeSummary('current'),
    queryFn: () => getFinanceSummary(),
    refetchInterval: 15_000,
    retry: false,
  });

  if (query.isError) return null;
  if (query.isPending) {
    return <div className={styles.grid} aria-busy="true" aria-label="Loading month summary" />;
  }
  const s = query.data;
  const cards: { label: string; value: string; sub?: string; icon: IconName }[] = [
    {
      label: 'Pending verification',
      value: formatCountOrDash(s.pendingVerification),
      icon: 'clock',
    },
    {
      label: 'Verified this month',
      icon: 'wallet',
      value: formatMoney(s.verifiedTotal),
      sub: `${formatCountOrDash(s.verifiedCount)} ${s.verifiedCount === 1 ? 'payment' : 'payments'}`,
    },
    {
      label: 'Held for duplicate review',
      value: formatCountOrDash(s.heldForDuplicateReview),
      icon: 'alert',
    },
    {
      label: 'Proposed adjustments',
      value: formatCountOrDash(s.proposedAdjustments),
      icon: 'pencil',
    },
    { label: 'Late postings', value: formatCountOrDash(s.latePostings), icon: 'list' },
  ];
  return (
    <ul className={styles.grid} aria-label="Month summary">
      {cards.map((card) => (
        <li key={card.label} className={styles.card}>
          <MetricCard
            label={card.label}
            value={card.value}
            icon={card.icon}
            description={card.sub}
          />
        </li>
      ))}
    </ul>
  );
}
