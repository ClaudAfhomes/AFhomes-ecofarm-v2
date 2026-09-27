import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '@jad/ui';

import { useCustomerSession } from '../../lib/customer-session';
import { env } from '../../lib/env';
import { styles } from './portal-ui';
import authStyles from './auth.module.css';

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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const from =
    (location.state as { from?: string } | null)?.from?.startsWith('/customer')
      ? (location.state as { from: string }).from
      : '/customer';

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch {
      // A single generic message, and the underlying error is deliberately not
      // rendered: distinguishing "no such user" from "wrong password" would let
      // anyone enumerate registered customers. Nothing is logged either - the
      // submitted password must never reach a log sink.
      setError('We could not sign you in with that email and password.');
      setPending(false);
    }
  };

  return (
    <main className={authStyles.auth}>
      <div className={authStyles.panel}>
        <p className={styles.eyebrow}>AF Homes Ecofarm</p>
        <h1 className={authStyles.title}>Sign in</h1>
        <p className={authStyles.body}>Access your membership card and points.</p>

        {error && (
          <p className={authStyles.error} role="alert">
            {error}
          </p>
        )}

        <form onSubmit={onSubmit} className={authStyles.form}>
          <label className={authStyles.label} htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            name="login-email"
            className={authStyles.input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />

          <label className={authStyles.label} htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            name="login-password"
            className={authStyles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />

          <Button type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className={authStyles.body}>
          Received an activation code? <Link to="/customer/activate">Activate your account</Link>
        </p>
        <p className={authStyles.footnote}>
          Staff member? Use the{' '}
          <a href={env.VITE_ADMIN_URL} rel="noreferrer">
            administration console
          </a>{' '}
          instead.
        </p>
      </div>
    </main>
  );
}
