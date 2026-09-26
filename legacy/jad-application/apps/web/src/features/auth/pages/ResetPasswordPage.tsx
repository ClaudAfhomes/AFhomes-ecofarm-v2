import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ButtonLink } from '../../../components/ButtonLink';
import { useQuery } from '@tanstack/react-query';
import { getGlobalCmsPublic } from '@/lib/cms';
import { getSupabaseClient } from '../../../lib/supabase';
import { AUTH } from '../content';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordField } from '../components/PasswordField';
import styles from './ResetPasswordPage.module.css';

const PASSWORD_MIN_LENGTH = 8;

type Phase = 'loading' | 'invalid' | 'ready' | 'done';

interface AuthLike {
  auth: {
    getSession: () => Promise<{ data: { session: unknown } }>;
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      data: { subscription: { unsubscribe: () => void } };
    };
    updateUser: (patch: { password: string }) => Promise<{ error: { message: string } | null }>;
    signOut: () => Promise<void>;
  };
}

/**
 * Reset password (SCR-AUTH-006) - the recovery-link landing page. Supabase
 * Auth exchanges the PKCE code on load (`detectSessionInUrl`); when a session
 * is present the user sets a new password via `updateUser`, then the recovery
 * session is signed out. Unconfigured Supabase (mock/dev) shows the invalid/
 * expired state - recovery is not simulated.
 */
export function ResetPasswordPage() {
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  const brandMark = globalCms?.brandMark ?? null;

  const [phase, setPhase] = useState<Phase>(() => (getSupabaseClient() ? 'loading' : 'invalid'));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    const client = getSupabaseClient() as AuthLike | null;
    if (!client) return; // initial phase is 'invalid' when Supabase is absent
    const apply = (session: unknown) => {
      if (mounted) setPhase(session ? 'ready' : 'invalid');
    };
    client.auth
      .getSession()
      .then(({ data }) => apply(data.session))
      .catch(() => apply(null));
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => apply(session));
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const nextErrors: { password?: string; confirm?: string } = {};
    if (password.length < PASSWORD_MIN_LENGTH) {
      nextErrors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (confirm !== password) {
      nextErrors.confirm = 'Passwords do not match.';
    }
    setErrors(nextErrors);
    if (nextErrors.password) {
      document.getElementById('auth-reset-password')?.focus();
      return;
    }
    if (nextErrors.confirm) {
      document.getElementById('auth-reset-confirm')?.focus();
      return;
    }
    setSubmitting(true);
    setServerError(undefined);
    try {
      const client = getSupabaseClient() as AuthLike | null;
      if (!client) {
        setServerError('Password recovery is not available right now.');
        setSubmitting(false);
        return;
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setServerError('We could not update your password. Please try again.');
        setSubmitting(false);
        return;
      }
      await client.auth.signOut().catch(() => {
        // best-effort - the recovery session is cleared below anyway
      });
      setPhase('done');
      setSubmitting(false);
    } catch {
      setServerError('We could not update your password. Please try again.');
      setSubmitting(false);
    }
  };

  const page = AUTH.resetPasswordPage;

  return (
    <AuthLayout
      eyebrow={AUTH.login.eyebrow}
      title={page.title}
      lead={page.lead}
      brandTitle={page.brandTitle}
      brandLead={page.brandLead}
      image={AUTH.images.login}
      brandMark={brandMark}
    >
      {phase === 'done' ? (
        <div className={styles.resultPanel}>
          <div className={styles.successBlock}>
            <h2 className={styles.successTitle}>{page.successTitle}</h2>
            <p className={styles.successMessage}>{page.successMessage}</p>
          </div>
          <div className={styles.submitRow}>
            <ButtonLink to={AUTH.loginPath}>{page.backLabel}</ButtonLink>
          </div>
        </div>
      ) : phase === 'loading' ? (
        <div className={styles.resultPanel} role="status" aria-live="polite">
          <p className={styles.checking}>Checking your recovery link…</p>
        </div>
      ) : phase === 'ready' ? (
        <form className={styles.form} noValidate onSubmit={onSubmit}>
          {serverError ? (
            <Alert variant="danger" title="We could not update your password">
              {serverError}
            </Alert>
          ) : null}

          <PasswordField
            id="auth-reset-password"
            label={page.fields.password.label}
            hint={page.fields.password.hint}
            value={password}
            onChange={(value) => {
              setPassword(value);
              setErrors((current) => ({ ...current, password: undefined }));
              setServerError(undefined);
            }}
            autoComplete={page.fields.password.autocomplete}
            error={errors.password}
          />

          <PasswordField
            id="auth-reset-confirm"
            label={page.fields.confirmPassword.label}
            value={confirm}
            onChange={(value) => {
              setConfirm(value);
              setErrors((current) => ({ ...current, confirm: undefined }));
              setServerError(undefined);
            }}
            autoComplete={page.fields.confirmPassword.autocomplete}
            error={errors.confirm}
          />

          <div className={styles.submitRow}>
            <Button type="submit" loading={submitting} disabled={submitting}>
              {page.submitLabel}
            </Button>
          </div>

          <p className={styles.prompt}>
            Remembered it?{' '}
            <Link className={styles.promptLink} to={AUTH.loginPath}>
              {AUTH.login.eyebrow}
            </Link>
          </p>
        </form>
      ) : (
        <div className={styles.resultPanel}>
          <div className={styles.successBlock}>
            <h2 className={styles.successTitle}>{page.invalidTitle}</h2>
            <p className={styles.successMessage}>{page.invalidMessage}</p>
          </div>
          <div className={styles.submitRow}>
            <ButtonLink to={AUTH.forgotPasswordPath}>Request a new link</ButtonLink>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
