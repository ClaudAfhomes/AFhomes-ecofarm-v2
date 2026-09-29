import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import {
  RECOVERY_SENT_MESSAGE,
  buildRecoveryRedirect,
  classifyRecoveryRequestError,
  isValidRecoveryEmail,
} from '@jad/shared';
import { Alert, AuthLayout, Button, TextField } from '@jad/ui';

import { env } from '../../lib/env';
import { useSession } from '../../lib/session';
import { getSupabaseClient } from '../../lib/supabase';
import styles from './AdminLoginPage.module.css';

/**
 * Staff forgot-password: request a Supabase Auth recovery email.
 *
 * The redirect is built from the configured admin origin
 * (`VITE_ADMIN_URL` + `/reset-password`) through the shared validator, so a
 * stale localhost default or a crafted value can never become a production
 * redirect. The success sentence is identical whether or not the address
 * exists - distinguishing the two would enumerate staff accounts. No
 * service-role API is involved; delivery is Supabase Auth email only.
 */
export function AdminForgotPasswordPage() {
  const { status } = useSession();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  if (status === 'authenticated') return <Navigate to="/admin" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const trimmed = email.trim();
    if (!isValidRecoveryEmail(trimmed)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(null);
    setServerError(null);
    setPending(true);
    try {
      const client = getSupabaseClient();
      if (!client) {
        setServerError('Password reset is unavailable right now. Please try again later.');
        setPending(false);
        return;
      }
      const redirectTo = buildRecoveryRedirect(
        env.VITE_ADMIN_URL,
        '/reset-password',
        window.location.origin,
      );
      const { error } = await client.auth.resetPasswordForEmail(trimmed, { redirectTo });
      if (error) {
        const outcome = classifyRecoveryRequestError(error);
        if (outcome === 'sent') {
          setSent(true);
        } else if (outcome === 'rate-limited') {
          setServerError('Too many attempts. Please wait a little while and try again.');
        } else if (outcome === 'unavailable') {
          setServerError('Password reset is unavailable right now. Please try again later.');
        } else {
          setServerError('We could not send a password reset email. Please try again.');
        }
        setPending(false);
        return;
      }
      setSent(true);
      setPending(false);
    } catch {
      setServerError('Password reset is unavailable right now. Please try again later.');
      setPending(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Reset your password"
      lead="Enter your staff email and we will send you a link to choose a new password."
      brandTitle="Grow with the farm you own a card in."
      brandLead="Staff console for card sales, payments, memberships, redemptions, and the sales network."
    >
      {sent ? (
        <div className={styles.resultPanel}>
          <Alert variant="success" title="Check your inbox">
            {RECOVERY_SENT_MESSAGE}
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to="/admin/login">
              Back to sign in
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className={styles.form}>
          {serverError && (
            <Alert variant="danger" title="We could not send the reset email">
              {serverError}
            </Alert>
          )}
          <TextField
            id="admin-forgot-email"
            name="email"
            label="Email"
            type="email"
            value={email}
            onChange={(value) => {
              setEmail(value);
              setEmailError(null);
            }}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            error={emailError ?? undefined}
          />
          <div className={styles.submitRow}>
            <Button type="submit" loading={pending} disabled={pending}>
              Send reset link
            </Button>
          </div>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to="/admin/login">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
