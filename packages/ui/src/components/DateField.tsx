import type { InputHTMLAttributes } from 'react';

import { FormField } from './FormField.js';
import styles from './FormField.module.css';

export interface DateFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  optional?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
}

/**
 * Date input (AFHomes form-field pattern). Renders inside `FormField` with
 * shared input styling and label association, so filter and editor dates read
 * and behave like every other field.
 */
export function DateField({
  id,
  name,
  label,
  value,
  onChange,
  hint,
  optional = false,
  disabled = false,
  min,
  max,
}: DateFieldProps) {
  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    id,
    name,
    type: 'date',
    value,
    onChange: (event) => onChange(event.target.value),
    disabled,
    required: !optional,
  };
  if (min !== undefined) inputProps.min = min;
  if (max !== undefined) inputProps.max = max;
  return (
    <FormField id={id} label={label} hint={hint} optional={optional}>
      <input className={styles.input} {...inputProps} />
    </FormField>
  );
}
