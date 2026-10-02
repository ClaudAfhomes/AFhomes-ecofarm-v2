import type { RefObject } from 'react';

import { NormalizedInput } from './NormalizedInput.js';
import { FormField } from './FormField.js';
import styles from './FormField.module.css';

export interface TextFieldProps {
  normalize?: (value: string) => string;
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
  readOnly?: boolean;
}

/**
 * Text/email/tel input (JAD TextField parity). Renders inside `FormField`
 * with shared input styling and `aria-invalid`/`aria-describedby` wiring.
 */
export function TextField({
  normalize,
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
  readOnly = false,
}: TextFieldProps) {
  const describedBy =
    [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <NormalizedInput
        normalize={normalize}
        ref={inputRef}
        id={id}
        className={`${styles.input} ${error ? styles.inputError : ''} ${readOnly ? styles.readOnlyInput : ''}`}
        type={type}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        required={!optional}
      />
    </FormField>
  );
}
