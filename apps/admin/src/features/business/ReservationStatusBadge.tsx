import { Icon } from '@afhomes/ui';
import type { IconName } from '@afhomes/ui';
import type { ReservationAgreementStatus } from '@afhomes/contracts';

import styles from './ReservationStatusBadge.module.css';

/**
 * Reservation lifecycle badge.
 *
 * A dedicated component instead of the shared StatusChip because an IST
 * agreement is a PIPELINE, not a binary state: `draft -> submitted -> executed`
 * is progress through one contract, and `cancelled` leaves that track entirely.
 * A flat chip would render "Draft" and "Submitted" as unrelated words.
 *
 * So the badge carries three agreeing signals: a progress track showing how far
 * the contract has moved, an icon naming the state, and the written label.
 * Meaning never rides on color alone (DESIGN-SYSTEM §1.1), so the state survives
 * grayscale, color-blindness, and a screen reader.
 */
const STAGES: ReservationAgreementStatus[] = ['draft', 'submitted', 'executed'];

const LABEL: Record<ReservationAgreementStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  executed: 'Executed',
  cancelled: 'Cancelled',
};

const ICON: Record<ReservationAgreementStatus, IconName> = {
  draft: 'pencil',
  submitted: 'clock',
  executed: 'check',
  // Cancelled is a void, not a pause: an X, and the only red state here.
  cancelled: 'close',
};

const HINT: Record<ReservationAgreementStatus, string> = {
  draft: 'Not yet submitted for review.',
  submitted: 'Awaiting execution review.',
  executed: 'Contract finalized; Finance owns collection.',
  cancelled: 'Voided before finalization.',
};

export function ReservationStatusBadge({
  status,
  compact = false,
}: {
  status: ReservationAgreementStatus;
  compact?: boolean;
}) {
  const className = `${styles.badge} ${styles[status]} ${compact ? styles.compact : ''}`;
  const icon = <Icon name={ICON[status]} size={12} aria-hidden="true" />;

  if (status === 'cancelled') {
    // No progress track: a cancelled agreement never occupied a stage, so
    // showing an empty track beside a red X would imply unfinished progress.
    return (
      <span className={className} title={HINT.cancelled}>
        {icon}
        <span className={styles.label}>{LABEL.cancelled}</span>
        <span className="sr-only">{HINT.cancelled}</span>
      </span>
    );
  }

  const reached = STAGES.indexOf(status);
  return (
    <span className={className} title={HINT[status]}>
      <span className={styles.track} aria-hidden="true">
        {STAGES.map((stage, index) => (
          <span
            key={stage}
            className={index <= reached ? styles.segmentFilled : styles.segmentEmpty}
          />
        ))}
      </span>
      {icon}
      <span className={styles.label}>{LABEL[status]}</span>
      <span className="sr-only">
        {HINT[status]} Step {reached + 1} of {STAGES.length}.
      </span>
    </span>
  );
}
