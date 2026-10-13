import type { SelectHTMLAttributes } from 'react';

import { Icon } from './Icon';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <div className={styles.wrap}>
      <select className={`${styles.select} ${className ?? ''}`} {...rest}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className={styles.chevron} aria-hidden="true" />
    </div>
  );
}
