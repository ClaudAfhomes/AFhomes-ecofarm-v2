import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, PasswordField, TextField } from '@jad/ui';
import type { AuthPortals } from '@jad/contracts';

import { useSession } from '../../lib/session';
import { getAuthPortals } from '../../lib/portals';
import {
  decideForPortal,
  rememberEntryPortal,
  webBase,
  type EntryPortal,
  type PortalDecision,
} from '../../lib/portal';
import styles from './AdminLoginPage.module.css';

/**
 * Shared login entry for the staff console's two portals.
 *
 * `/admin/login` serves Super Admin + Admin only; `/staff/login` serves
 * finance, HR, employee, VD, SSM and SM. The split is enforced AFTER Supabase
 * authentication by resolving the staff role server-side (`GET /auth/portals`
 * + the session): a wrong-portal sign-in names the right portal and links
 * straight there instead of failing generically. The session is kept, so the
 * correct entry forwards without retyping a password.
 *
 * No admin link appears on the staff entry and no staff link on the admin
 * entry, except inside a refusal that names exactly that portal.
 */
export function PortalLoginPage({ portal }: { portal: EntryPortal }) {
  const isAdmin = portal === 'admin';
  const navigate = useNavigate();
  const location = useLocation();
  const { status, signIn, logout } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [decision, setDecision] = useState<PortalDecision | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const requested = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    rememberEntryPortal(portal);
  }, [portal]);

  // An already-authenticated session arriving at either entry is routed, not
  // bounced: allowed here it forwards, otherwise it learns the right portal.
  // State updates happen only in the promise callbacks below, never
  // synchronously in the effect body.
  useEffect(() => {
    if (status !== 'authenticated' || decision) return;
    let live = true;
    getAuthPortals()
      .then((portals) => {
        if (live) setDecision(decideForPortal(portal, portals, requested));
      })
      .catch(() => {
        if (live) setServerError('We could not verify this sign-in. Please try again.');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const applyDecision = (next: PortalDecision) => {
    if (next.action === 'forward') {
      navigate(next.to, { replace: true });
      return;
    }
    setDecision(next);
  };

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
    setDecision(null);
    setPending(true);
    try {
      await signIn(email, password);
      const portals: AuthPortals = await getAuthPortals();
      applyDecision(decideForPortal(portal, portals, requested));
    } catch {
      // Generic on purpose: distinguishing unknown user from wrong password
      // would enumerate staff accounts.
      setServerError('We could not sign you in with that email and password.');
    } finally {
      setPending(false);
    }
  };

  // A signed-in identity with no AF Homes home anywhere must not linger with
  // a live session on a login screen.
  useEffect(() => {
    if (decision?.action === 'refuse' && decision.message.includes('no staff identity')) {
      void logout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title={isAdmin ? 'Administration Login' : 'Staff Login'}
      lead={
        isAdmin
          ? 'Restricted to Super Admin and Admin.'
          : 'Finance, HR, operations and the sales network.'
      }
      brandTitle="Grow with the farm you own a card in."
      brandLead="Staff console for card sales, payments, memberships, redemptions, and the sales network."
    >
      {decision?.action === 'refuse' ? (
        <Refusal
          message={decision.message}
          linkTo={decision.linkTo}
          linkLabel={decision.linkLabel}
          onRetry={() => {
            setDecision(null);
            setPassword('');
          }}
        />
      ) : (
        <form className={styles.form} noValidate onSubmit={onSubmit}>
          {serverError ? (
            <Alert variant="danger" title="We could not sign you in">
              {serverError}
            </Alert>
          ) : null}
          {status === 'authenticated' && !decision ? (
            <p className={styles.prompt} role="status">
              Verifying your sign-in…
            </p>
          ) : null}

          <TextField
            id={`${portal}-login-email`}
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
            id={`${portal}-login-password`}
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
            <Link
              className={styles.textLink}
              to={isAdmin ? '/admin/forgot-password' : '/staff/forgot-password'}
            >
              Forgot your password?
            </Link>
          </div>

          <div className={styles.submitRow}>
            <Button
              loadingLabel="Signing in…"
              type="submit"
              loading={pending}
              disabled={pending || status === 'loading'}
            >
              Sign in
            </Button>
          </div>

          {!isAdmin ? (
            <p className={styles.prompt}>
              Member?{' '}
              <a
                className={styles.promptLink}
                href={`${webBase()}/customer/login`}
                rel="noreferrer"
              >
                Customer Login
              </a>{' '}
              · OST?{' '}
              <a className={styles.promptLink} href={`${webBase()}/ost/login`} rel="noreferrer">
                OST Login
              </a>
            </p>
          ) : null}
        </form>
      )}
    </AuthLayout>
  );
}

function Refusal({
  message,
  linkTo,
  linkLabel,
  onRetry,
}: {
  message: string;
  linkTo: string;
  linkLabel: string;
  onRetry: () => void;
}) {
  const internal = linkTo.startsWith('/');
  return (
    <div className={styles.resultPanel}>
      <Alert variant="warning" title="Wrong portal for this account">
        {message}
      </Alert>
      <p className={styles.prompt}>
        {internal ? (
          <Link className={styles.promptLink} to={linkTo}>
            {linkLabel}
          </Link>
        ) : (
          <a className={styles.promptLink} href={linkTo} rel="noreferrer">
            {linkLabel}
          </a>
        )}
      </p>
      <p className={styles.prompt}>
        <Button variant="secondary" onClick={onRetry}>
          Try a different account
        </Button>
      </p>
    </div>
  );
}

// Re-export for the route table; wrappers keep historic import paths stable.
export function AdminLoginPage() {
  return <PortalLoginPage portal="admin" />;
}

export function StaffLoginPage() {
  return <PortalLoginPage portal="staff" />;
}
