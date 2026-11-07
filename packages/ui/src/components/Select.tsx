import type { SelectHTMLAttributes } from 'react';

import { Icon } from './Icon';
import { Spinner } from './Spinner.js';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  /**
   * Options are still loading. The spinner sits INSIDE the control, where the
   * chevron is, so the control never changes size or layout: a skeleton beside
   * it would shift the form every time a list refetched.
   */
  loading?: boolean;
}

export function Select({ options, className, loading = false, ...rest }: SelectProps) {
  return (
    <div className={styles.wrap} data-loading={loading ? 'true' : undefined}>
      <select
        className={`${styles.select} ${className ?? ''}`}
        aria-busy={loading || undefined}
        {...rest}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* Decorative: `aria-busy` on the control is what a screen reader needs. */}
      {loading ? <Spinner size="sm" className={styles.spinner} /> : null}
      <Icon name="chevron-down" size={16} className={styles.chevron} aria-hidden="true" />
    </div>
  );
}
