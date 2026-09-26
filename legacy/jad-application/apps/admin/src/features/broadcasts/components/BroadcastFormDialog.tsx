import { useId, useState } from 'react';

import { Button, Dialog, notifyError, notifySuccess } from '@jad/ui';

import { useCreateBroadcast } from '../hooks/useCreateBroadcast';
import styles from '../pages/BroadcastsPage.module.css';

/**
 * Create dialog for an admin broadcast (SCR-ADM-016, FEAT-063): title and an
 * optional plain-text message. Sending publishes the announcement to every
 * member's notification feed (`POST /broadcasts` → member_id NULL row).
 * Broadcasts are retained announcements - there is no edit/delete path.
 */
export function BroadcastFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createBroadcast = useCreateBroadcast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const hintId = useId();

  const reset = () => {
    setTitle('');
    setBody('');
    setSaving(false);
  };

  const canSave = title.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await createBroadcast.mutateAsync({
        title: title.trim(),
        ...(body.trim() && { body: body.trim() }),
      });
      notifySuccess({
        title: 'Broadcast sent',
        message: `"${title.trim()}" is now in every member's feed.`,
      });
      reset();
      onClose();
    } catch (e) {
      notifyError({ title: 'Send failed', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) {
          reset();
          onClose();
        }
      }}
      title="New broadcast"
      describedBy={hintId}
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>Title</span>
          <input
            className={styles.input}
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Maintenance this Sunday"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Message (optional)</span>
          <textarea
            className={styles.textarea}
            value={body}
            rows={5}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Details members should know…"
          />
        </label>
        <p className={styles.hint} id={hintId}>
          Broadcasts reach every member. There is no way to edit or retract an announcement after
          sending.
        </p>
        <div className={styles.formActions}>
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={handleSave}>
            {saving ? 'Sending…' : 'Send broadcast'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
