import type { ReactNode } from 'react';

import styles from './Alert.module.css';

export interface AlertProps {
  variant: 'success' | 'warning' | 'danger' | 'info';
  title?: string;
  children: ReactNode;
}

/**
 * Inline notification (AF Homes alert pattern). Always conveys state with
 * icon + text + color, never color alone. `role="alert"` (assertive) for
 * danger, `role="status"` (polite) for everything else.
 */
export function Alert({ variant, title, children }: AlertProps) {
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={`${styles.alert} ${styles[variant]}`}
    >
      <span className={styles.icon} aria-hidden="true">
        {variant === 'success' ? '✓' : variant === 'warning' ? '!' : variant === 'danger' ? '✕' : 'i'}
      </span>
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div className={styles.message}>{children}</div>
      </div>
    </div>
  );
}
