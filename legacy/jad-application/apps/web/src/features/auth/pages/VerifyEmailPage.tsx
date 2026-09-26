import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

import { notifySuccess } from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { useQuery } from '@tanstack/react-query';
import { getGlobalCmsPublic, getRegisterCmsPublic } from '@/lib/cms';
import { AUTH } from '../content';
import { AuthLayout } from '../components/AuthLayout';
import { TextField } from '../components/TextField';
import { resendVerificationCode, verifyEmail } from '../services/auth';
import styles from './VerifyEmailPage.module.css';

const CODE_RE = /^\d{6}$/;
const RESEND_COOLDOWN_SECONDS = 60;

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Email verification (SCR-AUTH-003, FEAT-009). Verifies the one-time code from
 * `POST /auth/verify-email` (BR-AUTH-001 - verification precedes approval) and
 * routes to the application status screen. In dev the mock "email" is simulated
 * via `POST /auth/verify-email/resend`, which returns the code the email would
 * carry - shown in a clearly-labeled dev-only banner, never presented as real.
 */
export function VerifyEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  const { data: registerCms } = useQuery({
    queryKey: ['cms', 'register'],
    queryFn: getRegisterCmsPublic,
    staleTime: 0,
  });
  const verifyCopy =
    (registerCms as { verifyEmail?: typeof AUTH.verifyEmail } | undefined)?.verifyEmail ??
    AUTH.verifyEmail;
  const verifyImage =
    (registerCms as { image?: { id: string; alt: string } } | undefined)?.image ??
    AUTH.images.register;
  const brandMark = globalCms?.brandMark ?? null;

  const resolveInitialEmail = (): string => {
    const stateEmail = (location.state as { email?: string } | null)?.email;
    if (typeof stateEmail === 'string' && stateEmail) return stateEmail;
    const queryEmail = searchParams.get('email');
    if (queryEmail) return queryEmail;
    try {
      const stored = sessionStorage.getItem('jad:register:email');
      if (stored) return stored;
    } catch {
      // ignore storage errors
    }
    return '';
  };

  const [email, setEmail] = useState(resolveInitialEmail);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ email?: string; code?: string }>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(() =>
    (location.state as { emailSent?: boolean } | null)?.emailSent === true
      ? RESEND_COOLDOWN_SECONDS
      : 0,
  );
  // True when the registration email could not be dispatched (EmailJS
  // unconfigured or the send failed) - nudge the applicant to resend.
  const sendFailed = (location.state as { emailSent?: boolean } | null)?.emailSent === false;
  const replayed = (location.state as { replayed?: boolean } | null)?.replayed === true;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const setField = (field: 'email' | 'code', value: string) => {
    if (field === 'email') setEmail(value);
    else setCode(value);
    setErrors((current) => ({ ...current, [field]: undefined }));
    setServerError(undefined);
  };

  const validate = (): boolean => {
    const nextErrors: { email?: string; code?: string } = {};
    if (!email.trim()) nextErrors.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (!code.trim()) nextErrors.code = 'Enter the verification code.';
    else if (!CODE_RE.test(code.trim())) nextErrors.code = 'Enter the 6-digit code from the email.';
    setErrors(nextErrors);
    if (nextErrors.email) document.getElementById('auth-verify-email')?.focus();
    else if (nextErrors.code) document.getElementById('auth-verify-code')?.focus();
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !validate()) return;
    setSubmitting(true);
    setServerError(undefined);
    try {
      const trimmed = email.trim();
      await verifyEmail({ email: trimmed, code: code.trim() });
      try {
        sessionStorage.setItem('jad:register:email', trimmed);
      } catch {
        // ignore
      }
      notifySuccess({ title: 'Email verified' });
      navigate('/register/status', {
        replace: true,
        state: { email: trimmed },
      });
    } catch (error) {
      setServerError(apiErrorMessage(error, 'We could not verify your email. Please try again.'));
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (resending || cooldown > 0 || !email.trim()) return;
    setResending(true);
    setServerError(undefined);
    try {
      const response = await resendVerificationCode(email.trim());
      setCooldown(response.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      notifySuccess({ title: AUTH.verifyEmail.codeSent });
    } catch (error) {
      setServerError(apiErrorMessage(error, 'We could not resend the code. Please try again.'));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      eyebrow={verifyCopy.eyebrow}
      title={verifyCopy.title}
      lead={verifyCopy.lead}
      brandTitle={verifyCopy.brandTitle}
      brandLead={verifyCopy.brandLead}
      image={verifyImage}
      brandMark={brandMark}
    >
      <form className={styles.form} noValidate onSubmit={onSubmit}>
        {serverError ? (
          <Alert variant="danger" title="We could not verify your email">
            {serverError}
          </Alert>
        ) : null}

        {replayed ? (
          <Alert variant="info" title="Application already pending">
            You already have a pending application for this email. We updated it with your latest
            details and re-sent the verification code.
          </Alert>
        ) : null}

        {sendFailed ? (
          <Alert variant="warning" title="We could not send the email">
            Tap “Resend code” below to try again, or check the address is correct.
          </Alert>
        ) : null}

        <TextField
          id="auth-verify-email"
          name="email"
          type="email"
          label={AUTH.verifyEmail.fields.email.label}
          value={email}
          onChange={(value) => setField('email', value)}
          error={errors.email}
          autoComplete="email"
          inputMode="email"
        />

        <TextField
          id="auth-verify-code"
          name="code"
          label={AUTH.verifyEmail.fields.code.label}
          hint={AUTH.verifyEmail.fields.code.hint}
          value={code}
          onChange={(value) => setField('code', value.replace(/\D/g, ''))}
          error={errors.code}
          autoComplete="one-time-code"
          inputMode="numeric"
        />

        <div className={styles.resendRow}>
          <button
            type="button"
            className={styles.resendButton}
            onClick={onResend}
            disabled={resending || cooldown > 0 || !email.trim()}
          >
            {resending
              ? AUTH.verifyEmail.resendingLabel
              : cooldown > 0
                ? `Resend in ${formatCountdown(cooldown)}`
                : AUTH.verifyEmail.resendLabel}
          </button>
        </div>

        <div className={styles.submitRow}>
          <Button type="submit" loading={submitting} disabled={submitting}>
            {AUTH.verifyEmail.submitLabel}
          </Button>
        </div>

        <p className={styles.prompt}>
          Prefer to start over?{' '}
          <Link className={styles.promptLink} to={AUTH.loginPath}>
            {AUTH.login.eyebrow}
          </Link>
        </p>

        <p className={styles.note}>
          The code is valid for a limited time. If it expires, request a new one.
        </p>
      </form>
    </AuthLayout>
  );
}
