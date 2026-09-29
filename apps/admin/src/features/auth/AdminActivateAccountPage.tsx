import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { afHomesSessionSchema, staffAccountSetupSchema } from '@jad/contracts';
import type { StaffAccountSetup } from '@jad/contracts';
import { validateRecoveryPassword } from '@jad/shared';
import { Alert, AuthLayout, Button, PasswordField, TextField } from '@jad/ui';

import { request } from '../../lib/api/client';
import { getSupabaseClient } from '../../lib/supabase';
import styles from './AdminLoginPage.module.css';

type Phase = 'checking' | 'ready' | 'invalid' | 'done' | 'password-created';

function inviteLinkHasError(): boolean {
  if (typeof window === 'undefined') return false;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return (
    search.has('error') || search.has('error_code') || hash.has('error') || hash.has('error_code')
  );
}

/**
 * Staff invitation landing page. Supabase owns link verification and password
 * storage. The AF Homes API only confirms that the current invite session is
 * bound to an invited staff profile, and later activates that same profile
 * from a freshly password-authenticated session.
 */
export function AdminActivateAccountPage() {
  const linkError = inviteLinkHasError();
  const [phase, setPhase] = useState<Phase>(() =>
    !getSupabaseClient() || linkError ? 'invalid' : 'checking',
  );
  const [candidate, setCandidate] = useState<StaffAccountSetup | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient();
    if (!client || linkError) return;
    const check = async () => {
      try {
        const { data } = await client.auth.getSession();
        if (!mounted) return;
        if (!data.session) {
          setPhase('invalid');
          return;
        }
        const setup = await request('/admin/afhomes/account-activation', staffAccountSetupSchema);
        if (!mounted) return;
        window.history.replaceState(null, '', window.location.pathname);
        setCandidate(setup);
        setPhase('ready');
      } catch {
        if (mounted) setPhase('invalid');
      }
    };
    void check();
    return () => {
      mounted = false;
    };
  }, [linkError]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !candidate) return;
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
    const client = getSupabaseClient();
    if (!client) {
      setPhase('invalid');
      setPending(false);
      return;
    }

    let passwordCreated = false;
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) {
        setServerError(
          'We could not create your password. Ask your administrator for a new invitation.',
        );
        setPending(false);
        return;
      }
      passwordCreated = true;

      // Drop the invite-authenticated session. A new password sign-in produces
      // a verified `amr: password` token; only that token may activate the
      // business profile in the server-side principal resolver.
      await client.auth.signOut();
      const { error: signInError } = await client.auth.signInWithPassword({
        email: candidate.email,
        password,
      });
      if (signInError) throw signInError;
      const session = await request('/admin/afhomes/session', afHomesSessionSchema);
      if (session.id !== candidate.id || session.email !== candidate.email) {
        throw new Error('Activated session did not match the invitation');
      }
      await client.auth.signOut();
      setPassword('');
      setConfirm('');
      setPhase('done');
    } catch {
      await client.auth.signOut().catch(() => undefined);
      setPassword('');
      setConfirm('');
      if (passwordCreated) {
        setServerError(
          'Your password was created, but automatic activation could not finish. Sign in with your new password to continue.',
        );
        setPhase('password-created');
      } else {
        setServerError(
          'We could not create your password. Ask your administrator for a new invitation.',
        );
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Set Up Your Staff Account"
      lead="Your invitation has been verified. Create a password to finish setting up your account."
      brandTitle="Grow with the farm you own a card in."
      brandLead="Staff console for card sales, payments, memberships, redemptions, and the sales network."
    >
      {phase === 'checking' ? (
        <p className={styles.prompt} role="status">
          Checking your invitation…
        </p>
      ) : phase === 'done' ? (
        <div className={styles.resultPanel}>
          <Alert variant="success" title="Account activated">
            Your account has been activated. Sign in using your new password.
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to="/admin/login">
              Return to Staff Login
            </Link>
          </p>
        </div>
      ) : phase === 'password-created' ? (
        <div className={styles.resultPanel}>
          <Alert variant="warning" title="Password created">
            {serverError}
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to="/admin/login">
              Return to Staff Login
            </Link>
          </p>
        </div>
      ) : phase === 'ready' && candidate ? (
        <form onSubmit={onSubmit} className={styles.form} noValidate>
          <TextField
            id="admin-activation-email"
            name="email"
            label="Email"
            type="email"
            value={candidate.email}
            onChange={() => undefined}
            autoComplete="username"
            readOnly
          />
          {serverError && (
            <Alert variant="danger" title="We could not create your password">
              {serverError}
            </Alert>
          )}
          <PasswordField
            id="admin-activation-password"
            label="New Password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setFieldError(null);
            }}
            autoComplete="new-password"
            error={fieldError ?? undefined}
          />
          <PasswordField
            id="admin-activation-confirm"
            label="Confirm Password"
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
              Create Password
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.resultPanel}>
          <Alert variant="danger" title="Invitation link is invalid or has expired.">
            Ask your administrator to send a new invitation.
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to="/admin/login">
              Return to Staff Login
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
