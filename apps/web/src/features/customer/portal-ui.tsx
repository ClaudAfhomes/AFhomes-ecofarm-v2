import { formatUTCDate } from '@afhomes/shared';

import styles from './portal.module.css';

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

export { styles };
