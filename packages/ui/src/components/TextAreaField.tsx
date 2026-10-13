import { FormField } from './FormField.js';
import styles from './FormField.module.css';

export interface TextAreaFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
  error?: string;
  optional?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
}

/**
 * Multi-line text input (AFHomes form-field pattern). Same labels, hints,
 * and error wiring as `TextField`, for notes, descriptions, and summaries.
 */
export function TextAreaField({
  id,
  name,
  label,
  value,
  onChange,
  rows = 3,
  hint,
  error,
  optional = false,
  disabled = false,
  readOnly = false,
  placeholder,
  maxLength,
}: TextAreaFieldProps) {
  const describedBy =
    [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={id}
        name={name}
        className={`${styles.input} ${error ? styles.inputError : ''} ${readOnly ? styles.readOnlyInput : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
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
