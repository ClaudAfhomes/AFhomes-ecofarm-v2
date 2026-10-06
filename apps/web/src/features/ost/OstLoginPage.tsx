import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, PasswordField, TextField, TurnstileChallenge } from '@afhomes/ui';
import { env } from '../../lib/env';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import styles from '../customer/auth.module.css';

/**
 * OST sign-in. OST sellers authenticate with the same Supabase Auth as
 * everyone else, then prove an APPROVED OST record (`GET /ost/me`): a pending
 * applicant has no member row and cannot enter, and an OST record never
 * implies a staff capability.
 */
export function OstLoginPage() {
  const navigate = useNavigate();
  const { signIn } = useCustomerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

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
      if (env.VITE_TURNSTILE_SITE_KEY) {
        if (!captchaToken) throw new Error('Complete security verification.');
        await signIn(email, password, captchaToken);
      } else await signIn(email, password);
      const portals = await getAuthPortals();
      if (portals.ost?.status === 'active') {
        navigate('/ost/dashboard', { replace: true });
        return;
      }
      if (portals.ost) {
        setServerError(
          `Your OST record is ${portals.ost.status}. Contact your sponsoring Sales Manager to restore access.`,
        );
      } else if (portals.staff || portals.customer) {
        setServerError('This sign-in has no approved OST record. Use your own portal instead.');
      } else {
        setServerError('We could not sign you in with that email and password.');
      }
      setPending(false);
    } catch {
      setServerError('We could not sign you in with that email and password.');
      setPending(false);
    } finally {
      setCaptchaToken(null);
      setCaptchaVersion((v) => v + 1);
    }
  };

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="OST Login"
      lead="Sellers approved under a Sales Manager sign in here."
      brandTitle="Sell the farm you believe in."
      brandLead="Your pipeline, your referral code, and your network - once your application is approved."
    >
      <form onSubmit={onSubmit} noValidate className={styles.form}>
        {serverError && (
          <Alert variant="danger" title="We could not sign you in">
            {serverError}
          </Alert>
        )}

        <TextField
          id="ost-login-email"
          name="ost-login-email"
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
          id="ost-login-password"
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
          <Link className={styles.textLink} to="/ost/forgot-password">
            Forgot your password?
          </Link>
        </div>

        <div className={styles.submitRow}>
          <TurnstileChallenge
            siteKey={env.VITE_TURNSTILE_SITE_KEY}
            onToken={setCaptchaToken}
            resetVersion={captchaVersion}
          />
          <Button loadingLabel="Signing in…" type="submit" loading={pending} disabled={pending}>
            Sign in
          </Button>
        </div>

        <p className={styles.prompt}>
          Don&apos;t have an OST account?{' '}
          <Link className={styles.promptLink} to="/ost/register">
            Register as OST
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
