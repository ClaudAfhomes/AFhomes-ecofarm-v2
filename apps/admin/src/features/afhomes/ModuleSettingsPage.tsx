import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, ConfirmDialog, PageHeader, Skeleton, notifySuccess } from '@afhomes/ui';
import {
  featureFlagsSchema,
  type FeatureFlagsResponse,
  type UpdateFeatureFlagsRequest,
} from '@afhomes/contracts';
import { FEATURE_FLAG_KEYS, setFeatureFlags, type FeatureFlagKey } from '@afhomes/shared';

import { request } from '../../lib/api/client';
import { useSession } from '../../lib/session';

import styles from './ModuleSettingsPage.module.css';

/** Plain-language description of what each switch turns on or off. */
const MODULES: Record<FeatureFlagKey, { title: string; description: string }> = {
  sales: {
    title: 'Sales and customers',
    description:
      'Customers, applications, reservations, card plans, the scheme guide, imports, and IST My Sales / Team Sales.',
  },
  finance: {
    title: 'Finance',
    description:
      'Payment list, month-end close, the activation list and memberships. Payroll and commissions have their own switches.',
  },
  payroll: {
    title: 'IST payroll',
    description: 'Payroll periods, batches, approvals and disbursements.',
  },
  commissions: {
    title: 'Commissions',
    description:
      'Commission lists and settings for Finance, and IST My Commissions / Team Commissions.',
  },
  services: {
    title: 'Services and points earning',
    description:
      'Service catalog, earning rules (points per availed service), GSD sales with the claim QR, and the customer Points page.',
  },
  redemption: {
    title: 'Points redemption',
    description:
      'Scan a VIP card to spend points on a catalog item or as a discount on a bill, plus the redemption history.',
  },
  network: {
    title: 'Sales network',
    description: 'Genealogy tree and network members.',
  },
  reports: {
    title: 'Reports',
    description: 'Reports and exports. The audit log is not part of this switch.',
  },
  cms: {
    title: 'Website content (CMS)',
    description: 'Editing of the public website pages and content.',
  },
};

const GROUPS: { title: string; keys: FeatureFlagKey[] }[] = [
  { title: 'Sales', keys: ['sales'] },
  { title: 'Money', keys: ['finance', 'payroll', 'commissions'] },
  { title: 'Services and points', keys: ['services', 'redemption'] },
  { title: 'Network', keys: ['network'] },
  { title: 'Insight and website', keys: ['reports', 'cms'] },
];

/** Parts that can never be switched off, and why. */
const ALWAYS_ON: { title: string; reason: string }[] = [
  { title: 'Dashboard and profile', reason: 'Every staff member needs a landing page and their own account.' },
  { title: 'Customer lookup', reason: 'The front desk uses it for every customer visit.' },
  {
    title: 'Organization and settings',
    reason: 'Staff, roles and this Modules page — turning them off would lock administrators out.',
  },
  { title: 'Audit log', reason: 'Every change, including a module switch, must stay traceable.' },
];

const getModules = () => request('/settings/features', featureFlagsSchema, { auth: 'optional' });
const saveModules = (input: UpdateFeatureFlagsRequest) =>
  request('/settings/features', featureFlagsSchema, {
    method: 'PUT',
    body: JSON.stringify(input),
  });

/**
 * Admin > Settings > Modules. Switching a module off hides its screens and
 * blocks its API routes for everyone; no data is deleted, and switching it back
 * on restores everything. Each save writes one audit-log entry. The server
 * re-checks `governance.config` update on every save.
 */
export function ModuleSettingsPage({
  reload = () => window.location.reload(),
}: {
  /** Re-reads the app so menus and routes follow the new switches. */
  reload?: () => void;
}) {
  const { user } = useSession();
  const canView =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'governance.config' && p.canView) === true;
  const canUpdate =
    user?.afHomesPermissions.some((p) => p.moduleKey === 'governance.config' && p.canUpdate) ===
    true;
  const modules = useQuery({
    queryKey: ['settings', 'modules'],
    queryFn: getModules,
    enabled: canView,
  });
  const [draft, setDraft] = useState<Partial<FeatureFlagsResponse>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const save = useMutation({
    mutationFn: saveModules,
    onSuccess: (next) => {
      setFeatureFlags(next);
      setDraft({});
      setConfirmOpen(false);
      notifySuccess({ title: 'Modules saved', message: 'Reloading so menus update.' });
      reload();
    },
  });

  if (!canView) return <Alert variant="warning">You cannot view module settings.</Alert>;

  const stored = modules.data;
  const value = (key: FeatureFlagKey) => draft[key] ?? stored?.[key] ?? true;
  const changes = Object.fromEntries(
    FEATURE_FLAG_KEYS.filter(
      (key) => stored && draft[key] !== undefined && draft[key] !== stored[key],
    ).map((key) => [key, draft[key] as boolean]),
  ) as UpdateFeatureFlagsRequest;
  const changed = Object.keys(changes) as FeatureFlagKey[];
  const turningOff = changed.filter((key) => changes[key] === false);
  const onCount = FEATURE_FLAG_KEYS.filter((key) => value(key)).length;

  const submit = () => {
    if (turningOff.length > 0) setConfirmOpen(true);
    else save.mutate(changes);
  };

  return (
    <section className={styles.page}>
      <PageHeader
        title="Modules"
        description={`Turn whole parts of the system on or off. ${onCount} of ${FEATURE_FLAG_KEYS.length} modules are on. Turning one off hides it for everyone; no data is deleted.`}
      />
      {modules.isPending ? (
        <div role="status" aria-label="Loading modules" className={styles.list}>
          {FEATURE_FLAG_KEYS.map((key) => (
            <Skeleton key={key} style={{ height: 72 }} />
          ))}
        </div>
      ) : modules.isError ? (
        <Alert variant="danger" title="Modules could not be loaded">
          <Button onClick={() => void modules.refetch()}>Retry</Button>
        </Alert>
      ) : (
        <>
          {!canUpdate ? (
            <Alert variant="info" title="View only">
              You can view these switches but not change them.
            </Alert>
          ) : null}
          {GROUPS.map((group) => (
            <section key={group.title} className={styles.group} aria-label={group.title}>
              <h2 className={styles.groupTitle}>{group.title}</h2>
              <ul className={styles.list}>
                {group.keys.map((key) => {
                  const on = value(key);
                  const isChanged = key in changes;
                  return (
                    <li
                      key={key}
                      className={styles.row}
                      data-changed={isChanged}
                      data-off={!on}
                    >
                      <label htmlFor={`module-${key}`} className={styles.text}>
                        <span className={styles.title}>
                          {MODULES[key].title}
                          <span className={styles.badge} data-tone={isChanged ? 'changed' : on ? 'on' : 'off'}>
                            {isChanged ? (on ? 'Will turn on' : 'Will turn off') : on ? 'On' : 'Off'}
                          </span>
                        </span>
                        <span className={styles.description}>{MODULES[key].description}</span>
                      </label>
                      <input
                        id={`module-${key}`}
                        className={styles.switch}
                        type="checkbox"
                        role="switch"
                        checked={on}
                        disabled={!canUpdate || save.isPending}
                        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <section className={styles.group} aria-label="Always on">
            <h2 className={styles.groupTitle}>Always on</h2>
            <ul className={styles.list}>
              {ALWAYS_ON.map((item) => (
                <li key={item.title} className={styles.alwaysOn}>
                  <span className={styles.text}>
                    <span className={styles.title}>
                      {item.title}
                      <span className={styles.badge} data-tone="on">
                        Always on
                      </span>
                    </span>
                    <span className={styles.description}>{item.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {save.isError ? (
            <Alert variant="danger" title="Modules could not be saved">
              {save.error instanceof Error ? save.error.message : 'Try again.'}
            </Alert>
          ) : null}
          {canUpdate ? (
            <div className={styles.bar}>
              <span className={styles.barText} aria-live="polite">
                {changed.length === 0
                  ? 'No unsaved changes.'
                  : `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}: ${changed
                      .map((key) => `${MODULES[key].title} ${changes[key] ? 'on' : 'off'}`)
                      .join(', ')}.`}
              </span>
              <Button
                variant="secondary"
                disabled={changed.length === 0 || save.isPending}
                onClick={() => setDraft({})}
              >
                Undo changes
              </Button>
              <Button disabled={changed.length === 0 || save.isPending} onClick={submit}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          ) : (
            <Button disabled>Save changes</Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmOpen}
        danger
        title="Turn modules off?"
        message={`${turningOff.map((key) => MODULES[key].title).join(', ')} will be hidden for every staff member and customer until switched back on. No data is deleted.`}
        confirmLabel="Turn off"
        confirmLoading={save.isPending}
        confirmLoadingLabel="Saving…"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => save.mutate(changes)}
      />
    </section>
  );
}
