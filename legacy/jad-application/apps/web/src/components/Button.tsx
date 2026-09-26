import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Spinner } from '@jad/ui';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Render an inline loading indicator and disable the control (UI-UX §9.6). */
  loading?: boolean;
  children: ReactNode;
}

/**
 * Shared button primitive (DESIGN-SYSTEM §6.1). Variants: primary (main action),
 * secondary (supporting), ghost (in-context). Danger variant is intentionally
 * NOT provided - the public website has no destructive actions. For link-style
 * actions use `ButtonLink`. Minimum target size 44px (DESIGN-SYSTEM §7.4).
 */
export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className,
  type,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const mergedClassName = [styles.button, styles[variant], className].filter(Boolean).join(' ');
  return (
    <button
      type={(type as ButtonProps['type']) ?? 'button'}
      className={mergedClassName}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className={styles.loadingLabel} role="status">
          <Spinner size="sm" />
          <span>Loading…</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
