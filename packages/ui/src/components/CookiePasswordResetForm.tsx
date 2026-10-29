import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from './Alert';
import { PasswordField } from './PasswordField';
import { Button } from './Button';

/** Same recovery form for both portals; the caller owns the authentication API. */
export function CookiePasswordResetForm({
  reset,
  validate,
  loginHref,
}: {
  reset(token: string, password: string): Promise<void>;
  validate(password: string): string | null;
  loginHref: string;
}) {
  const [token, setToken] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return query.has('error') ? '' : (query.get('token') ?? '');
  });
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  if (done)
    return (
      <>
        <Alert variant="success" title="Password updated">
          Your password has been updated. Sign in with your new password.
        </Alert>
        <Link to={loginHref}>Back to sign in</Link>
      </>
    );
  if (!token)
    return (
      <>
        <Alert variant="danger" title="Invalid or expired link">
          This recovery link is invalid or has expired. Recovery links are single-use.
        </Alert>
        <Link to={loginHref}>Back to sign in</Link>
      </>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const invalid = validate(password);
        if (invalid || password !== confirmation) {
          setError(invalid ?? 'The passwords do not match');
          return;
        }
        setPending(true);
        setError('');
        try {
          await reset(token, password);
          setPassword('');
          setConfirmation('');
          setToken('');
          setDone(true);
          window.history.replaceState(null, '', window.location.pathname);
        } catch {
          setError(
            'This recovery link is invalid or has expired. Request a new link and try again.',
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <PasswordField
        id="reset-password"
        label="New password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
      />
      <PasswordField
        id="reset-password-confirm"
        label="Confirm password"
        autoComplete="new-password"
        value={confirmation}
        onChange={setConfirmation}
      />
      {error && (
        <Alert variant="danger" title="Password reset failed">
          {error}
        </Alert>
      )}
      <Button type="submit" loading={pending} disabled={!password || !confirmation}>
        Update password
      </Button>
    </form>
  );
}
