import { useState } from 'react';
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
import { TextField } from '../components/TextField';
import styles from './ForgotPasswordPage.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Forgot password (SCR-AUTH-006) - requests a Supabase Auth password-reset
 * email. The email link opens `/auth/reset-password` (PKCE recovery session).
 * When Supabase is unconfigured (mock/dev), the submit simulates success with
 * a clearly-labeled dev-only notice - never a fake email.
 */
export function ForgotPasswordPage() {
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  const brandMark = globalCms?.brandMark ?? null;

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Enter your email address.');
      document.getElementById('auth-forgot-email')?.focus();
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      document.getElementById('auth-forgot-email')?.focus();
      return;
    }
    setSubmitting(true);
    setServerError(undefined);
    try {
      const client = getSupabaseClient();
      if (!client) {
        setServerError('Password reset is unavailable right now. Please try again later.');
        setSubmitting(false);
        return;
      }
      const { error } = await client.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}${AUTH.resetPasswordPath}`,
      });
      if (error) {
        setServerError(
          'We could not send a password reset email. Check the address and try again.',
        );
        setSubmitting(false);
        return;
      }
      setSent(true);
      setSubmitting(false);
    } catch {
      setServerError('We could not send a password reset email. Please try again.');
      setSubmitting(false);
    }
  };

  const page = AUTH.forgotPasswordPage;

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
      {sent ? (
        <div className={styles.resultPanel}>
          <div className={styles.successBlock}>
            <h2 className={styles.successTitle}>{page.successTitle}</h2>
            <p className={styles.successMessage}>{page.successMessage}</p>
          </div>
          <div className={styles.submitRow}>
            <ButtonLink to={AUTH.loginPath}>{page.backLabel}</ButtonLink>
          </div>
        </div>
      ) : (
        <form className={styles.form} noValidate onSubmit={onSubmit}>
          {serverError ? (
            <Alert variant="danger" title="We could not send the reset email">
              {serverError}
            </Alert>
          ) : null}

          <TextField
            id="auth-forgot-email"
            name="email"
            type="email"
            label={page.fields.email.label}
            value={email}
            onChange={(value) => {
              setEmail(value);
              setEmailError(undefined);
              setServerError(undefined);
            }}
            error={emailError}
            autoComplete="email"
            inputMode="email"
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
      )}
    </AuthLayout>
  );
}
