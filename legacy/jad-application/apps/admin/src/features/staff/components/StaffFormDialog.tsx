import { useEffect, useState, type CSSProperties } from 'react';

import { Button, Dialog, notifySuccess, Select } from '@jad/ui';
import { systemRoleRecords } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { useCreateStaff } from '../hooks/useCreateStaff';
import { useRoles } from '../../roles/hooks/useRoles';

type Props = {
  open: boolean;
  onClose: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputStyle = (invalid: boolean): CSSProperties => ({
  padding: '10px 12px',
  border: `1px solid ${invalid ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-body-s)',
});

const labelStyle: CSSProperties = { display: 'grid', gap: 4 };

const labelTextStyle: CSSProperties = { fontSize: 'var(--text-body-s)', fontWeight: 600 };

const errorStyle: CSSProperties = {
  color: 'var(--color-danger)',
  fontSize: 'var(--text-caption)',
};

const hintStyle: CSSProperties = {
  fontSize: 'var(--text-caption)',
  color: 'var(--color-text-muted)',
};

export function StaffFormDialog({ open, onClose }: Props) {
  const { user } = useSession();
  const { data: roles } = useRoles();
  const createMutation = useCreateStaff();
  const isPending = createMutation.isPending;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('admin');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setRoleId('admin');
    setTemporaryPassword('');
    setShowPassword(false);
    setErrors({});
  }, [open]);

  const records = roles?.length ? roles : systemRoleRecords();
  const roleOptions = records.map((r) => ({ value: r.id, label: r.name }));
  // The role list can arrive empty or exclude the held value (e.g. a system
  // role missing its stored permissions). Keep the submitted/displayed role
  // valid against the live list so a real selection is never rejected.
  const effectiveRoleId = records.some((r) => r.id === roleId) ? roleId : (records[0]?.id ?? '');

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required.';
    if (!email.trim()) e.email = 'Email is required.';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address.';
    if (!effectiveRoleId) e.role = 'Select a valid role.';
    if (!temporaryPassword) e.temporaryPassword = 'A temporary password is required.';
    else if (temporaryPassword.length < 8)
      e.temporaryPassword = 'Temporary password must be at least 8 characters.';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    try {
      const member = await createMutation.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        roleId: effectiveRoleId,
        temporaryPassword,
        actor: user?.name ?? 'Unknown',
        actorRole: user?.roleId ? user.roleId.toUpperCase() : 'ADMIN',
      });
      notifySuccess({
        title: 'Staff member created',
        message: `${member.name} added with an ACTIVE status`,
      });
      onClose();
    } catch (err) {
      setErrors({ submit: (err as Error).message || 'Something went wrong. Please try again.' });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create Staff Member"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Creating…' : 'Create Staff'}
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

        <label style={labelStyle}>
          <span style={labelTextStyle}>
            Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Juan Dela Cruz"
            aria-label="Name"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'staff-name-error' : undefined}
            style={inputStyle(Boolean(errors.name))}
          />
          {errors.name ? (
            <span id="staff-name-error" style={errorStyle} role="alert">
              {errors.name}
            </span>
          ) : null}
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>
            Email <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. juan@jad.example"
            inputMode="email"
            aria-label="Email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'staff-email-error' : undefined}
            style={inputStyle(Boolean(errors.email))}
          />
          {errors.email ? (
            <span id="staff-email-error" style={errorStyle} role="alert">
              {errors.email}
            </span>
          ) : null}
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>
            Role <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <Select
            aria-label="Role"
            value={effectiveRoleId}
            onChange={(e) => setRoleId(e.target.value)}
            options={roleOptions}
          />
          {errors.role ? (
            <span style={errorStyle} role="alert">
              {errors.role}
            </span>
          ) : null}
          <span style={hintStyle}>
            Each staff user holds exactly one role. New accounts start ACTIVE.
          </span>
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>
            Temporary password <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <input
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              placeholder="At least 8 characters"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              aria-label="Temporary password"
              aria-invalid={Boolean(errors.temporaryPassword)}
              aria-describedby={errors.temporaryPassword ? 'staff-password-error' : undefined}
              style={{ ...inputStyle(Boolean(errors.temporaryPassword)), flex: 1 }}
            />
            <Button
              variant="secondary"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </Button>
          </span>
          {errors.temporaryPassword ? (
            <span id="staff-password-error" style={errorStyle} role="alert">
              {errors.temporaryPassword}
            </span>
          ) : null}
          <span style={hintStyle}>
            The new staff signs in with this once, then must set their own password.
          </span>
        </label>
      </div>
    </Dialog>
  );
}
