import { useState } from 'react';
import type { RefObject } from 'react';

import { FormField } from './FormField';
import { fieldStyles } from './fieldStyles';
import styles from './PasswordField.module.css';

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
}

const EYE_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const EYE_OFF_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M4 4l16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path
      d="M9.6 5.9A9.8 9.8 0 0 1 12 5.8c6.5 0 10 6.2 10 6.2a17.6 17.6 0 0 1-3.4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path
      d="M6.2 7.9A17.5 17.5 0 0 0 2 12s3.5 6.2 10 6.2a9.6 9.6 0 0 0 3.4-.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path
      d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Password input with an accessible show/hide toggle (DESIGN-SYSTEM §6.2/§6.7).
 * The toggle is a real 44px button (`aria-pressed` + labelled) that switches
 * the input type; the input keeps `autoComplete` semantics for password
 * managers and `type="password"` by default. Never stores or logs the value.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  optional = false,
  inputRef,
  placeholder,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const describedBy =
    [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <div className={styles.inputWrapper}>
        <input
          ref={inputRef}
          id={id}
          className={`${fieldStyles.input} ${error ? fieldStyles.inputError : ''} ${fieldStyles.inputWithSuffix}`}
          type={visible ? 'text' : 'password'}
          name={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={!optional}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? EYE_OFF_ICON : EYE_ICON}
        </button>
      </div>
    </FormField>
  );
}
