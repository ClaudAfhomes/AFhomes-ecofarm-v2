import { useId, useState, type ReactNode } from 'react';

import { Icon } from './Icon.js';
import styles from './FilterBar.module.css';

export interface FilterBarProps {
  /** Search field (usually a TextField or input with a search icon). */
  search?: ReactNode;
  /** Selects / date inputs / secondary controls. */
  filters?: ReactNode;
  /** Trailing actions (export, create, clear). */
  actions?: ReactNode;
  children?: ReactNode;
  /**
   * When set, phones collapse `filters` behind a disclosure toggle with this
   * label (e.g. "Expand Filters"). Desktop always shows the filters; pages
   * without this prop render exactly as before.
   */
  filtersToggleLabel?: string;
  /** Open-state label for the disclosure toggle. Defaults to "Collapse Filters". */
  filtersCollapseLabel?: string;
}

/**
 * Canonical filter toolbar (AF Homes toolbar pattern): one consistent row of
 * search + filters + actions with fixed height, alignment, gaps, and
 * responsive wrapping. Presentation only - state lives in the caller.
 */
export function FilterBar({
  search,
  filters,
  actions,
  children,
  filtersToggleLabel,
  filtersCollapseLabel = 'Collapse Filters',
}: FilterBarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const collapsible = filtersToggleLabel !== undefined && filters !== undefined;
  return (
    <div className={styles.bar} role="search">
      {search ? <div className={styles.search}>{search}</div> : null}
      {collapsible ? (
        <button
          type="button"
          className={styles.filtersToggle}
          aria-expanded={filtersOpen}
          aria-controls={filtersId}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          {filtersOpen ? filtersCollapseLabel : filtersToggleLabel}
          <Icon
            name="chevron-down"
            size={16}
            aria-hidden="true"
            className={styles.filtersChevron}
          />
        </button>
      ) : null}
      {filters ? (
        <div
          className={styles.filters}
          id={collapsible ? filtersId : undefined}
          data-collapsible={collapsible || undefined}
          data-open={collapsible ? filtersOpen : undefined}
        >
          {filters}
        </div>
      ) : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {children}
    </div>
  );
}
