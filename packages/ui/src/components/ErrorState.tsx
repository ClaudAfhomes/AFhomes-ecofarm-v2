import { Button } from './Button';
import { Icon } from './Icon';
import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  message?: string;
  /** Correlation `requestId` (API-SPECIFICATION §3) - no PII (NFR-CONF-001). */
  requestId?: string;
  onRetry?: () => void;
}

/**
 * Recoverable error state (UI-UX §10 "Error"). Never renders raw stack traces
 * or server internals; surfaces the correlation id and an optional retry.
 */
export function ErrorState({
  error,
  title = 'We couldn’t load this information',
  message,
  requestId,
  onRetry,
}: ErrorStateProps) {
  const text = message ?? 'Please try again. If this continues, contact AF Homes support.';
  const reference =
    requestId ??
    (typeof error === 'object' &&
    error !== null &&
    'requestId' in error &&
    typeof error.requestId === 'string'
      ? error.requestId
      : undefined);
  return (
    <div className={styles.error} role="alert">
      <span className={styles.icon} aria-hidden="true">
        <Icon name="alert" size={20} />
      </span>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        <p className={styles.message}>{text}</p>
        {reference ? (
          <details>
            <summary>Support details</summary>
            <p className={styles.requestId}>Reference: {reference}</p>
          </details>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
