import styles from './portal.module.css';

/**
 * Presentation helpers shared by the customer screens.
 *
 * `formatDate` is deliberately locale-fixed and timezone-free-ish: a member
 * seeing an activation or renewal date should read the same date the server
 * recorded, not a value shifted by the browser's zone. A stored
 * `2026-03-01T00:00:00Z` therefore renders as the UTC calendar date.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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
