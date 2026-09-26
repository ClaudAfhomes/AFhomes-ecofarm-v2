import type { ReactNode } from 'react';

import styles from './FormField.module.css';

export interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Appends "(Optional)" to the label; required is the default. */
  optional?: boolean;
  /** The input control (kept as children so toggles/checkboxes stay flexible). */
  children: ReactNode;
}

/**
 * Form field wrapper: visible label with required/optional marking, inline
 * hint, and inline validation message (UI-UX §9.2/§9.5, DESIGN-SYSTEM §6.2).
 * The consuming control links the error/hint via `aria-describedby`; errors
 * render with `role="alert"` so changes are announced (UI-UX §12.4).
 */
export function FormField({ id, label, hint, error, optional = false, children }: FormFieldProps) {
  return (
    <div className={styles.field}>
      <label
        className={optional ? `${styles.label} ${styles.labelOptional}` : styles.label}
        htmlFor={id}
      >
        {label}
        {optional ? <span className={styles.optionalMark}>(Optional)</span> : null}
      </label>
      {children}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface FieldErrorProps {
  id: string;
  children: ReactNode;
}

/** Inline validation message - announced on appearance via `role="alert"`. */
export function FieldError({ id, children }: FieldErrorProps) {
  return (
    <p id={id} role="alert" className={styles.error}>
      {children}
    </p>
  );
}
