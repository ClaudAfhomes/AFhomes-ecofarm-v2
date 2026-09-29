import type { ReactNode } from 'react';

import styles from './FilterBar.module.css';

export interface FilterBarProps {
  /** Search field (usually a TextField or input with a search icon). */
  search?: ReactNode;
  /** Selects / date inputs / secondary controls. */
  filters?: ReactNode;
  /** Trailing actions (export, create, clear). */
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Canonical filter toolbar (JAD toolbar grammar): one consistent row of
 * search + filters + actions with fixed height, alignment, gaps, and
 * responsive wrapping. Presentation only - state lives in the caller.
 */
export function FilterBar({ search, filters, actions, children }: FilterBarProps) {
  return (
    <div className={styles.bar} role="search">
      {search ? <div className={styles.search}>{search}</div> : null}
      {filters ? <div className={styles.filters}>{filters}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {children}
    </div>
  );
}
