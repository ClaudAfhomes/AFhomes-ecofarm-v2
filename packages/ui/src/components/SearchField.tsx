import { Icon } from './Icon.js';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Canonical search input (JAD filter grammar): leading search icon, 44px
 * target, raised surface, brand focus ring. Presentation only - debouncing,
 * apply-on-submit, and pagination resets live in the caller.
 */
export function SearchField({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
}: SearchFieldProps) {
  return (
    <span className={styles.wrap}>
      <input
        id={id}
        type="search"
        aria-label={label}
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <span aria-hidden="true" className={styles.icon}>
        <Icon name="search" size={16} />
      </span>
    </span>
  );
}
