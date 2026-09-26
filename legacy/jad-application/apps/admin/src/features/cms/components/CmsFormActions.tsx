import { useId } from 'react';

import { Button, StatusChip } from '@jad/ui';

import styles from './CmsFormActions.module.css';

export function CmsFormActions({
  dirty,
  valid,
  saving,
  onSave,
  onCancel,
  saveLabel = 'Save',
  lastSaved,
}: {
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  lastSaved?: string | null;
}) {
  const statusId = useId();
  const saveDisabledReason = !dirty
    ? 'No changes to save'
    : !valid
      ? 'Fix validation errors before saving'
      : undefined;
  return (
    <div className={styles.actions}>
      <Button variant="secondary" onClick={onCancel} disabled={!dirty || saving}>
        Cancel
      </Button>
      <span title={saveDisabledReason} className={styles.saveWrap}>
        <Button
          onClick={onSave}
          disabled={!dirty || !valid}
          loading={saving}
          aria-describedby={saveDisabledReason ? statusId : undefined}
        >
          {saveLabel}
        </Button>
      </span>
      <span className={styles.status}>
        {dirty ? (
          <StatusChip label="Unsaved changes" tone="warning" />
        ) : (
          <StatusChip label="All changes saved" tone="success" />
        )}
        <span id={statusId} aria-live="polite">
          {dirty
            ? valid
              ? 'Unsaved changes: save to keep them.'
              : 'Unsaved changes: fix validation errors before saving.'
            : lastSaved
              ? `Last saved: ${new Date(lastSaved).toLocaleString()}`
              : 'All changes saved.'}
        </span>
      </span>
    </div>
  );
}
