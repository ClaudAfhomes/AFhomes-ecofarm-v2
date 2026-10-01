import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { validateRecoveryPassword } from '@jad/shared';
import { Alert, AuthLayout, Button, PasswordField } from '@jad/ui';

import { getSupabaseClient } from '../../lib/supabase';
import styles from '../customer/auth.module.css';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

/**
 * OST reset-password: the recovery-link landing page. Same session rules as
 * the customer reset page; on completion the seller returns to OST Login.
 */
export function OstResetPasswordPage() {
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
      brandTitle="Sell the farm you believe in."
      brandLead="Your pipeline, your referral code, and your network."
    >
      {phase === 'done' ? (
        <div className={styles.resultPanel}>
          <Alert variant="success" title="Password updated">
            Your password has been updated. Sign in with your new password.
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to="/ost/login">
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
            id="ost-reset-password"
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
            id="ost-reset-confirm"
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
            <Link className={styles.promptLink} to="/ost/forgot-password">
              Request a new link
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
