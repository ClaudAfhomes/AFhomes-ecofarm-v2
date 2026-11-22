import { formatUTCDate } from '@afhomes/shared';
import { Icon, Skeleton, type IconName, type StatusTone } from '@afhomes/ui';

import { isNotFound } from './http';
import styles from './portal.module.css';
import ui from './customer-ui.module.css';

/**
 * Presentation helpers shared by the customer screens.
 *
 * Dates delegate to the shared UTC formatter: a member seeing an activation
 * or valid-until date reads the same date the server recorded, not a value
 * shifted by the browser's zone.
 */
export function formatDate(value: string | null | undefined): string {
  return formatUTCDate(value);
}

export function Card({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={styles.fieldValue}>{value}</dd>
    </div>
  );
}

export function FieldList({ children }: { children: React.ReactNode }) {
  return <dl className={styles.fieldList}>{children}</dl>;
}

/** `annual_allocation` -> `Annual Allocation`. */
export function humanEntryType(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* Shared customer primitives (additive; see customer-ui.module.css)   */
/* ------------------------------------------------------------------ */

/** Customer-only surface classes: `ui.surface`, `ui.surfaceLink`, `ui.sectionLabel`, ... */
export { ui };

/**
 * Status string -> tone. Values are the existing lifecycle strings (customer,
 * payment, membership, booking, commission); anything else is neutral so an
 * unknown status never reads as good news. Display only: stored values are
 * untouched.
 */
export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'active':
    case 'verified':
    case 'confirmed':
    case 'completed':
    case 'approved':
    case 'earned':
    case 'paid':
      return 'success';
    case 'suspended':
    case 'recorded':
    case 'requested':
    case 'pending':
      return 'warning';
    case 'rejected':
    case 'declined':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `payment_verified` -> `Payment Verified`. Always text, never colour alone. */
export function humanStatus(status: string): string {
  return humanEntryType(status);
}

export interface PortalSectionProps {
  title: string;
  description?: string;
  /** Right-side link or button (e.g. "View all"). */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** Titled block with an h2 and minimal chrome. */
export function PortalSection({ title, description, action, children }: PortalSectionProps) {
  return (
    <section className={ui.section}>
      <div className={ui.sectionHead}>
        <div className={ui.sectionHeading}>
          <h2 className={ui.sectionTitle}>{title}</h2>
          {description ? <p className={ui.sectionDescription}>{description}</p> : null}
        </div>
        {action ? <div className={ui.sectionAction}>{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Semantic list for ledgers and records. Put `ActivityRow`s inside. */
export function ActivityList({
  children,
  label,
}: {
  children: React.ReactNode;
  /** Optional accessible name for the list. */
  label?: string;
}) {
  return (
    <ul className={ui.activityList} aria-label={label}>
      {children}
    </ul>
  );
}

const TILE_TONE: Record<StatusTone, string> = {
  neutral: '',
  success: ui.activityIconSuccess ?? '',
  warning: ui.activityIconWarning ?? '',
  danger: ui.activityIconDanger ?? '',
  info: ui.activityIconInfo ?? '',
};

export interface ActivityRowProps {
  /** Decorative leading icon (aria-hidden). */
  icon: IconName;
  title: React.ReactNode;
  /** Secondary line: date and detail. */
  meta?: React.ReactNode;
  /**
   * Amount magnitude, already formatted by the screen's existing helper
   * (money stays a string). The sign comes from `direction`.
   */
  amount?: string;
  /** `credit` renders "+amount", `debit` renders "-amount", `none` renders it as given. */
  direction?: 'credit' | 'debit' | 'none';
  /** Trailing status, e.g. a StatusChip (always text-labelled). */
  status?: React.ReactNode;
  /** Tints the icon tile only. */
  tone?: StatusTone;
}

/** One ledger/record row. Amount and status stay visible down to 320px. */
export function ActivityRow({
  icon,
  title,
  meta,
  amount,
  direction = 'none',
  status,
  tone = 'neutral',
}: ActivityRowProps) {
  const sign = direction === 'credit' ? '+' : direction === 'debit' ? '−' : '';
  const amountClass =
    direction === 'credit'
      ? `${ui.activityAmount} ${ui.activityAmountPositive}`
      : ui.activityAmount;
  return (
    <li className={ui.activityRow}>
      <span className={`${ui.activityIcon} ${TILE_TONE[tone]}`} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <div className={ui.activityBody}>
        <p className={ui.activityTitle}>{title}</p>
        {meta ? <p className={ui.activityMeta}>{meta}</p> : null}
      </div>
      {amount !== undefined || status ? (
        <div className={ui.activityTrail}>
          {amount !== undefined ? (
            <span className={amountClass}>
              {sign}
              {amount}
            </span>
          ) : null}
          {status}
        </div>
      ) : null}
    </li>
  );
}

/** Loading placeholder matching `ActivityRow` geometry. */
export function ActivityListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading activity">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={ui.skeletonRow}>
          <Skeleton className={ui.skeletonIcon} />
          <div className={ui.skeletonLines}>
            <Skeleton className={ui.skeletonLine} />
            <Skeleton className={ui.skeletonLineShort} />
          </div>
          <Skeleton className={ui.skeletonTrail} />
        </div>
      ))}
    </div>
  );
}

/**
 * True when a read has already answered "404: no active membership" (even while
 * the query client is still retrying it) and nothing is cached. That is a normal
 * state for a member without a card, so screens show it as an explanation at once
 * instead of a spinner or a failure notice. Reads state only; it changes no request.
 */
export function isNoCard(query: { data?: unknown; failureReason: unknown }): boolean {
  return !query.data && isNotFound(query.failureReason);
}

export { styles };
