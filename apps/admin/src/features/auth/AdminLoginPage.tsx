import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '@jad/ui';

import { useSession } from '../../lib/session';
import styles from './AdminLoginPage.module.css';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const requested = (location.state as { from?: string } | null)?.from;
  const destination =
    requested?.startsWith('/admin') && requested !== '/admin/login' ? requested : '/admin';

  if (status === 'authenticated') return <Navigate to={destination} replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signIn(email, password);
      navigate(destination, { replace: true });
    } catch {
      setError('We could not sign you in with that email and password.');
      setPending(false);
    }
  };

  return (
    <main className={styles.auth}>
      <div className={styles.panel}>
        <p className={styles.eyebrow}>AF Homes Ecofarm</p>
        <h1 className={styles.title}>Staff sign in</h1>
        <p className={styles.body}>Access the administration and operations console.</p>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.label} htmlFor="admin-login-email">
            Email
          </label>
          <input
            id="admin-login-email"
            className={styles.input}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
          <label className={styles.label} htmlFor="admin-login-password">
            Password
          </label>
          <input
            id="admin-login-password"
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <Button type="submit" disabled={pending || status === 'loading'}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className={styles.body}>
          <Link to="/admin/forgot-password">Forgot your password?</Link>
        </p>
      </div>
    </main>
  );
}
