import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { validateRecoveryPassword } from '@afhomes/shared';
import { Alert, AuthLayout, Button, PasswordField } from '@afhomes/ui';

import { getSupabaseClient } from '../../lib/supabase';
import styles from './AdminLoginPage.module.css';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

/**
 * Staff reset-password: the recovery-link landing page.
 *
 * Supabase Auth exchanges the PKCE `code` on load (`detectSessionInUrl`); the
 * page is usable only while a session exists, so an expired link, a missing
 * session, an already-used link, or a plain refresh with no session all land
 * on the invalid state with a link to request a fresh one. Nothing depends on
 * transient frontend state: the persisted session plus the auth subscription
 * survive a direct refresh.
 *
 * After `updateUser` the recovery session is signed out and the passwords are
 * dropped from memory, so nobody is left holding a privileged session and the
 * next step is the ordinary staff sign-in - where `staff_users` status, role
 * assignment and role activity are enforced again. Recovery changes the
 * password only; it cannot reactivate a suspended business account.
 *
 * The `portal` prop reuses this page for the staff entry: the user returns to
 * the Staff Login, never the Administration Login.
 */
export function AdminResetPasswordPage({ portal = 'admin' }: { portal?: 'admin' | 'staff' }) {
  const loginPath = portal === 'staff' ? '/staff/login' : '/admin/login';
  const forgotPath = portal === 'staff' ? '/staff/forgot-password' : '/admin/forgot-password';
  // An explicit `?error=` from Supabase wins over any coincidental session:
  // it means THIS recovery attempt failed, so a stale session must not
  // upgrade the page to ready.
  const linkError =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('error') !== null;
  const [phase, setPhase] = useState<Phase>(() => {
    if (!getSupabaseClient() || linkError) return 'invalid';
    return 'checking';
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient();
    if (!client) return;
    client.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        if (data.session && !linkError) {
          // The code has served its purpose: keep it out of the address bar
          // (and out of history) from here on.
          window.history.replaceState(null, '', window.location.pathname);
          setPhase('ready');
        } else {
          setPhase('invalid');
        }
      })
      .catch(() => {
        if (mounted) setPhase('invalid');
      });
    const { data: subscription } = client.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        window.history.replaceState(null, '', window.location.pathname);
        setPhase('ready');
      } else if (event === 'SIGNED_OUT') {
        setPhase((current) => (current === 'done' ? current : 'invalid'));
      }
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [linkError]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const policyError = validateRecoveryPassword(password);
    if (policyError) {
      setFieldError(policyError);
      return;
    }
    if (confirm !== password) {
      setFieldError('The passwords do not match.');
      return;
    }
    setFieldError(null);
    setServerError(null);
    setPending(true);
    try {
      const client = getSupabaseClient();
      if (!client) {
        setServerError('Password recovery is not available right now.');
        setPending(false);
        return;
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setServerError('We could not update your password. Request a new link and try again.');
        setPending(false);
        return;
      }
      // Best-effort: the recovery session must not survive the reset.
      await client.auth.signOut().catch(() => undefined);
      setPassword('');
      setConfirm('');
      setPhase('done');
      setPending(false);
    } catch {
      setServerError('We could not update your password. Request a new link and try again.');
      setPending(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Choose a new password"
      brandTitle="Grow with the farm you own a card in."
      brandLead="Staff console for card sales, payments, memberships, redemptions, and the sales network."
    >
      {phase === 'done' ? (
        <div className={styles.resultPanel}>
          <Alert variant="success" title="Password updated">
            Your password has been updated. Sign in with your new password.
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to={loginPath}>
              Back to sign in
            </Link>
          </p>
        </div>
      ) : phase === 'checking' ? (
        <p className={styles.prompt} role="status">
          Checking your recovery link…
        </p>
      ) : phase === 'ready' ? (
        <form onSubmit={onSubmit} className={styles.form} noValidate>
          {serverError && (
            <Alert variant="danger" title="We could not update your password">
              {serverError}
            </Alert>
          )}
          <PasswordField
            id="admin-reset-password"
            label="New password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setFieldError(null);
            }}
            autoComplete="new-password"
            error={fieldError ?? undefined}
          />
          <PasswordField
            id="admin-reset-confirm"
            label="Confirm new password"
            value={confirm}
            onChange={(value) => {
              setConfirm(value);
              setFieldError(null);
            }}
            autoComplete="new-password"
          />
          <p className={styles.note}>
            At least 10 characters, with a lowercase letter, an uppercase letter and a digit.
          </p>
          <div className={styles.submitRow}>
            <Button type="submit" loading={pending} disabled={pending}>
              Update password
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.resultPanel}>
          <Alert variant="danger" title="Recovery link is invalid or has expired">
            Recovery links are single-use.
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to={forgotPath}>
              Request a new link
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}

export function StaffResetPasswordPage() {
  return <AdminResetPasswordPage portal="staff" />;
}
