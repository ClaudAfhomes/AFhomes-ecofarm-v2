import type { ReactNode } from 'react';

import { FormField } from './FormField.js';
import styles from './FormField.module.css';

export interface FileFieldProps {
  id: string;
  name: string;
  label: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  optional?: boolean;
  hint?: string;
  /** Status line under the control, e.g. the chosen file name. */
  status?: ReactNode;
  onSelect: (file: File | null) => void;
}

/**
 * File picker (AFHomes form-field pattern). Native file input with shared
 * styling and label association; the caller renders selection status through
 * `status` so the chosen file is always confirmable.
 */
export function FileField({
  id,
  name,
  label,
  accept,
  multiple = false,
  disabled = false,
  optional = false,
  hint,
  status,
  onSelect,
}: FileFieldProps) {
  return (
    <FormField id={id} label={label} hint={hint} optional={optional}>
      <input
        id={id}
        name={name}
        className={styles.input}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        required={!optional}
        onChange={(event) => onSelect(event.target.files?.[0] ?? null)}
      />
      {status}
    </FormField>
  );
}
