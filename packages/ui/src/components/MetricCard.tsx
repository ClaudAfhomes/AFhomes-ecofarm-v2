import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Icon } from './Icon.js';
import type { IconName } from './Icon.js';
import { StatusChip } from './StatusChip.js';
import type { StatusTone } from './StatusChip.js';
import styles from './MetricCard.module.css';

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** Optional status chip rendered in the card header. */
  chip?: { label: string; tone: StatusTone };
  /** Optional trend line rendered under the description. */
  trend?: ReactNode;
  /** When set, the card renders as a link to this route. */
  to?: string;
}

/**
 * Canonical stat/metric card (JAD QueueCard grammar): icon tile + optional
 * status chip in the header, tabular-nums value, label, and description.
 * Presentation only - every figure comes from the caller, never computed.
 */
export function MetricCard({ label, value, description, icon, chip, trend, to }: MetricCardProps) {
  const accessibleLabel = typeof value === 'string' || typeof value === 'number'
    ? `${label}: ${value}`
    : label;
  const body = (
    <>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name={icon ?? 'grid'} size={20} />
        </span>
        {chip ? <StatusChip label={chip.label} tone={chip.tone} /> : null}
      </div>
      <span className={styles.count}>{value}</span>
      <span className={styles.label}>{label}</span>
      {description ? <span className={styles.description}>{description}</span> : null}
      {trend ? <span className={styles.trend}>{trend}</span> : null}
    </>
  );
  if (to) {
    return (
      <Link className={styles.card} to={to} aria-label={accessibleLabel}>
        {body}
      </Link>
    );
  }
  return (
    <article className={styles.card} aria-label={accessibleLabel}>
      {body}
    </article>
  );
}
