import type { ReactNode } from 'react';

import { Button } from './Button';
import { Dialog } from './Dialog';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger tone for destructive/irreversible actions (UI-UX §9.6). */
  danger?: boolean;
  /** Disable the confirm button (e.g. while an async action is pending). */
  confirmDisabled?: boolean;
  /** Show a loading state on the confirm button. */
  confirmLoading?: boolean;
}

/** Confirmation dialog for destructive/irreversible actions (UI-UX §9.6). */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  confirmDisabled = false,
  confirmLoading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={confirmLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={confirmDisabled}
            loading={confirmLoading}
            loadingLabel="Processing…"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.message}>{message}</div>
    </Dialog>
  );
}
