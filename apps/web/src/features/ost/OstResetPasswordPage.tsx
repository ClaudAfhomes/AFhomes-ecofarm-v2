import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { validateRecoveryPassword } from '@afhomes/shared';
import { Alert, AuthLayout, Button, PasswordField } from '@afhomes/ui';
import { z } from 'zod';

import { getSupabaseClient } from '../../lib/supabase';
import { request } from '../../lib/api/client';
import { useCustomerSession } from '../../lib/customer-session';
import styles from '../customer/auth.module.css';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

/**
 * OST reset-password: the recovery-link landing page. Same session rules as
 * the customer reset page; on completion the seller returns to OST Login.
 */
export function OstResetPasswordPage({ firstLogin = false }: { firstLogin?: boolean }) {
  const { signOut } = useCustomerSession();
  const linkError =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('error') !== null;
  const [phase, setPhase] = useState<Phase>(() => {
    if (!getSupabaseClient() || linkError) return 'invalid';
    return 'checking';
  });
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
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
    if (firstLogin && !currentPassword) {
      setFieldError('Enter your temporary password.');
      return;
    }
    if (firstLogin && currentPassword === password) {
      setFieldError('Choose a password different from your temporary password.');
      return;
    }
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
      if (firstLogin) {
        await request('/admin/afhomes/session/password', z.object({ changed: z.literal(true) }), {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword: password }),
        });
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
      }
      await signOut().catch(() => undefined);
      setPassword('');
      setCurrentPassword('');
      setConfirm('');
      setPhase('done');
      setPending(false);
    } catch {
      setServerError(
        firstLogin
          ? 'We could not update your password. Check your temporary password and try again.'
          : 'We could not update your password. Request a new link and try again.',
      );
      setPending(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="AFHomes Ecofarm"
      title={firstLogin ? 'Create your own password' : 'Choose a new password'}
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
          {firstLogin ? 'Checking your session…' : 'Checking your recovery link…'}
        </p>
      ) : phase === 'ready' ? (
        <form onSubmit={onSubmit} className={styles.form} noValidate>
          {serverError && (
            <Alert variant="danger" title="We could not update your password">
              {serverError}
            </Alert>
          )}
          {firstLogin && (
            <PasswordField
              id="ost-current-password"
              label="Temporary password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
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
              {firstLogin ? 'Save password' : 'Update password'}
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.resultPanel}>
          <Alert
            variant="danger"
            title={
              firstLogin
                ? 'Sign in to create your password'
                : 'Recovery link is invalid or has expired'
            }
          >
            {firstLogin
              ? 'Use the email and temporary password provided by your administrator.'
              : 'Recovery links are single-use.'}
          </Alert>
          <p className={styles.prompt}>
            <Link
              className={styles.promptLink}
              to={firstLogin ? '/ost/login' : '/ost/forgot-password'}
            >
              {firstLogin ? 'Back to sign in' : 'Request a new link'}
            </Link>
          </p>
        </div>
      )}
    </AuthLayout>
  );
}
