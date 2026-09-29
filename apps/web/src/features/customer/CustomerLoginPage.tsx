import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, PasswordField, TextField } from '@jad/ui';

import { useCustomerSession } from '../../lib/customer-session';
import { env } from '../../lib/env';
import styles from './auth.module.css';

/**
 * Customer sign-in.
 *
 * Ordinary Supabase Auth `signInWithPassword` through the anon client. No
 * custom JWT, no server-minted token, and the staff console lives behind a
 * different path with its own guard, so a customer cannot land in the admin area
 * by signing in here - and a staff member who signs in here is told plainly that
 * they belong in the administration console (the portal shell renders that state
 * when the API answers 403).
 *
 * On success the member returns to wherever the guard intercepted them, defaulting
 * to the dashboard.
 */
export function CustomerLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useCustomerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const from =
    (location.state as { from?: string } | null)?.from?.startsWith('/customer')
      ? (location.state as { from: string }).from
      : '/customer';

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const nextErrors: { email?: string; password?: string } = {};
    if (!email.trim()) nextErrors.email = 'Enter your email address.';
    if (!password) nextErrors.password = 'Enter your password.';
    setErrors(nextErrors);
    if (nextErrors.email) {
      emailRef.current?.focus();
      return;
    }
    if (nextErrors.password) {
      passwordRef.current?.focus();
      return;
    }
    setServerError(null);
    setPending(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch {
      // A single generic message, and the underlying error is deliberately not
      // rendered: distinguishing "no such user" from "wrong password" would let
      // anyone enumerate registered customers. Nothing is logged either - the
      // submitted password must never reach a log sink.
      setServerError('We could not sign you in with that email and password.');
      setPending(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Sign in"
      lead="Access your membership card and points."
      brandTitle="Your farm membership, in your pocket."
      brandLead="Track points, view your digital membership card, and follow your payments."
    >
      <form onSubmit={onSubmit} noValidate className={styles.form}>
        {serverError && (
          <Alert variant="danger" title="We could not sign you in">
            {serverError}
          </Alert>
        )}

        <TextField
          id="login-email"
          name="login-email"
          label="Email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setErrors((current) =>
              current.email !== undefined ? { ...current, email: undefined } : current,
            );
            setServerError(null);
          }}
          autoComplete="username"
          inputMode="email"
          inputRef={emailRef}
          placeholder="you@example.com"
          error={errors.email}
        />

        <PasswordField
          id="login-password"
          label="Password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setErrors((current) =>
              current.password !== undefined ? { ...current, password: undefined } : current,
            );
            setServerError(null);
          }}
          autoComplete="current-password"
          inputRef={passwordRef}
          placeholder="Password"
          error={errors.password}
        />

        <div className={styles.utilityRow}>
          <Link className={styles.textLink} to="/customer/forgot-password">
            Forgot your password?
          </Link>
        </div>

        <div className={styles.submitRow}>
          <Button type="submit" loading={pending} disabled={pending}>
            Sign in
          </Button>
        </div>

        <p className={styles.prompt}>
          Received an activation code?{' '}
          <Link className={styles.promptLink} to="/customer/activate">
            Activate your account
          </Link>
        </p>

        <p className={styles.footnote}>
          Staff member? Use the{' '}
          <a href={env.VITE_ADMIN_URL} rel="noreferrer">
            administration console
          </a>{' '}
          instead.
        </p>
      </form>
    </AuthLayout>
  );
}
