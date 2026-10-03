import { Icon } from './Icon.js';
import { useRef } from 'react';
import { IconButton } from './IconButton.js';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'md' | 'lg';
  busy?: boolean;
}

/**
 * Canonical search input: leading search icon, 40/48px
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
  size = 'md',
  busy = false,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className={styles.wrap}>
      <input
        id={id}
        ref={input}
        type="search"
        aria-label={label}
        className={`${styles.input} ${size === 'lg' ? styles.large : ''}`}
        aria-busy={busy || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <span aria-hidden="true" className={styles.icon}>
        <Icon name="search" size={16} />
      </span>
      {value && !disabled ? (
        <span className={styles.clear}>
          <IconButton
            icon="close"
            label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              onChange('');
              input.current?.focus();
            }}
          />
        </span>
      ) : null}
      {busy ? (
        <span className="sr-only" role="status">
          Updating results…
        </span>
      ) : null}
    </span>
  );
}
