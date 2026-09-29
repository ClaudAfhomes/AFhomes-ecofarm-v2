import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, PasswordField, TextField } from '@jad/ui';

import { useSession } from '../../lib/session';
import styles from './AdminLoginPage.module.css';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const requested = (location.state as { from?: string } | null)?.from;
  const destination =
    requested?.startsWith('/admin') && requested !== '/admin/login' ? requested : '/admin';

  if (status === 'authenticated') return <Navigate to={destination} replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const nextErrors: { email?: string; password?: string } = {};
    if (!email.trim()) nextErrors.email = 'Enter your staff email address.';
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
      navigate(destination, { replace: true });
    } catch {
      setServerError('We could not sign you in with that email and password.');
      setPending(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Staff sign in"
      lead="Access the administration and operations console."
      brandTitle="Grow with the farm you own a card in."
      brandLead="Staff console for card sales, payments, memberships, redemptions, and the sales network."
    >
      <form className={styles.form} noValidate onSubmit={onSubmit}>
        {serverError ? (
          <Alert variant="danger" title="We could not sign you in">
            {serverError}
          </Alert>
        ) : null}

        <TextField
          id="admin-login-email"
          name="email"
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
          id="admin-login-password"
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
          <Link className={styles.textLink} to="/admin/forgot-password">
            Forgot your password?
          </Link>
        </div>

        <div className={styles.submitRow}>
          <Button type="submit" loading={pending} disabled={pending || status === 'loading'}>
            Sign in
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
