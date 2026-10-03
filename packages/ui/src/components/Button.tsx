import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Spinner } from './Spinner.js';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Shared by native actions and navigation links that look like actions. */
export function buttonClassName(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return `${styles.button} ${styles[variant === 'outline' ? 'secondary' : variant]} ${styles[size]}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loadingLabel?: string;
  /** Render an inline loading indicator and disable the control. */
  loading?: boolean;
  children: ReactNode;
}

/**
 * Canonical action primitive: 32/40/48px sizes, stable loading labels,
 * explicit destructive variant and native submit semantics.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loadingLabel = 'Loading…',
  className,
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type="button"
      className={`${buttonClassName(variant, size)} ${fullWidth ? styles.fullWidth : ''} ${className ?? ''}`}
      data-size={size}
      data-variant={variant}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className={styles.content}>
        <span
          className={loading ? styles.reservedLabel : undefined}
          aria-hidden={loading || undefined}
        >
          {children}
        </span>
        {loading ? (
          <span className={styles.loadingLabel} role="status">
            <Spinner size="sm" />
            <span>{loadingLabel}</span>
          </span>
        ) : null}
      </span>
    </button>
  );
}
