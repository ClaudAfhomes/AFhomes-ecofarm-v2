import { Icon } from './Icon.js';
import { useRef } from 'react';
import { IconButton } from './IconButton.js';
import styles from './SearchField.module.css';

export interface SearchCombobox {
  /** Id of the external listbox this input owns. */
  controlsId: string;
  /** Whether the owned listbox is currently shown. */
  expanded: boolean;
  /** Id of the active option, if any. Announced without moving focus. */
  activeOptionId?: string;
  /** Key handling for the owned list (arrows / Enter / Escape). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export interface SearchFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'md' | 'lg';
  busy?: boolean;
  /**
   * Turns the input into an ARIA 1.2 combobox owning an external suggestion
   * list. Purely additive: without it the input renders exactly as before.
   */
  combobox?: SearchCombobox;
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
  combobox,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className={styles.wrap}>
      <input
        id={id}
        ref={input}
        type="search"
        role={combobox ? 'combobox' : undefined}
        aria-label={label}
        className={`${styles.input} ${size === 'lg' ? styles.large : ''}`}
        aria-busy={busy || undefined}
        aria-expanded={combobox ? combobox.expanded : undefined}
        aria-controls={combobox?.controlsId}
        aria-activedescendant={combobox?.activeOptionId}
        aria-autocomplete={combobox ? 'list' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={combobox?.onKeyDown}
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
