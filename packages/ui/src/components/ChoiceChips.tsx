import { useRef, type KeyboardEvent } from 'react';

import type { SelectOption } from './Select.js';
import styles from './ChoiceChips.module.css';

export interface ChoiceChipsProps {
  /** Accessible name of the group (what a dropdown's aria-label would say). */
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * One-click segmented choice for a short closed list (about 2-4 options),
 * used instead of a dropdown so every choice is visible and costs one click.
 * Keyboard: a single tab stop; arrow keys / Home / End move and select
 * (WAI-ARIA radio group pattern). Long lists should stay a `Select`.
 */
export function ChoiceChips({ label, value, options, onChange, disabled = false }: ChoiceChipsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : (enabled[0]?.index ?? 0);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((entry) => entry.index === index);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next =
      event.key === 'Home'
        ? enabled[0]!
        : event.key === 'End'
          ? enabled[enabled.length - 1]!
          : enabled[(at + step + enabled.length) % enabled.length]!;
    onChange(next.option.value);
    refs.current[next.index]?.focus();
  };

  return (
    <div className={styles.group} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            className={styles.chip}
            data-checked={checked || undefined}
            disabled={disabled || option.disabled}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
