import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  RECOVERY_SENT_MESSAGE,
  buildRecoveryRedirect,
  classifyRecoveryRequestError,
  isValidRecoveryEmail,
} from '@jad/shared';
import { Alert, AuthLayout, Button, TextField } from '@jad/ui';

import { env } from '../../lib/env';
import { getSupabaseClient } from '../../lib/supabase';
import styles from './auth.module.css';

/**
 * Customer forgot-password: request a Supabase Auth recovery email.
 *
 * Separate from account activation on purpose: activation redeems a
 * staff-issued onboarding token for a member with no Auth account yet, while
 * recovery works only through Supabase Auth ownership for a member who
 * already has one. Onboarding tokens are never accepted here.
 *
 * The redirect is built from the configured public origin (`VITE_WEB_URL` +
 * `/customer/reset-password`) through the shared validator. The success
 * sentence is identical whether or not the address exists.
 */
export function CustomerForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

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
        env.VITE_WEB_URL,
        '/customer/reset-password',
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
      lead="Enter the email you signed up with and we will send you a link to choose a new password."
      brandTitle="Your farm membership, in your pocket."
      brandLead="Track points, view your digital membership card, and follow your payments."
    >
      {sent ? (
        <div className={styles.resultPanel}>
          <Alert variant="success" title="Check your inbox">
            {RECOVERY_SENT_MESSAGE}
          </Alert>
          <p className={styles.prompt}>
            <Link className={styles.promptLink} to="/customer/login">
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
            id="customer-forgot-email"
            name="customer-forgot-email"
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
            <Link className={styles.promptLink} to="/customer/login">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
