import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  PageHeader,
  Skeleton,
  TextAreaField,
  TextField,
  notifySuccess,
  Tabs,
  type TabItem,
} from '@afhomes/ui';
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
  const [reloadKey, setReloadKey] = useState(0);
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
        description="Control public verification and results."
      />
      {settings.isPending ? (
        <SettingsSkeleton />
      ) : settings.isError ? (
        <Alert variant="danger">
          <p>Settings could not be loaded.</p>
          <Button onClick={() => void settings.refetch()}>Retry</Button>
        </Alert>
      ) : (
        <SettingsForm
          key={`${settings.data.revision}:${reloadKey}`}
          settings={settings.data}
          writable={writable}
          onReload={() => void settings.refetch().then(() => setReloadKey((n) => n + 1))}
        />
      )}
    </section>
  );
}

function SkeletonSection({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <Skeleton className={styles.skelTitle} />
        <Skeleton className={styles.skelText} />
      </div>
      {children}
    </div>
  );
}

/** Mirrors the form layout: intro, five section cards, save bar. */
function SettingsSkeleton() {
  return (
    <div className={styles.form} role="status" aria-busy="true" aria-label="Loading settings">
      <Skeleton className={styles.skelText} />
      <SkeletonSection>
        <Skeleton className={styles.skelToggle} />
        <Skeleton className={styles.skelToggle} />
        <div className={styles.fieldGrid}>
          <Skeleton className={styles.skelField} />
          <Skeleton className={styles.skelField} />
        </div>
      </SkeletonSection>
      <SkeletonSection>
        <div className={styles.fieldGrid}>
          <Skeleton className={styles.skelField} />
          <Skeleton className={styles.skelField} />
          <Skeleton className={styles.skelField} />
        </div>
      </SkeletonSection>
      <SkeletonSection>
        <Skeleton className={styles.skelField} />
        <div className={styles.bankPair}>
          <Skeleton className={styles.skelBank} />
          <Skeleton className={styles.skelBank} />
        </div>
        <Skeleton className={styles.skelField} />
      </SkeletonSection>
      <SkeletonSection>
        <Skeleton className={styles.skelArea} />
        <Skeleton className={styles.skelArea} />
      </SkeletonSection>
      <SkeletonSection>
        <Skeleton className={styles.skelTabs} />
        <Skeleton className={styles.skelNotice} />
        <Skeleton className={styles.skelToggle} />
      </SkeletonSection>
    </div>
  );
}

const friendlyMessage = (message: string) =>
  /^(Too |Invalid)/.test(message) ? 'Check this value.' : message;

function SettingsForm({
  settings,
  writable,
  onReload,
}: {
  settings: PublicVerificationSettings;
  writable: boolean;
  onReload: () => void;
}) {
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(settings.dailyLimitEnabled);
  const [privacyApproved, setPrivacyApproved] = useState(settings.privacyApproved);
  const [phone, setPhone] = useState(settings.verificationPhone);
  const [notice, setNotice] = useState(settings.privacyNotice);
  const [days, setDays] = useState(String(settings.retentionDays));
  // Customer Support
  const [supportHeading, setSupportHeading] = useState(settings.supportHeading);
  const [supportEmail, setSupportEmail] = useState(settings.supportEmail);
  const [supportPhone, setSupportPhone] = useState(settings.supportPhone);
  // Bank Accounts
  const [bankHolder, setBankHolder] = useState(settings.bankHolder);
  const [bank1Name, setBank1Name] = useState(settings.bank1Name);
  const [bank1Account, setBank1Account] = useState(settings.bank1Account);
  const [bank2Name, setBank2Name] = useState(settings.bank2Name);
  const [bank2Account, setBank2Account] = useState(settings.bank2Account);
  const [checkPayee, setCheckPayee] = useState(settings.checkPayee);
  // Payment Notices
  const [bankReminder, setBankReminder] = useState(settings.bankReminder);
  const [agentReminder, setAgentReminder] = useState(settings.agentReminder);
  // Privacy Notice edit/preview
  const [noticeMode, setNoticeMode] = useState<'edit' | 'preview'>('edit');
  const [validation, setValidation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const current = {
    enabled,
    dailyLimitEnabled,
    privacyApproved,
    verificationPhone: phone,
    privacyNotice: notice,
    retentionDays: days,
    supportHeading,
    supportEmail,
    supportPhone,
    bankHolder,
    bank1Name,
    bank1Account,
    bank2Name,
    bank2Account,
    checkPayee,
    bankReminder,
    agentReminder,
  };
  // Trimmed compare: whitespace-only edits and reverted edits are not changes.
  const dirty = Object.entries(current).some(([name, value]) => {
    const saved = settings[name as keyof typeof current];
    return typeof value === 'string' ? value.trim() !== String(saved).trim() : value !== saved;
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || !dirty) return;
    const input = updatePublicVerificationSettingsSchema.safeParse({
      ...current,
      retentionDays: days.trim() === '' ? Number.NaN : Number(days),
      expectedRevision: settings.revision,
    });
    if (!input.success) {
      const found: Record<string, string> = {};
      for (const issue of input.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (field && !found[field]) found[field] = friendlyMessage(issue.message);
      }
      setErrors(found);
      setValidation('Check the marked fields.');
      document.querySelector<HTMLElement>(`[name="${Object.keys(found)[0]}"]`)?.focus();
      return;
    }
    setErrors({});
    setValidation('');
    save.mutate(input.data);
  };

  const renderPreview = (text: string) => (
    <div className={styles.previewContent}>{text}</div>
  );

  const noticeTabs: TabItem[] = [
    { value: 'edit', label: 'Edit' },
    { value: 'preview', label: 'Preview' },
  ];

  const handleNoticeModeChange = (value: string) => {
    setNoticeMode(value as 'edit' | 'preview');
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formIntro}>
        <p className={styles.helpText}>
          Manage verification, accounts, notices, privacy.
        </p>
      </div>

      {/* Section 1: Public Search Controls */}
      <section className={styles.sectionCard} aria-labelledby="public-search-heading">
        <header className={styles.sectionHeader}>
          <h2 id="public-search-heading" className={styles.sectionTitle}>Public Search Controls</h2>
          <p className={styles.sectionDescription}>
            Enable or disable public verification and manage contact retention.
          </p>
        </header>
        <div className={styles.toggleGrid}>
          <label className={styles.toggleRow}>
            <span className={styles.toggleCopy}>
              <span className={styles.toggleLabel}>Enable public IST/OST search</span>
              <span className={styles.helpText}>
                Disabling search stops new verification requests. Saved records continue through scheduled cleanup.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className={styles.switch}
              aria-label="Enable public IST/OST search"
              checked={enabled}
              disabled={disabled}
              onChange={(event) => { setEnabled(event.target.checked); }}
            />
          </label>
          <label className={styles.toggleRow}>
            <span className={styles.toggleCopy}>
              <span className={styles.toggleLabel}>
                Limit each IP address to 3 successful searches in 24 hours
              </span>
              <span className={styles.helpText}>
                Turn off for testing without the daily search limit. This applies to all public visitors. Anti-bot checks and short-term request limits stay active.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className={styles.switch}
              aria-label="Limit each IP address to 3 successful searches in 24 hours"
              checked={dailyLimitEnabled}
              disabled={disabled}
              onChange={(event) => { setDailyLimitEnabled(event.target.checked); }}
            />
          </label>
        </div>
        <div className={styles.fieldGrid}>
          <TextField
            id="verification-phone"
            name="verificationPhone"
            error={errors.verificationPhone}
            label="Company verification phone"
            value={phone}
            onChange={(v) => { setPhone(v); }}
            disabled={disabled}
          />
          <TextField
            id="retention-days"
            name="retentionDays"
            error={errors.retentionDays}
            inputMode="numeric"
            label="Contact retention (days)"
            value={days}
            onChange={(v) => { setDays(v); }}
            disabled={disabled}
          />
        </div>
        <Alert variant={settings.cleanupReady ? 'success' : 'warning'}>
          {settings.cleanupReady
            ? 'Cleanup ready: the hourly contact-cleanup job is configured and active.'
            : 'Cleanup not ready: the hourly contact-cleanup job is missing, inactive or misconfigured. Public verification is unavailable.'}
        </Alert>
        <p className={styles.helpText}>Cleanup status is automatic.</p>
      </section>

      {/* Section 2: Customer Support */}
      <section className={styles.sectionCard} aria-labelledby="support-heading">
        <header className={styles.sectionHeader}>
          <h2 id="support-heading" className={styles.sectionTitle}>Customer Support & Payment Inquiries</h2>
          <p className={styles.sectionDescription}>
            Information shown in the Customer Support section of public verification results.
          </p>
        </header>
        <div className={styles.fieldGrid}>
          <TextField
            id="support-heading-input"
            name="supportHeading"
            error={errors.supportHeading}
            label="Section heading"
            value={supportHeading}
            onChange={(v) => { setSupportHeading(v); }}
            disabled={disabled}
          />
          <TextField
            id="support-email"
            name="supportEmail"
            error={errors.supportEmail}
            label="Support email"
            type="email"
            value={supportEmail}
            onChange={(v) => { setSupportEmail(v); }}
            disabled={disabled}
          />
          <TextField
            id="support-phone"
            name="supportPhone"
            error={errors.supportPhone}
            label="Support phone"
            type="tel"
            value={supportPhone}
            onChange={(v) => { setSupportPhone(v); }}
            disabled={disabled}
          />
        </div>
      </section>

      {/* Section 3: Official Company Bank Accounts */}
      <section className={styles.sectionCard} aria-labelledby="bank-heading">
        <header className={styles.sectionHeader}>
          <h2 id="bank-heading" className={styles.sectionTitle}>Official Company Bank Accounts</h2>
          <p className={styles.sectionDescription}>
            Bank account details shown in the Official Company Bank Accounts section of public results.
          </p>
        </header>
        <TextField
          id="bank-holder"
          name="bankHolder"
          error={errors.bankHolder}
          label="Account holder name"
          value={bankHolder}
          onChange={(v) => { setBankHolder(v); }}
          disabled={disabled}
        />
        <div className={styles.bankPair}>
          <div className={styles.bankCard}>
            <h3 className={styles.bankCardTitle}>Bank 1</h3>
            <TextField
              id="bank1-name"
              name="bank1Name"
              error={errors.bank1Name}
              label="Bank name"
              value={bank1Name}
              onChange={(v) => { setBank1Name(v); }}
              disabled={disabled}
            />
            <TextField
              id="bank1-account"
              name="bank1Account"
              error={errors.bank1Account}
              label="Account number"
              value={bank1Account}
              onChange={(v) => { setBank1Account(v); }}
              disabled={disabled}
              hint="Enter as text to preserve leading zeros"
            />
          </div>
          <div className={styles.bankCard}>
            <h3 className={styles.bankCardTitle}>Bank 2</h3>
            <TextField
              id="bank2-name"
              name="bank2Name"
              error={errors.bank2Name}
              label="Bank name"
              value={bank2Name}
              onChange={(v) => { setBank2Name(v); }}
              disabled={disabled}
            />
            <TextField
              id="bank2-account"
              name="bank2Account"
              error={errors.bank2Account}
              label="Account number"
              value={bank2Account}
              onChange={(v) => { setBank2Account(v); }}
              disabled={disabled}
              hint="Enter as text to preserve leading zeros"
            />
          </div>
        </div>
        <TextField
          id="check-payee"
          name="checkPayee"
          error={errors.checkPayee}
          label="Check payable to"
          value={checkPayee}
          onChange={(v) => { setCheckPayee(v); }}
          disabled={disabled}
        />
      </section>

      {/* Section 4: Payment Notices */}
      <section className={styles.sectionCard} aria-labelledby="notices-heading">
        <header className={styles.sectionHeader}>
          <h2 id="notices-heading" className={styles.sectionTitle}>Payment Notices</h2>
          <p className={styles.sectionDescription}>
            Reminder messages shown in the public verification results.
          </p>
        </header>
        <TextAreaField
          id="bank-reminder"
          name="bankReminder"
          error={errors.bankReminder}
          label="Bank detail reminder"
          value={bankReminder}
          onChange={(v) => { setBankReminder(v); }}
          disabled={disabled}
          rows={3}
          maxLength={500}
          hint="Shown below the bank account details."
        />
        <TextAreaField
          id="agent-reminder"
          name="agentReminder"
          error={errors.agentReminder}
          label="Agent payment reminder"
          value={agentReminder}
          onChange={(v) => { setAgentReminder(v); }}
          disabled={disabled}
          rows={3}
          maxLength={500}
          hint="Agent payment policy reminder."
        />
      </section>

      {/* Section 5: Privacy Notice */}
      <section className={styles.sectionCard} aria-labelledby="privacy-heading">
        <header className={styles.sectionHeader}>
          <h2 id="privacy-heading" className={styles.sectionTitle}>Privacy Notice</h2>
          <p className={styles.sectionDescription}>
            The privacy notice displayed to visitors before they can search. Use Edit mode to modify, Preview mode to see how it will appear.
          </p>
        </header>
        <Tabs
          items={noticeTabs}
          value={noticeMode}
          onChange={handleNoticeModeChange}
          ariaLabel="Privacy notice mode"
        />
        {noticeMode === 'edit' ? (
          <TextAreaField
            id="privacy-notice"
            name="privacyNotice"
            error={errors.privacyNotice}
            label="Privacy notice (edit mode)"
            value={notice}
            onChange={(v) => { setNotice(v); }}
            disabled={disabled}
            rows={18}
            maxLength={20000}
            hint="Use tokens; changes need acknowledgement."
          />
        ) : (
          <div className={styles.previewWrapper}>
            {renderPreview(notice)}
          </div>
        )}
        <label className={styles.toggleRow}>
          <span className={styles.toggleCopy}>
            <span className={styles.toggleLabel}>Privacy notice approved</span>
            <span className={styles.helpText}>Approve the notice above before enabling public verification.</span>
          </span>
          <input
            type="checkbox"
              role="switch"
            className={styles.switch}
            aria-label="Privacy notice approved"
            checked={privacyApproved}
            disabled={disabled}
            onChange={(event) => { setPrivacyApproved(event.target.checked); }}
          />
        </label>
      </section>

      {validation || save.error ? (
        <Alert variant="danger">
          <p>{validation || save.error?.message}</p>
          {save.error && !validation ? (
            <Button type="button" onClick={onReload}>
              Discard edits and reload
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <div role="status" className={styles.unsavedAlert}>
        {dirty && !save.isPending && <Alert variant="warning">You have unsaved changes.</Alert>}
      </div>

      <div className={styles.saveBar}>
        {writable ? (
          <Button type="submit" disabled={save.isPending || !dirty} loading={save.isPending}>
            Save Changes
          </Button>
        ) : (
          <p className={styles.readOnly}>You have read-only access to these settings.</p>
        )}
      </div>
    </form>
  );
}