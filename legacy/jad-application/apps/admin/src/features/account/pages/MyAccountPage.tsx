import { useState } from 'react';

import { Button, notifySuccess, PageHeader, StatusChip } from '@jad/ui';
import { roleNameFor } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { useRoles } from '../../roles/hooks/useRoles';
import { useUpdateStaffProfile } from '../hooks/useUpdateStaffProfile';
import { useChangeStaffPassword } from '../hooks/useChangeStaffPassword';
import styles from './MyAccountPage.module.css';

/**
 * My Account (/admin/profile) - the signed-in staff member views identity,
 * edits their display name, and changes their password. Email and role are
 * read-only (auth identity / governance-controlled). When the account runs on
 * a super-admin-set temporary password, a banner directs them to set their
 * own before continuing.
 */
export function MyAccountPage() {
  const { user, roleId, mustChangePassword, revalidate, status } = useSession();
  // Role records are blocked while a password change is required; the label
  // falls back via roleNameFor, so don't fire a doomed request. The page
  // only renders when authenticated, but keep the guard explicit.
  const { data: roles } = useRoles({
    enabled: status === 'authenticated' && !mustChangePassword,
  });
  const updateProfile = useUpdateStaffProfile();
  const changePassword = useChangeStaffPassword();

  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState<string | undefined>();
  const [savingName, setSavingName] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) return null;
  const roleLabel = user.roleName ?? (roleId ? roleNameFor(roles, roleId) : 'Staff');

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Enter a display name.');
      return;
    }
    setNameError(undefined);
    setSavingName(true);
    try {
      await updateProfile.mutateAsync({ name: trimmed });
      notifySuccess({ title: 'Profile updated', message: 'Your display name was saved.' });
      await revalidate();
    } catch (e) {
      setNameError((e as Error).message || 'We could not save your name. Please try again.');
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordError(undefined);
    setSavingPassword(true);
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      notifySuccess({
        title: 'Password changed',
        message: 'Use your new password next time you sign in.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await revalidate();
    } catch (e) {
      setPasswordError(
        (e as Error).message || 'We could not change your password. Please try again.',
      );
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <section>
      <PageHeader title="My Account" description="Your staff identity and sign-in." />

      {mustChangePassword ? (
        <div className={styles.banner} role="alert">
          <strong className={styles.bannerTitle}>Set a new password to continue.</strong>
          <span className={styles.bannerText}>
            Your account is using a temporary password. Choose your own below - the rest of the
            admin panel unlocks once it is changed.
          </span>
        </div>
      ) : null}

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Profile</h2>
        <dl className={styles.fieldGrid}>
          <div className={styles.field}>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className={styles.field}>
            <dt>Role</dt>
            <dd>
              <StatusChip label={roleLabel} tone="info" icon="user" />
            </dd>
          </div>
        </dl>
        <label className={styles.formField}>
          <span className={styles.fieldLabel}>Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={styles.input}
            aria-label="Display name"
            autoComplete="name"
          />
        </label>
        {nameError ? (
          <p className={styles.fieldError} role="alert">
            {nameError}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button onClick={handleSaveName} loading={savingName} disabled={savingName}>
            Save changes
          </Button>
        </div>
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Change password</h2>
        <label className={styles.formField}>
          <span className={styles.fieldLabel}>Current password</span>
          <input
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            type="password"
            className={styles.input}
            aria-label="Current password"
            autoComplete="current-password"
          />
        </label>
        <label className={styles.formField}>
          <span className={styles.fieldLabel}>New password</span>
          <input
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            type="password"
            className={styles.input}
            aria-label="New password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </label>
        <label className={styles.formField}>
          <span className={styles.fieldLabel}>Confirm new password</span>
          <input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            type="password"
            className={styles.input}
            aria-label="Confirm new password"
            autoComplete="new-password"
          />
        </label>
        {passwordError ? (
          <p className={styles.fieldError} role="alert">
            {passwordError}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button onClick={handleChangePassword} loading={savingPassword} disabled={savingPassword}>
            Change password
          </Button>
        </div>
      </div>
    </section>
  );
}
