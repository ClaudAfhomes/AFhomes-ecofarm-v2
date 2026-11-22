import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, ConfirmDialog, Icon } from '@afhomes/ui';
import { useSession } from '../lib/session';
import { logoutUrlForRole } from '../lib/portal';
import { staffPortalPath } from '@afhomes/contracts';
import logo from '../assets/logo.png';
import styles from './AdminForbiddenPage.module.css';

/**
 * Standalone denied page (no sidebar, no topbar).
 *
 * Rendered by `AdminLayout` when the session cannot access the current
 * path. `RequireRole` remains the server-boundary guard; this is the
 * professional full-page surface for that denial.
 */
const COPY = {
  role: {
    code: 'Error 403',
    title: 'Access denied',
    text: 'Your role cannot open this section. Contact your administrator for access.',
  },
  'switched-off': {
    code: 'Module off',
    title: 'This module is switched off',
    text: 'An administrator has turned this module off for everyone. It will be back when it is switched on again under Organization → Modules.',
  },
  session: {
    code: 'Not loaded',
    title: 'We could not check your access',
    text: 'Your account details did not load, so this page cannot open yet. Check your connection and try again.',
  },
} as const;

export type ForbiddenReason = keyof typeof COPY;

export function AdminForbiddenPage({
  retry,
  reason = 'role',
}: {
  retry?: () => void;
  reason?: ForbiddenReason;
}) {
  const copy = COPY[reason];
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);

  return (
    <main className={styles.deniedRoot}>
      <section className={styles.deniedCard} aria-labelledby="denied-title">
        <img src={logo} alt="AFhomes logo" className={styles.deniedLogo} />
        <span className={styles.deniedShield} aria-hidden="true">
          <Icon name="alert" size={28} />
        </span>
        <p className={styles.deniedCode}>{copy.code}</p>
        <h1 id="denied-title" className={styles.deniedTitle}>
          {copy.title}
        </h1>
        <p className={styles.deniedText}>{copy.text}</p>
        <div className={styles.deniedActions}>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(staffPortalPath(user?.roleSlug, '/admin/profile'))}
          >
            My account
          </Button>
          {retry ? <Button onClick={() => void retry()}>Retry</Button> : null}
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Sign out
          </Button>
        </div>
        {user ? (
          <p className={styles.deniedMeta}>
            Signed in as {user.name} · {user.roleName}
          </p>
        ) : null}
      </section>
      <ConfirmDialog
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          const target = logoutUrlForRole(user?.roleSlug);
          setConfirm(false);
          void logout().finally(() => window.location.replace(target));
        }}
        title="Sign out?"
        message="Sign out of AFhomes administration?"
        confirmLabel="Sign out"
        cancelLabel="Cancel"
      />
    </main>
  );
}
