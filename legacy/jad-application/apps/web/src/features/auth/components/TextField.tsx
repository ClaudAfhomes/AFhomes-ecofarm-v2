import type { RefObject } from 'react';

import { FormField } from './FormField';
import { fieldStyles } from './fieldStyles';

export interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  type?: 'text' | 'email' | 'tel';
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'numeric' | 'decimal';
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

/**
 * Text/email/tel input for the auth forms. Renders inside `FormField` with the
 * shared input styling, `aria-invalid`/`aria-describedby` wiring, and
 * `autoComplete` semantics (autocomplete attributes for identity fields
 * respecting privacy - NFR-CONF-001, DESIGN-SYSTEM §6.2).
 */
export function TextField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  hint,
  optional = false,
  type = 'text',
  autoComplete,
  inputMode,
  inputRef,
  placeholder,
  maxLength,
  disabled = false,
}: TextFieldProps) {
  const describedBy =
    [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        ref={inputRef}
        id={id}
        className={`${fieldStyles.input} ${error ? fieldStyles.inputError : ''}`}
        type={type}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        required={!optional}
      />
    </FormField>
  );
}
