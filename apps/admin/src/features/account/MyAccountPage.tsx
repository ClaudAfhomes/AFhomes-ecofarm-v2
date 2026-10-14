import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  DetailCard,
  DetailCardTitle,
  DetailField,
  DetailFieldGrid,
  PageHeader,
  PasswordField,
  StatusChip,
  TextField,
} from '@afhomes/ui';
import { useSession } from '../../lib/session';
import { normalizeLiveHumanField } from '../../lib/normalize';
import { changeAfHomesStaffPassword, updateAfHomesStaffProfile } from '../afhomes/services';
import styles from './MyAccountPage.module.css';
import { SaleTeamAccreditationCard } from '../afhomes/SaleTeamAccreditationCard';

/**
 * My Account (AF Homes pattern, `/admin/profile`): the signed-in staff
 * member's identity plus the display-name and password workflows. While
 * `mustChangePassword` is set the rest of the admin panel stays locked and
 * this page is the only destination, so the password card is the forced
 * first-login change.
 */
export function MyAccountPage() {
  const navigate = useNavigate();
  const { user, revalidate } = useSession();
  const mustChangePassword = user?.mustChangePassword === true;
  const [name, setName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const displayName = name ?? user?.name ?? '';
  const passwordsMatch = newPassword === confirmPassword;
  const passwordValid = currentPassword.length > 0 && newPassword.length >= 8 && passwordsMatch;

  const profile = useBusinessMutation({
    mutationFn: () => updateAfHomesStaffProfile({ name: displayName.trim() }),
    onSuccess: async () => {
      await revalidate();
    },
  });
  const password = useBusinessMutation({
    mutationFn: () => changeAfHomesStaffPassword({ currentPassword, newPassword }),
    onSuccess: async () => {
      // Capture the gate BEFORE the refresh: a forced change that cleared the
      // server flag must leave this screen. Navigating to the dashboard is
      // safe either way - if the flag were somehow still set, the guard
      // parks the session right back here instead of stranding it.
      const wasForced = mustChangePassword;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await revalidate();
      if (wasForced) navigate('/admin', { replace: true });
    },
  });

  return (
    <section className={styles.page}>
      <PageHeader title="My Account" description="Your staff identity and sign-in" />
      {mustChangePassword ? (
        <Alert variant="warning" title="Set a new password to continue">
          Your account still uses the temporary password an administrator set. Choose your own
          password below - the rest of the admin panel unlocks once it is changed.
        </Alert>
      ) : null}
      <div className={styles.stack}>
        {['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(user?.roleSlug ?? '') ?
          <SaleTeamAccreditationCard kind={user?.roleSlug === 'ost' ? 'OST' : 'IST'} /> : null}
        <DetailCard>
          <DetailCardTitle>Profile</DetailCardTitle>
          <DetailFieldGrid>
            <DetailField label="Email">{user?.email ?? '-'}</DetailField>
            <DetailField label="Role">
              <StatusChip label={user?.roleName ?? '-'} tone="neutral" />
            </DetailField>
          </DetailFieldGrid>
          <div className={styles.formGrid}>
            <TextField
              id="account-display-name"
              name="account-display-name"
              label="Display name"
              value={displayName}
              suggestName
              normalize={(value) => normalizeLiveHumanField('fullName', value)}
              onChange={setName}
              autoComplete="name"
              error={
                displayName.trim().length === 0 && name !== null
                  ? 'Enter a display name.'
                  : undefined
              }
            />
            <div>
              <Button
                disabled={displayName.trim().length < 2 || profile.isPending}
                onClick={() => profile.mutate()}
              >
                {profile.isPending ? 'Saving…' : 'Save display name'}
              </Button>
            </div>
            {profile.error ? <p role="alert">{profile.error.message}</p> : null}
          </div>
        </DetailCard>

        <DetailCard>
          <DetailCardTitle>
            {mustChangePassword ? 'Set a new password' : 'Change password'}
          </DetailCardTitle>
          <div className={styles.section}>
            <PasswordField
              id="account-current-password"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
            <PasswordField
              id="account-new-password"
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              hint="At least 8 characters."
              error={
                newPassword.length > 0 && newPassword.length < 8
                  ? 'Use at least 8 characters.'
                  : undefined
              }
            />
            <PasswordField
              id="account-confirm-password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              error={
                confirmPassword.length > 0 && !passwordsMatch
                  ? 'New passwords do not match.'
                  : undefined
              }
            />
            <div>
              <Button
                disabled={!passwordValid || password.isPending}
                onClick={() => password.mutate()}
              >
                {password.isPending ? 'Changing…' : 'Change password'}
              </Button>
            </div>
            {password.error ? <p role="alert">{password.error.message}</p> : null}
          </div>
        </DetailCard>
      </div>
    </section>
  );
}
