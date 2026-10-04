import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { resolvePortalDestination, type AuthPortals } from '@jad/contracts';
import { Alert, Button, PasswordField, TextField } from '@jad/ui';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import styles from './auth.module.css';

type PostLogin =
  | { kind: 'navigate'; to: string }
  | { kind: 'notice'; message: string; linkTo: string; linkLabel: string; external?: boolean }
  | { kind: 'chooser'; options: { label: string; to: string; external?: boolean }[] };

/**
 * Shared customer-login form: validation, generic failure, and post-login
 * identity routing. Rendered on the homepage split and on `/customer/login`.
 *
 * After Supabase authentication the server identity is probed
 * (`GET /auth/portals`) and the shared resolver picks the destination:
 * a customer goes home; a staff-only sign-in is told plainly it belongs to
 * a staff user (never a generic customer error); a dual identity gets a
 * chooser; anything else fails closed with a sign-out. Email/password
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
      await signIn(email, password);
      const portals = await getAuthPortals();
      const next = decideCustomerLogin(portals);
      if (next.kind === 'navigate') {
        navigate(next.to, { replace: true });
      } else if (next.kind === 'chooser') {
        setPostLogin(next);
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
    }
  };

  if (postLogin?.kind === 'chooser') {
    return <PortalChooser options={postLogin.options} onBack={() => setPostLogin(null)} />;
  }

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
          {postLogin.external ? (
            <a className={styles.promptLink} href={postLogin.linkTo} rel="noreferrer">
              {postLogin.linkLabel}
            </a>
          ) : (
            <Link className={styles.promptLink} to={postLogin.linkTo}>
              {postLogin.linkLabel}
            </Link>
          )}
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

      <p className={styles.footnote}>
        Are you an AF Homes employee?{' '}
        <a className={styles.promptLink} href="/staff/login">
          Staff Login
        </a>{' '}
        · OST?{' '}
        <Link className={styles.promptLink} to="/ost/login">
          OST Login
        </Link>
      </p>
    </form>
  );
}

function PortalChooser({
  options,
  onBack,
}: {
  options: { label: string; to: string; external?: boolean }[];
  onBack: () => void;
}) {
  return (
    <div className={styles.form}>
      <Alert variant="warning" title="Choose portal">
        This sign-in belongs to more than one AF Homes account. Continue as:
      </Alert>
      {options.map((option) =>
        option.external ? (
          <p key={option.label} className={styles.prompt}>
            <a className={styles.promptLink} href={option.to}>
              {option.label}
            </a>
          </p>
        ) : (
          <p key={option.label} className={styles.prompt}>
            <Link className={styles.promptLink} to={option.to}>
              {option.label}
            </Link>
          </p>
        ),
      )}
      <p className={styles.prompt}>
        <Button variant="secondary" onClick={onBack}>
          Back to sign in
        </Button>
      </p>
    </div>
  );
}

type CustomerDecision =
  | { kind: 'navigate'; to: string }
  | {
      kind: 'notice';
      message: string;
      linkTo: string;
      linkLabel: string;
      external?: boolean;
      signOut?: boolean;
    }
  | { kind: 'chooser'; options: { label: string; to: string; external?: boolean }[] };

/**
 * Pure post-login decision for the customer entry. Unit-testable; the
 * component only renders it.
 */
export function decideCustomerLogin(portals: AuthPortals): CustomerDecision {
  const destination = resolvePortalDestination({
    staffRole: portals.staff?.roleSlug ?? null,
    mustChangePassword: portals.staff?.mustChangePassword === true,
    hasCustomer: portals.customer !== null,
    hasActiveCustomer: portals.customer?.status === 'active',
    ostStatus: portals.ost?.status ?? null,
  });
  switch (destination) {
    case 'customer':
      return { kind: 'navigate', to: '/customer' };
    case 'ost':
      return {
        kind: 'notice',
        message: 'This sign-in belongs to an OST seller.',
        linkTo: '/ost/login',
        linkLabel: 'Go to OST Login',
      };
    case 'password-change':
    case 'staff':
      return {
        kind: 'notice',
        message: 'This account belongs to an AF Homes staff user.',
        linkTo: '/staff/login',
        linkLabel: 'Go to Staff Login',
        external: true,
      };
    case 'admin':
      return {
        kind: 'notice',
        message: 'This account belongs to an AF Homes staff user.',
        linkTo: '/admin/login',
        linkLabel: 'Go to Administration Login',
        external: true,
      };
    case 'chooser-customer-staff':
      return {
        kind: 'chooser',
        options: [
          { label: 'Customer / Member', to: '/customer' },
          { label: 'Staff', to: '/staff/login', external: true },
        ],
      };
    case 'chooser-customer-admin':
      return {
        kind: 'chooser',
        options: [
          { label: 'Customer / Member', to: '/customer' },
          { label: 'Administration', to: '/admin/login', external: true },
        ],
      };
    case 'pending-ost':
      return {
        kind: 'notice',
        message: 'Your OST application is still awaiting approval.',
        linkTo: '/ost/register',
        linkLabel: 'Check registration',
        signOut: true,
      };
    case 'no-portal':
    default:
      // Valid Auth, no AF Homes identity: fail closed and drop the session so
      // it cannot linger on a portal it does not belong to.
      return {
        kind: 'notice',
        message: 'We could not sign you in with that email and password.',
        linkTo: '/customer/login',
        linkLabel: 'Try again',
        signOut: true,
      };
  }
}
