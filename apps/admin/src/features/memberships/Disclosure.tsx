import { useId, type ReactNode } from 'react';
import { Icon } from '@afhomes/ui';
import styles from './Disclosure.module.css';

/**
 * Animated show/hide row. A button controls a grid-rows panel (same motion as
 * the Sidebar dropdown). Closed content stays mounted but is `visibility:
 * hidden`, so it is neither focusable nor announced.
 */
export function Disclosure({
  title,
  open,
  onOpenChange,
  tone = 'default',
  children,
}: {
  title: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone?: 'default' | 'caution';
  children: ReactNode;
}) {
  const panelId = useId();
  return (
    <div className={`${styles.item} ${tone === 'caution' ? styles.caution : ''}`}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
      >
        <span className={styles.title}>{title}</span>
        <Icon name="chevron-down" size={16} className={styles.chevron} aria-hidden="true" />
      </button>
      <div id={panelId} className={`${styles.panel} ${open ? styles.panelOpen : ''}`}>
        <div className={styles.inner}>
          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </div>
  );
}
