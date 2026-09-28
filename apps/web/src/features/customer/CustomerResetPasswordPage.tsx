import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { validateRecoveryPassword } from '@jad/shared';
import { Button } from '@jad/ui';

import { getSupabaseClient } from '../../lib/supabase';
import { styles } from './portal-ui';
import authStyles from './auth.module.css';

type Phase = 'checking' | 'ready' | 'invalid' | 'done';

/**
 * Customer reset-password: the recovery-link landing page.
 *
 * Usable only while a Supabase Auth session exists (the PKCE `code` is
 * exchanged on load): expired, missing, already-used, or absent sessions all
 * render the invalid state, and a direct refresh re-resolves from the
 * persisted session rather than transient state. After `updateUser` the
 * session is signed out and the passwords are cleared, so the member
 * continues through the ordinary customer sign-in - where the server still
 * requires a linked customer in an allowed state. Recovery changes the
 * password only.
 */
export function CustomerResetPasswordPage() {
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
    <main className={authStyles.auth}>
      <div className={authStyles.panel}>
        <p className={styles.eyebrow}>AF Homes Ecofarm</p>
        <h1 className={authStyles.title}>Choose a new password</h1>

        {phase === 'done' ? (
          <>
            <p className={authStyles.body} role="status">
              Your password has been updated. Sign in with your new password.
            </p>
            <p className={authStyles.body}>
              <Link to="/customer/login">Back to sign in</Link>
            </p>
          </>
        ) : phase === 'checking' ? (
          <p className={authStyles.body} role="status">
            Checking your recovery link…
          </p>
        ) : phase === 'ready' ? (
          <>
            {serverError && (
              <p className={authStyles.error} role="alert">
                {serverError}
              </p>
            )}
            <form onSubmit={onSubmit} className={authStyles.form}>
              <label className={authStyles.label} htmlFor="customer-reset-password">
                New password
              </label>
              <input
                id="customer-reset-password"
                name="customer-reset-password"
                className={authStyles.input}
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFieldError(null);
                }}
                autoComplete="new-password"
                required
                minLength={10}
              />
              <label className={authStyles.label} htmlFor="customer-reset-confirm">
                Confirm new password
              </label>
              <input
                id="customer-reset-confirm"
                name="customer-reset-confirm"
                className={authStyles.input}
                type="password"
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value);
                  setFieldError(null);
                }}
                autoComplete="new-password"
                required
                minLength={10}
              />
              {fieldError && (
                <p className={authStyles.error} role="alert">
                  {fieldError}
                </p>
              )}
              <p className={authStyles.hint}>
                At least 10 characters, with a lowercase letter, an uppercase letter and a digit.
              </p>
              <Button type="submit" disabled={pending}>
                {pending ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className={authStyles.body} role="alert">
              This recovery link is invalid or has expired. Recovery links are single-use.
            </p>
            <p className={authStyles.body}>
              <Link to="/customer/forgot-password">Request a new link</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
