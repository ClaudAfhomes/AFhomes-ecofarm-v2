import { useEffect, useState, type CSSProperties } from 'react';

import { Button, Dialog, notifySuccess } from '@jad/ui';
import { CUSTOM_ROLE_FORBIDDEN_MODULES } from '@jad/contracts';
import type { StaffModule } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { useCreateRole } from '../hooks/useCreateRole';
import { RoleModulePicker } from './RoleModulePicker';

type Props = {
  open: boolean;
  onClose: () => void;
};

const inputStyle = (invalid: boolean): CSSProperties => ({
  padding: '10px 12px',
  border: `1px solid ${invalid ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-body-s)',
});

const errorStyle: CSSProperties = {
  color: 'var(--color-danger)',
  fontSize: 'var(--text-caption)',
};

export function RoleFormDialog({ open, onClose }: Props) {
  const { user } = useSession();
  const createMutation = useCreateRole();
  const isPending = createMutation.isPending;

  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<StaffModule[]>(['dashboard']);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setPermissions(['dashboard']);
    setErrors({});
  }, [open]);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required.';
    if (permissions.length === 0) e.permissions = 'Select at least one module.';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    try {
      const role = await createMutation.mutateAsync({
        name: name.trim(),
        permissions,
        actor: user?.name ?? 'Unknown',
        actorRole: user?.roleId ? user.roleId.toUpperCase() : 'ADMIN',
      });
      notifySuccess({ title: 'Role created', message: `${role.name} is ready to assign` });
      onClose();
    } catch (err) {
      setErrors({ submit: (err as Error).message || 'Something went wrong. Please try again.' });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create Role"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Creating…' : 'Create Role'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)', minWidth: 340 }}>
        {errors.submit ? (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '10px 12px',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              color: 'var(--color-danger)',
            }}
          >
            {errors.submit}
          </p>
        ) : null}

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Finance Reviewer"
            aria-label="Role name"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'role-name-error' : undefined}
            style={inputStyle(Boolean(errors.name))}
          />
          {errors.name ? (
            <span id="role-name-error" style={errorStyle} role="alert">
              {errors.name}
            </span>
          ) : null}
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
            Names must be unique. The id is derived automatically and never changes.
          </span>
        </label>

        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Modules <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <RoleModulePicker
            selected={permissions}
            onChange={setPermissions}
            disabled={isPending}
            showGlobalActions
            lockedModules={CUSTOM_ROLE_FORBIDDEN_MODULES}
          />
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
            New roles are custom: Staff, Audit Log, System Configuration and Programs stay
            super-admin-only.
          </span>
          {errors.permissions ? (
            <span style={errorStyle} role="alert">
              {errors.permissions}
            </span>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
