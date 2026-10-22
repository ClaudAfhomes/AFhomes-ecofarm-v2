import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, PageHeader, TextAreaField, TextField, notifySuccess } from '@afhomes/ui';
import {
  updatePublicVerificationSettingsSchema,
  type PublicVerificationSettings,
} from '@afhomes/contracts';
import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { getPublicVerificationSettings, savePublicVerificationSettings } from './services';
import styles from './PublicVerificationSettingsPage.module.css';

const key = ['afhomes', 'public-verification-settings'] as const;
export function PublicVerificationSettingsPage() {
  const { user } = useSession();
  const allowed =
    ['admin', 'super_admin'].includes(user?.roleSlug ?? '') &&
    user?.afHomesPermissions.some((p) => p.moduleKey === 'governance.config' && p.canView);
  const writable =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'governance.config' && p.canUpdate) ===
    true;
  const settings = useQuery({
    queryKey: key,
    queryFn: getPublicVerificationSettings,
    enabled: !!allowed,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (!allowed) return <Alert variant="warning">You cannot view verification settings.</Alert>;
  return (
    <section className={styles.page}>
      <PageHeader
        title="Public Verification Settings"
        description="Control the public IST/OST verification service."
      />
      {settings.isPending ? (
        <p role="status">Loading settings…</p>
      ) : settings.isError ? (
        <Alert variant="danger">
          <p>Settings could not be loaded.</p>
          <Button onClick={() => void settings.refetch()}>Retry</Button>
        </Alert>
      ) : (
        <SettingsForm key={settings.data.revision} settings={settings.data} writable={writable} />
      )}
    </section>
  );
}
function SettingsForm({
  settings,
  writable,
}: {
  settings: PublicVerificationSettings;
  writable: boolean;
}) {
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(settings.dailyLimitEnabled);
  const [privacyApproved, setPrivacyApproved] = useState(settings.privacyApproved);
  const [phone, setPhone] = useState(settings.verificationPhone);
  const [notice, setNotice] = useState(settings.privacyNotice);
  const [days, setDays] = useState(String(settings.retentionDays));
  const [validation, setValidation] = useState('');
  const save = useBusinessMutation({
    mutationFn: savePublicVerificationSettings,
    onSuccess: (saved) => {
      client.setQueryData(key, saved);
      notifySuccess({
        title: 'Settings saved',
        message: 'Public verification now uses these settings.',
      });
    },
  });
  const disabled = !writable || save.isPending;
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const input = updatePublicVerificationSettingsSchema.safeParse({
          enabled,
          dailyLimitEnabled,
          privacyApproved,
          verificationPhone: phone,
          privacyNotice: notice,
          retentionDays: Number(days),
          expectedRevision: settings.revision,
        });
        if (!input.success) {
          setValidation(input.error.issues[0]?.message ?? 'Check the settings.');
          return;
        }
        setValidation('');
        save.mutate(input.data);
      }}
    >
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Enable public IST/OST search
      </label>
      <p>
        Disabling search stops new verification requests. Saved records continue through scheduled
        cleanup.
      </p>
      <TextField
        id="verification-phone"
        name="verificationPhone"
        label="Company verification phone"
        value={phone}
        onChange={setPhone}
        disabled={disabled}
      />
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={dailyLimitEnabled}
          disabled={disabled}
          onChange={(event) => setDailyLimitEnabled(event.target.checked)}
        />
        Limit each IP address to 3 successful searches in 24 hours
      </label>
      <p>
        Turn off for testing without the daily search limit. This applies to all public visitors.
        Anti-bot checks and short-term request limits stay active. Turn it back on after testing.
      </p>
      <TextField
        id="retention-days"
        name="retentionDays"
        inputMode="numeric"
        label="Contact retention (days)"
        value={days}
        onChange={setDays}
        disabled={disabled}
        hint="1–3650 whole days. Applies to existing contacts at hourly cleanup, including when shortened."
      />
      <TextAreaField
        id="privacy-notice"
        name="privacyNotice"
        label="Privacy notice"
        value={notice}
        onChange={setNotice}
        disabled={disabled}
        rows={14}
        maxLength={20000}
        hint="Use {{CONTACT_RETENTION_DAYS}} for retention and {{SEARCH_LIMIT_NOTICE}} for the current daily limit. Notice or daily-limit changes require visitors to acknowledge the new version."
      />
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={privacyApproved}
          disabled={disabled}
          onChange={(event) => setPrivacyApproved(event.target.checked)}
        />
        Privacy notice approved
      </label>
      <p>Approve the notice above before enabling public verification.</p>
      <Alert variant={settings.cleanupReady ? 'success' : 'warning'}>
        {settings.cleanupReady
          ? 'Cleanup ready: the hourly contact-cleanup job is configured and active.'
          : 'Cleanup not ready: the hourly contact-cleanup job is missing, inactive or misconfigured. Public verification is unavailable.'}
      </Alert>
      <p>Cleanup readiness is checked automatically. It cannot be enabled with a checkbox.</p>
      {validation || save.error ? (
        <Alert variant="danger">{validation || save.error?.message}</Alert>
      ) : null}
      {writable ? (
        <Button type="submit" disabled={save.isPending} loading={save.isPending}>
          Save settings
        </Button>
      ) : (
        <p>You have read-only access to these settings.</p>
      )}
    </form>
  );
}
