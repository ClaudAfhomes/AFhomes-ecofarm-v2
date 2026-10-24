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
export function AdminForbiddenPage({ retry }: { retry?: () => void }) {
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
        <p className={styles.deniedCode}>Error 403</p>
        <h1 id="denied-title" className={styles.deniedTitle}>
          Access denied
        </h1>
        <p className={styles.deniedText}>
          Your role cannot open this section. Contact your administrator for access.
        </p>
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
