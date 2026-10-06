import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, PasswordChecklist, PasswordField, TextField } from '@afhomes/ui';
import { passwordRuleStates, validateRecoveryPassword } from '@afhomes/shared';

import { useActivateMutation } from './queries';
import { useCustomerSession } from '../../lib/customer-session';
import styles from './auth.module.css';

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
  const [fieldError, setFieldError] = useState<string | null>(null);
  // True when the activation linked a sign-in that already existed for this
  // email. The typed password was never set on that account, so the page must
  // not attempt a sign-in with it - it points at sign-in / forgot-password.
  const [recovered, setRecovered] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Same client-side policy as password reset: weak choices are rejected
    // before they ever leave the browser. The server re-validates regardless.
    const policyError = validateRecoveryPassword(password);
    if (policyError) {
      setFieldError(policyError);
      return;
    }
    if (password !== passwordConfirmation) {
      setFieldError('The passwords do not match');
      return;
    }
    setFieldError(null);
    const secret = token.trim();
    try {
      const result = await activation.mutateAsync({
        onboardingToken: secret,
        password,
        passwordConfirmation,
      });
      // The token has served its purpose. Drop it from memory immediately.
      setToken('');
      if (result.linkedExistingAuth) {
        setRecovered(true);
        return;
      }
      // Now sign in through the normal Supabase Auth password flow.
      await signIn(result.email, password);
      navigate('/customer', { replace: true });
    } catch (cause) {
      setToken('');
      setError(cause instanceof Error ? cause.message : 'We could not activate your account.');
    }
  };

  if (recovered) {
    return (
      <AuthLayout
        eyebrow="AF Homes Ecofarm"
        title="Account linked"
        lead="Your membership is ready."
        brandTitle="Your farm membership, in your pocket."
        brandLead="Track points, view your digital membership card, and follow your payments."
      >
        <Alert
          variant="success"
          title="An account already exists for this email. Your membership has been linked."
        >
          Use Sign in with your existing password, or reset your password if needed.
        </Alert>
        <p className={styles.prompt}>
          <Link className={styles.promptLink} to="/customer/login">
            Sign in
          </Link>{' '}
          ·{' '}
          <Link className={styles.promptLink} to="/customer/forgot-password">
            Forgot password
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Activate your account"
      lead="Use your branch activation code."
      brandTitle="Your farm membership, in your pocket."
      brandLead="Track points, view your digital membership card, and follow your payments."
    >
      <form onSubmit={onSubmit} noValidate className={styles.form}>
        {error && (
          <Alert variant="danger" title="We could not activate your account">
            {error}
          </Alert>
        )}

        <TextField
          id="activation-token"
          name="activation-token"
          label="Activation code"
          value={token}
          onChange={(value) => setToken(value)}
          autoComplete="one-time-code"
        />

        <PasswordField
          id="activation-password"
          label="Password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setFieldError(null);
          }}
          autoComplete="new-password"
          error={fieldError ?? undefined}
        />
        {password.length > 0 && <PasswordChecklist items={passwordRuleStates(password)} />}

        <PasswordField
          id="activation-password-confirm"
          label="Confirm password"
          value={passwordConfirmation}
          onChange={(value) => {
            setPasswordConfirmation(value);
            setFieldError(null);
          }}
          autoComplete="new-password"
        />

        <div className={styles.submitRow}>
          <Button type="submit" loading={activation.isPending} disabled={activation.isPending}>
            Activate my account
          </Button>
        </div>

        <p className={styles.prompt}>
          Already activated?{' '}
          <Link className={styles.promptLink} to="/customer/login">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
