import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AuthPortals } from '@jad/contracts';
import { Alert, Button, PasswordField, TextField, TurnstileChallenge } from '@jad/ui';
import { env } from '../../lib/env';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import { portalDashboard } from '../../lib/portal-destination';
import styles from './auth.module.css';

type PostLogin = CustomerDecision;

/**
 * Shared customer-login form: validation, generic failure, and post-login
 * identity routing. Rendered on the homepage split and on `/customer/login`.
 *
 * After Supabase authentication the server identity is probed
 * (`GET /auth/portals`) and the shared resolver picks the destination:
 * a customer goes home; staff and OST identities replace-route to their
 * authorized dashboard; anything else fails closed with a sign-out. Email/password
 * validation failures stay indistinguishable to block enumeration.
 */
export function CustomerLoginForm() {
  const navigate = useNavigate();
  const { signIn, signOut } = useCustomerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [postLogin, setPostLogin] = useState<PostLogin | null>(null);
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
    setPostLogin(null);
    setPending(true);
    try {
      if (env.VITE_TURNSTILE_SITE_KEY) {
        if (!captchaToken) throw new Error('Complete security verification.');
        await signIn(email, password, captchaToken);
      } else await signIn(email, password);
      const portals = await getAuthPortals();
      const next = decideCustomerLogin(portals);
      if (next.kind === 'navigate') {
        if (next.to.startsWith('/admin')) window.location.replace(next.to);
        else navigate(next.to, { replace: true });
      } else {
        if (next.signOut) await signOut();
        setPostLogin(next);
      }
    } catch {
      // A single generic message, and the underlying error is deliberately not
      // rendered: distinguishing "no such user" from "wrong password" would let
      // anyone enumerate registered customers. Nothing is logged either - the
      // submitted password must never reach a log sink.
      setServerError('We could not sign you in with that email and password.');
    } finally {
      setPending(false);
      setCaptchaToken(null);
      setCaptchaVersion((v) => v + 1);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className={styles.form}>
      {serverError && (
        <Alert variant="danger" title="We could not sign you in">
          {serverError}
        </Alert>
      )}
      {postLogin?.kind === 'notice' && (
        <Alert variant="warning" title="Use the right portal">
          {postLogin.message}{' '}
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
        Not activated yet?{' '}
        <Link className={styles.promptLink} to="/customer/activate">
          Activate your membership
        </Link>
      </p>
      <div className={styles.divider} aria-hidden="true" />
      <p className={styles.note}>Use the email address on your membership record.</p>
    </form>
  );
}

type CustomerDecision =
  { kind: 'navigate'; to: string } | { kind: 'notice'; message: string; signOut?: boolean };

export function decideCustomerLogin(portals: AuthPortals): CustomerDecision {
  const dashboard = portalDashboard(portals, 'customer');
  return dashboard
    ? { kind: 'navigate', to: dashboard }
    : {
        kind: 'notice',
        message: 'No customer access is assigned to this account. Contact AF Homes for assistance.',
        signOut: true,
      };
}
