import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert, AuthLayout, Button, PasswordField, TextField, TurnstileChallenge } from '@jad/ui';
import type { AuthPortals } from '@jad/contracts';
import { env } from '../../lib/env';

import { useCustomerSession } from '../../lib/customer-session';
import { getAuthPortals } from '../../lib/portals';
import {
  adminOrigin,
  decideStaffEntry,
  isAdminOriginMismatch,
  type StaffEntryDecision,
  type StaffEntryPortal,
} from '../../lib/staff-entry';
import styles from '../customer/auth.module.css';

/**
 * Web-hosted staff entry (`:5173/admin/login`, `:5173/staff/login` in local dev).
 *
 * Same Supabase password flow and same server identity probe
 * (`GET /auth/portals`) as the admin console's `PortalLoginPage`; the only
 * difference is that a successful entry hands off to the staff console origin
 * (`VITE_ADMIN_URL`, `:5174` locally) via `window.location.replace`. The
 * session cookie is shared cross-port in dev, so no password retype is needed
 * and nothing secret travels in the URL.
 *
 * In production both SPAs share one origin and `/admin/*` is served by the
 * admin bundle (`vercel.json`), so these routes are a local-dev convenience:
 * the admin console remains the canonical staff entry. Guards are UX-only;
 * every action is re-checked server-side.
 */
export function StaffEntryPage({ portal }: { portal: StaffEntryPortal }) {
  const isAdmin = portal === 'admin';
  const { status, signIn, signOut } = useCustomerSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [decision, setDecision] = useState<StaffEntryDecision | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Local-dev tripwire: a remote staff-console origin here means a successful
  // sign-in would bounce out of local dev into production. Warn once in DEV
  // (never in production builds, and never with the URL - hosts only).
  useEffect(() => {
    if (
      import.meta.env.DEV &&
      isAdminOriginMismatch(env.VITE_ADMIN_URL, window.location.hostname)
    ) {
      console.warn(
        '[staff-entry] VITE_ADMIN_URL is remote while this page runs on localhost: ' +
          'staff handoff will leave local dev. Set VITE_ADMIN_URL=http://localhost:5174/admin ' +
          'in the root .env.local and restart Vite.',
      );
    }
  }, []);

  // An already-authenticated session arriving at either entry is routed, not
  // bounced: allowed here it hands off to the console, otherwise it learns the
  // right portal. State updates happen only in the promise callbacks below.
  useEffect(() => {
    if (status === 'loading' || decision) return;
    let live = true;
    getAuthPortals()
      .then((portals) => {
        if (!live) return;
        const next = decideStaffEntry(portal, portals);
        if (next.action === 'forward') window.location.replace(next.to);
        else if (status === 'authenticated') setDecision(next);
      })
      .catch(() => {
        if (live && status === 'authenticated')
          setServerError('We could not verify this sign-in. Please try again.');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const applyDecision = (next: StaffEntryDecision) => {
    if (next.action === 'forward') {
      window.location.replace(next.to);
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
      if (env.VITE_TURNSTILE_SITE_KEY) {
        if (!captchaToken) throw new Error('Complete security verification.');
        await signIn(email, password, captchaToken);
      } else await signIn(email, password);
      const portals: AuthPortals = await getAuthPortals();
      applyDecision(decideStaffEntry(portal, portals));
    } catch {
      // Generic on purpose: distinguishing unknown user from wrong password
      // would enumerate staff accounts.
      setServerError('We could not sign you in with that email and password.');
    } finally {
      setPending(false);
      setCaptchaToken(null);
      setCaptchaVersion((v) => v + 1);
    }
  };

  // A signed-in identity with no AF Homes home anywhere must not linger with
  // a live session on a login screen.
  useEffect(() => {
    if (decision?.action === 'refuse' && decision.message.includes('no staff identity')) {
      void signOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision]);

  const recoveryHref = `${adminOrigin()}${isAdmin ? '/admin/forgot-password' : '/staff/forgot-password'}`;

  return (
    <main>
      <AuthLayout
        eyebrow="AF Homes Ecofarm"
        title={isAdmin ? 'Administration Login' : 'Staff Login'}
        lead={
          isAdmin
            ? 'Restricted to Super Admin and Admin. You will continue to the staff console.'
            : 'Finance, HR, operations and the sales network. You will continue to the staff console.'
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
              <a className={styles.textLink} href={recoveryHref}>
                Forgot your password?
              </a>
            </div>

            <div className={styles.submitRow}>
              <TurnstileChallenge
                siteKey={env.VITE_TURNSTILE_SITE_KEY}
                onToken={setCaptchaToken}
                resetVersion={captchaVersion}
              />
              <Button
                loadingLabel="Signing in…"
                type="submit"
                loading={pending}
                disabled={pending || status === 'loading'}
              >
                Sign in
              </Button>
            </div>

            <p className={styles.prompt}>
              Member?{' '}
              <Link className={styles.promptLink} to="/customer/login">
                Customer Login
              </Link>
            </p>
          </form>
        )}
      </AuthLayout>
    </main>
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

export function AdminEntryPage() {
  return <StaffEntryPage portal="admin" />;
}

export function StaffLoginEntryPage() {
  return <StaffEntryPage portal="staff" />;
}
