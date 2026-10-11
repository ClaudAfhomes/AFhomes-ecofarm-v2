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
 * Canonical stat/metric card (AF Homes queue-card pattern): icon tile + optional
 * status chip in the header, tabular-nums value, label, and description.
 * Presentation only - every figure comes from the caller, never computed.
 */
export function MetricCard({ label, value, description, icon, chip, trend, to }: MetricCardProps) {
  const accessibleLabel = typeof value === 'string' || typeof value === 'number'
    ? `${label}: ${value}`
    : label;
  // Long figures stay on exactly one row: shrink the glyph size as the digit
  // count grows (presentation only — the value itself is untouched), with the
  // CSS nowrap + ellipsis as the final guard for non-text nodes.
  const valueText = typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  const valueLength = valueText?.length ?? 0;
  const countStyle =
    valueLength > 22
      ? { fontSize: '0.95rem' }
      : valueLength > 18
        ? { fontSize: '1.05rem' }
        : valueLength > 14
          ? { fontSize: '1.25rem' }
          : valueLength > 10
            ? { fontSize: '1.5rem' }
            : undefined;
  const body = (
    <>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name={icon ?? 'grid'} size={20} />
        </span>
        {chip ? <StatusChip label={chip.label} tone={chip.tone} /> : null}
      </div>
      <span className={styles.count} style={countStyle} title={valueText ?? undefined}>
        {value}
      </span>
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
