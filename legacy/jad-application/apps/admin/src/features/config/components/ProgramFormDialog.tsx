import { useEffect, useState } from 'react';

import { Button, Dialog, notifyError, notifySuccess } from '@jad/ui';
import type { ProgramAdmin } from '@jad/contracts';

import { useCreateProgram } from '../hooks/useCreateProgram';
import { useUpdateProgram } from '../hooks/useUpdateProgram';
import styles from '../pages/ConfigPage.module.css';

/**
 * Create/edit dialog for a qualification program (FR-PRG-001). Editing a
 * program never deletes it - retire with the Active toggle so existing
 * registrations/members keep their reference. Super_admin only.
 */
export function ProgramFormDialog({
  open,
  program,
  onClose,
}: {
  open: boolean;
  program: ProgramAdmin | null;
  onClose: () => void;
}) {
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(program?.code ?? '');
    setName(program?.name ?? '');
    setDescription(program?.description ?? '');
    setIsActive(program?.isActive ?? true);
    setError(undefined);
    setSaving(false);
  }, [open, program]);

  const canSave = code.trim().length > 0 && name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(undefined);
    const payload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      description: description.trim() || undefined,
      isActive,
    };
    try {
      if (program) {
        await updateProgram.mutateAsync({ id: program.id, patch: payload });
        notifySuccess({ title: 'Program updated', message: `"${payload.name}" was saved.` });
      } else {
        await createProgram.mutateAsync(payload);
        notifySuccess({ title: 'Program created', message: `"${payload.name}" is now available.` });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
      notifyError({ title: 'Save failed', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={program ? `Edit ${program.name}` : 'New program'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!canSave}>
            {program ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className={styles.programForm}>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="DOMESTIC"
            className={styles.editInput}
            aria-label="Program code"
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Domestic Program"
            className={styles.editInput}
            aria-label="Program name"
          />
        </label>
        <label className={styles.editField}>
          <span className={styles.editLabel}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Who the program is for and what it covers"
            className={styles.editTextarea}
            aria-label="Program description"
          />
        </label>
        <label className={styles.programActiveToggle}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>Active (visible on the public site and registration)</span>
        </label>
        {error ? (
          <span role="alert" className={styles.editError}>
            {error}
          </span>
        ) : null}
      </div>
    </Dialog>
  );
}
