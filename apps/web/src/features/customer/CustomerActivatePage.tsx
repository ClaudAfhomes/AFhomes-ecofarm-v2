import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@jad/ui';
import { validateRecoveryPassword } from '@jad/shared';

import { useActivateMutation } from './queries';
import { useCustomerSession } from '../../lib/customer-session';
import { styles } from './portal-ui';
import authStyles from './auth.module.css';

/**
 * Account activation: redeem a staff-issued onboarding token and choose a
 * password.
 *
 * Two rules this screen is built around:
 *
 *  1. The token is a bearer secret. It is read from the URL fragment, never from
 *     a query string, because query strings land in access logs and `Referer`
 *     headers. It is held in component state, sent once, and cleared as soon as
 *     the request completes. It is never stored, never logged and never
 *     re-displayed.
 *  2. Activation creates the account but does NOT sign the member in. The API
 *     deliberately returns no session, so this screen then performs the ordinary
 *     `signInWithPassword` flow - the same one a returning member uses.
 *
 * The form has exactly three inputs. There is no customer id, membership id,
 * email or role field, because none of those are accepted: they are resolved
 * server-side from the token.
 */
export function CustomerActivatePage() {
  const navigate = useNavigate();
  const { signIn } = useCustomerSession();
  const activation = useActivateMutation();

  // Read from the URL FRAGMENT only. A `?token=` query string is written to
  // server access logs, proxies and `Referer` headers; a fragment is never sent
  // to the server. The value is also stripped from the address bar immediately.
  const [token, setToken] = useState(() => {
    const raw = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '');
    if (!raw) return '';
    const fromFragment = new URLSearchParams(raw).get('token') ?? '';
    if (fromFragment && typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
    return fromFragment;
  });
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Same client-side policy as password reset: weak choices are rejected
    // before they ever leave the browser. The server re-validates regardless.
    const policyError = validateRecoveryPassword(password);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (password !== passwordConfirmation) {
      setError('The passwords do not match');
      return;
    }
    const secret = token.trim();
    try {
      const result = await activation.mutateAsync({
        onboardingToken: secret,
        password,
        passwordConfirmation,
      });
      // The token has served its purpose. Drop it from memory immediately.
      setToken('');
      // Now sign in through the normal Supabase Auth password flow.
      await signIn(result.email, password);
      navigate('/customer', { replace: true });
    } catch (cause) {
      setToken('');
      setError(cause instanceof Error ? cause.message : 'We could not activate your account.');
    }
  };

  return (
    <main className={authStyles.auth}>
      <div className={authStyles.panel}>
        <p className={styles.eyebrow}>AF Homes Ecofarm</p>
        <h1 className={authStyles.title}>Activate your account</h1>
        <p className={authStyles.body}>
          Use the activation code you received from the AF Homes Ecofarm branch that registered you,
          then choose a password.
        </p>

        {error && (
          <p className={authStyles.error} role="alert">
            {error}
          </p>
        )}

        <form onSubmit={onSubmit} className={authStyles.form}>
          <label className={authStyles.label} htmlFor="activation-token">
            Activation code
          </label>
          <input
            id="activation-token"
            name="activation-token"
            className={authStyles.input}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="one-time-code"
            required
            minLength={20}
            spellCheck={false}
          />

          <label className={authStyles.label} htmlFor="activation-password">
            Password
          </label>
          <input
            id="activation-password"
            name="activation-password"
            className={authStyles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
            minLength={10}
          />
          <p className={authStyles.hint}>
            At least 10 characters, with a lowercase letter, an uppercase letter and a digit.
          </p>

          <label className={authStyles.label} htmlFor="activation-password-confirm">
            Confirm password
          </label>
          <input
            id="activation-password-confirm"
            name="activation-password-confirm"
            className={authStyles.input}
            type="password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            autoComplete="new-password"
            required
            minLength={10}
          />

          <Button type="submit" disabled={activation.isPending}>
            {activation.isPending ? 'Activating…' : 'Activate my account'}
          </Button>
        </form>

        <p className={authStyles.body}>
          Already activated? <Link to="/customer/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
