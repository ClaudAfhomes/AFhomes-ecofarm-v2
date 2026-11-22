import type { ReactNode } from 'react';

import { Icon } from './Icon';
import styles from './Forbidden.module.css';

export interface ForbiddenProps {
  title?: string;
  message?: ReactNode;
  action?: ReactNode;
}

/**
 * Forbidden (403) state (UI-UX §10). Generic message - never reveals whether a
 * resource exists (API-SPECIFICATION §8); access decisions are server-enforced.
 */
export function Forbidden({
  title = 'Access denied',
  message = 'You do not have permission to view this section. If you believe this is a mistake, contact support.',
  action,
}: ForbiddenProps) {
  return (
    <div className={styles.state}>
      <span className={styles.icon} aria-hidden="true">
        <Icon name="alert" size={24} />
      </span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.message}>{message}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
