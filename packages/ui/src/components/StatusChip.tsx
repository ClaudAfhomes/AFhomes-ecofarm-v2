import { Icon } from './Icon';
import type { IconName } from './Icon';

import styles from './StatusChip.module.css';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusChipProps {
  label: string;
  tone?: StatusTone;
  icon?: IconName;
}

const TONE_ICON: Record<StatusTone, IconName> = {
  neutral: 'info',
  success: 'check',
  warning: 'clock',
  danger: 'alert',
  info: 'info',
};

/**
 * Compact status indicator. Always conveys state with text + icon + color,
 * never color alone (DESIGN-SYSTEM §1.1). Presentational - the status
 * vocabulary comes from the API/contracts, never invented in the UI.
 */
const STATUS_TONES: Record<string, StatusTone> = {
  active: 'success',
  approved: 'success',
  fully_paid: 'success',
  completed: 'success',
  verified: 'success',
  earned: 'success',
  paid: 'success',
  pending: 'warning',
  partial_payment: 'warning',
  reservation_paid: 'info',
  payment_verified: 'info',
  final_qualification_pending: 'warning',
  rejected: 'danger',
  suspended: 'danger',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
  inactive: 'neutral',
};

export function StatusChip({ label, tone, icon }: StatusChipProps) {
  const resolvedTone = tone ?? STATUS_TONES[label.toLowerCase().replace(/ /g, '_')] ?? 'neutral';
  const displayLabel = label.includes('_')
    ? label.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
    : label;
  return (
    <span className={`${styles.chip} ${styles[resolvedTone]}`}>
      <Icon name={icon ?? TONE_ICON[resolvedTone]} size={14} aria-hidden="true" />
      {displayLabel}
    </span>
  );
}
