import type { ReactNode } from 'react';

import styles from './Alert.module.css';

export interface AlertProps {
  variant: 'success' | 'warning' | 'danger' | 'info';
  title?: string;
  children: ReactNode;
}

/**
 * Inline notification (DESIGN-SYSTEM §6.6). Always conveys state with
 * icon + text + color, never color alone (DESIGN-SYSTEM §1.1). Announcement
 * uses the implicit live regions: `role="alert"` (assertive) for danger and
 * `role="status"` (polite) for everything else (UI-UX §12.4).
 */
export function Alert({ variant, title, children }: AlertProps) {
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={`${styles.alert} ${styles[variant]}`}
    >
      <span className={styles.icon} aria-hidden="true">
        {variant === 'success'
          ? '✓'
          : variant === 'warning'
            ? '!'
            : variant === 'danger'
              ? '✕'
              : 'i'}
      </span>
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div className={styles.message}>{children}</div>
      </div>
    </div>
  );
}
