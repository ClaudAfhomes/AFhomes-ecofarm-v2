import type { RefObject } from 'react';

import { FormField } from './FormField';
import { fieldStyles } from './fieldStyles';

export interface DateFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  autoComplete?: string;
  max?: string;
  min?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * Date input for auth forms - native <input type="date"> with modern
 * shadcn-inspired styling (48px, border, focus ring, custom calendar icon).
 * Keeps native picker for a11y/keyboard/mobile while looking consistent
 * with TextField/SelectField (DESIGN-SYSTEM §6.2).
 * If a full shadcn Calendar (Radix + date-fns) is later adopted, this
 * component is the single swap point.
 */
export function DateField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  hint,
  optional = false,
  autoComplete = 'bday',
  max,
  min,
  inputRef,
}: DateFieldProps) {
  const describedBy =
    [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <div className={fieldStyles.dateWrap}>
        <input
          ref={inputRef}
          id={id}
          className={`${fieldStyles.input} ${fieldStyles.dateInput} ${error ? fieldStyles.inputError : ''}`}
          type="date"
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          max={max}
          min={min}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={!optional}
        />
        <span className={fieldStyles.dateIcon} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" aria-hidden="true">
            <rect
              x="2.5"
              y="3.5"
              width="11"
              height="9"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M5 2.5v2M11 2.5v2M2.5 6.5h11"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>
    </FormField>
  );
}
