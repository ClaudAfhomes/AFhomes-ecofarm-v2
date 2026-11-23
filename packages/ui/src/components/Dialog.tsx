import { createPortal } from 'react-dom';
import { useId, useRef, type ReactNode } from 'react';

import { useDialogShell } from '../hooks/useDialogShell';
import { IconButton } from './IconButton';
import styles from './Dialog.module.css';

export interface DialogProps {
  placement?: 'center' | 'right';
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  describedBy?: string;
  closeLabel?: string;
}

/**
 * Modal dialog (DESIGN-SYSTEM §6, UI-UX §9.6). Focus trap, Escape to close,
 * overlay click, scroll lock, `aria-modal`. Full-screen sheet on small
 * viewports (UI-UX §11).
 */
export function Dialog({
  placement = 'center',
  open,
  onClose,
  title,
  children,
  footer,
  describedBy,
  closeLabel = 'Close dialog',
}: DialogProps) {
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogShell({ open, onClose, panelRef });

  if (!open) return null;

  return createPortal(
    <div className={`${styles.root} ${placement === 'right' ? styles.drawer : ''}`}>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton icon="close" label={closeLabel} onClick={onClose} />
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
