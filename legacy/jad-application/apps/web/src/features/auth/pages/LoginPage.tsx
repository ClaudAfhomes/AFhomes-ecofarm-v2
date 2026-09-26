import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { normalizeRole } from '@jad/contracts';

import { useSession } from '../../../lib/session';
import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';

import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ApiError } from '../../../lib/api/errors';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import {
  ARCHIVED_ACCOUNT_MESSAGE,
  INACTIVE_ACCOUNT_MESSAGE,
  ORPHAN_ACCOUNT_MESSAGE,
  getMemberAccessBlock,
} from '../../../lib/api/orphan';
import { useQuery } from '@tanstack/react-query';
import { getGlobalCmsPublic, getLoginCmsPublic } from '@/lib/cms';
import { AUTH } from '../content';
import { usePolicyLinks } from '../../../hooks/usePolicyLinks';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordField } from '../components/PasswordField';
import { TextField } from '../components/TextField';
import { login, resolveLoginRole } from '../services/auth';
import { LOGIN_FIELD_ORDER, firstInvalidField, validateLogin } from '../validation';
import type { LoginErrors, LoginValues } from '../validation';
import styles from './LoginPage.module.css';

/**
 * Login (SCR-AUTH-001) - Phase 1 Supabase Auth (admin/user only, no registration).
 * Uses `supabase.auth.signInWithPassword` when `VITE_SUPABASE_URL` is set,
 * otherwise falls back to mock (tests). Role is resolved authoritatively
 * from `MemberRole` → `Role` (never client-side). Redirects `admin` → Admin App
 * (`VITE_ADMIN_URL` → :5174/admin) and `user` → Member App (`/member` → :5173).
 */
function LegalConsentNote() {
  const consent = usePolicyLinks();
  const terms = consent.terms;
  const privacy = consent.privacy;
  if (!terms && !privacy) return null;
  return (
    <p className={styles.note}>
      Secure sign-in. By continuing, you agree to our{' '}
      {terms ? (
        <Link className={styles.promptLink} to={terms}>
          Terms
        </Link>
      ) : (
        'Terms'
      )}{' '}
      and{' '}
      {privacy ? (
        <Link className={styles.promptLink} to={privacy}>
          Privacy Policy
        </Link>
      ) : (
        'Privacy Policy'
      )}
      .
    </p>
  );
}

export function LoginPage() {
  const { data: cmsLogin } = useQuery({
    queryKey: ['cms', 'login'],
    queryFn: getLoginCmsPublic,
    staleTime: 0,
  });
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  const loginContent = cmsLogin ?? {
    copy: {
      eyebrow: AUTH.login.eyebrow,
      title: AUTH.login.title,
      lead: AUTH.login.lead,
      brandTitle: AUTH.login.brandTitle,
      brandLead: AUTH.login.brandLead,
    },
    image: AUTH.images.login,
    fields: { identifier: AUTH.login.fields.identifier, password: AUTH.login.fields.password },
    submitLabel: AUTH.login.submitLabel,
    forgotPassword: AUTH.login.forgotPassword,
    registerPrompt: AUTH.login.registerPrompt,
  };
  const brandMark = globalCms?.brandMark ?? null;
  const { loginAs } = useSession();
  const navigate = useNavigate();
  // `from` is intentionally ignored for member login - always land on the
  // member dashboard to prevent cross-account path leaks via history state.
  // Admin logins still honor a saved /admin/* return path (cross-origin).
  const locationForAdmin = useLocation() as { state?: { from?: string } | null };
  const [values, setValues] = useState<LoginValues>({ identifier: '', password: '' });
  const [errors, setErrors] = useState<LoginErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const adminFrom = (locationForAdmin.state as { from?: string } | null)?.from ?? '';

  const setValue = (field: keyof LoginValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) =>
      current[field] !== undefined ? { ...current, [field]: undefined } : current,
    );
    setServerError(undefined);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const nextErrors = validateLogin(values);
    setErrors(nextErrors);
    const first = firstInvalidField(nextErrors, LOGIN_FIELD_ORDER);
    if (first === 'identifier') {
      identifierRef.current?.focus();
      return;
    }
    if (first === 'password') {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setServerError(undefined);

    // Supabase is authoritative when configured. When VITE_SUPABASE_URL is set,
    // authentication must go through Supabase only - no silent mock fallback.
    // Mock remains only when Supabase is not configured or in test mode.
    const trySupabaseLogin = async (): Promise<{
      id: string;
      name: string;
      email: string;
      role: string;
      isQualified: boolean;
      status: string;
    } | null> => {
      if ((import.meta.env as Record<string, string | undefined>).MODE === 'test') return null;
      if (!isSupabaseConfigured()) return null;
      const supaClient = getSupabaseClient() as unknown as {
        auth: {
          signInWithPassword: (c: { email: string; password: string }) => Promise<{
            data: {
              user: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
            };
            error: { message: string } | null;
          }>;
          signOut: () => Promise<void>;
        };
        from: (t: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          select: (...args: any[]) => any;
        };
      } | null;
      if (!supaClient) return null;
      const { data, error } = await supaClient.auth.signInWithPassword({
        email: values.identifier,
        password: values.password,
      });
      if (error || !data.user) {
        // Surface real Supabase error - do not fallback to mock
        throw new ApiError({
          code: 'UNAUTHORIZED',
          message: error?.message ?? 'Email or password is incorrect.',
          status: 401,
        });
      }
      const userId = data.user.id;
      // Fetch profile from the real "Member" table (quoted per migration).
      // maybeSingle: 0 rows (deleted/purged Member) resolves null instead of
      // throwing PGRST116 like .single() did. No legacy "members" fallback:
      // that table does not exist in the schema, so probing it can only
      // ever produce PGRST205 noise.
      let member: {
        firstName: string;
        lastName: string;
        isQualified: boolean;
        status: string;
        archivedAt: string | null;
        accountStatus: string;
      } | null = null;
      try {
        const res = (await (
          supaClient as unknown as {
            from: (t: string) => {
              select: (s: string) => {
                eq: (
                  k: string,
                  v: string,
                ) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> };
              };
            };
          }
        )
          .from('Member')
          .select('*')
          .eq('id', userId)
          .maybeSingle()) as {
          data: Record<string, unknown> | null;
        };
        if (res.data) {
          const d = res.data as Record<string, unknown>;
          const name = (d['name'] as string) ?? '';
          member = {
            firstName: (d['firstName'] as string) ?? name.split(' ')[0] ?? '',
            lastName: (d['lastName'] as string) ?? name.split(' ').slice(1).join(' ') ?? '',
            isQualified: (d['isQualified'] as boolean) ?? (d['is_qualified'] as boolean) ?? false,
            status: (d['status'] as string) ?? 'PENDING',
            archivedAt: (d['archivedAt'] as string | null) ?? null,
            accountStatus: (d['accountStatus'] as string) ?? 'ACTIVE',
          };
        }
      } catch {
        member = null;
      }

      // Authoritative role resolution (staff-first): staff-only identities
      // (StaffUser, no Member row) resolve to admin; member-tier resolves via
      // MemberRole → Role; user_metadata is the last resort. Mirrors
      // SupabaseSessionProvider so login and refresh agree - otherwise an
      // admin lands on the member panel until refresh. Phase 1: admin / user
      // only; maps legacy SUPER_ADMIN → admin via normalizeRole.
      const authoritativeRole: string = await resolveLoginRole(
        supaClient as unknown as import('../services/auth').LoginRoleClient,
        userId,
        (data.user.user_metadata ?? {}) as Record<string, unknown>,
      );
      // Orphaned auth user: valid Supabase login but the Member row was
      // deleted/purged (and no StaffUser identity → not admin). Block the
      // login with a friendly message instead of entering a broken panel.
      if (!member && authoritativeRole !== 'admin') {
        try {
          await supaClient.auth.signOut();
        } catch {
          // best effort - the ApiError below still blocks entry
        }
        throw new ApiError({
          code: 'ACCOUNT_DELETED',
          message: ORPHAN_ACCOUNT_MESSAGE,
          status: 403,
        });
      }
      // Archived or deactivated members keep their Member row but must not
      // enter the portal.
      const accessBlock = getMemberAccessBlock(member);
      if (accessBlock && authoritativeRole !== 'admin') {
        try {
          await supaClient.auth.signOut();
        } catch {
          // best effort - the ApiError below still blocks entry
        }
        throw new ApiError({
          code: accessBlock === 'ARCHIVED' ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_INACTIVE',
          message: accessBlock === 'ARCHIVED' ? ARCHIVED_ACCOUNT_MESSAGE : INACTIVE_ACCOUNT_MESSAGE,
          status: 403,
        });
      }
      return {
        id: data.user.id,
        name:
          member?.firstName && member?.lastName
            ? `${member.firstName} ${member.lastName}`
            : ((data.user.user_metadata['full_name'] as string) ??
              data.user.email ??
              values.identifier),
        email: data.user.email ?? values.identifier,
        role: authoritativeRole,
        isQualified: (member?.isQualified as boolean) ?? false,
        status: (member?.status as string) ?? 'PENDING',
      };
    };

    try {
      const isSupabaseAuth =
        isSupabaseConfigured() &&
        (import.meta.env as Record<string, string | undefined>).MODE !== 'test';
      let user: {
        id: string;
        name: string;
        email: string;
        role: string;
        isQualified?: boolean;
        status?: string;
      };
      if (isSupabaseAuth) {
        const supaUser = await trySupabaseLogin();
        // trySupabaseLogin throws on auth failure, returns user on success; null only if not configured
        if (!supaUser) {
          throw new ApiError({
            code: 'UNAUTHORIZED',
            message: 'Sign-in failed. Please try again shortly.',
            status: 401,
          });
        }
        user = supaUser;
      } else {
        user = (await login({ identifier: values.identifier, password: values.password })).user;
      }
      loginAs({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as never,
        isQualified: user.isQualified,
        status: user.status as never,
      });
      const role = normalizeRole(user.role);
      if (role === 'admin') {
        const rawAdminUrl =
          (import.meta.env as Record<string, string | undefined>).VITE_ADMIN_URL ??
          'http://localhost:5174/admin';
        const base = rawAdminUrl.replace(/\/$/, '');
        const adminBase = base.endsWith('/admin') ? base : `${base}/admin`;
        const target = adminFrom.startsWith('/admin')
          ? `${adminBase}${adminFrom.replace(/^\/admin/, '')}`
          : adminBase;
        window.location.href = target;
        return;
      }
      // user → Member App always lands on the dashboard to prevent a
      // previous member's history state (location.state.from) from leaking
      // into the next login in the same tab.
      navigate('/member', { replace: true });
    } catch (error) {
      setServerError(apiErrorMessage(error, 'Sign-in failed. Please try again shortly.'));
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow={loginContent.copy?.eyebrow ?? AUTH.login.eyebrow}
      title={loginContent.copy?.title ?? AUTH.login.title}
      lead={loginContent.copy?.lead ?? AUTH.login.lead}
      brandTitle={loginContent.copy?.brandTitle ?? AUTH.login.brandTitle}
      brandLead={loginContent.copy?.brandLead ?? AUTH.login.brandLead}
      image={loginContent.image ?? AUTH.images.login}
      brandMark={brandMark}
    >
      <form className={styles.form} noValidate onSubmit={onSubmit}>
        {serverError ? (
          <Alert variant="danger" title="We could not sign you in">
            {serverError}
          </Alert>
        ) : null}

        <TextField
          id="auth-login-identifier"
          name="identifier"
          label={loginContent.fields?.identifier?.label ?? AUTH.login.fields.identifier.label}
          hint={loginContent.fields?.identifier?.hint ?? AUTH.login.fields.identifier.hint}
          error={errors.identifier}
          value={values.identifier}
          onChange={(value) => setValue('identifier', value)}
          autoComplete={AUTH.login.fields.identifier.autocomplete}
          inputMode="text"
          inputRef={identifierRef}
          placeholder="username@gmail.com"
        />

        <PasswordField
          id="auth-login-password"
          label={loginContent.fields?.password?.label ?? AUTH.login.fields.password.label}
          value={values.password}
          onChange={(value) => setValue('password', value)}
          autoComplete={AUTH.login.fields.password.autocomplete}
          error={errors.password}
          inputRef={passwordRef}
          placeholder="Password"
        />

        <div className={styles.utilityRow}>
          <Link className={styles.textLink} to={AUTH.login.forgotPassword.to}>
            {loginContent.forgotPassword?.label ?? AUTH.login.forgotPassword.label}
          </Link>
        </div>

        <div className={styles.submitRow}>
          <Button type="submit" loading={submitting} disabled={submitting}>
            {loginContent.submitLabel ?? AUTH.login.submitLabel}
          </Button>
        </div>

        <p className={styles.prompt}>
          {loginContent.registerPrompt?.text ?? AUTH.login.registerPrompt.text}{' '}
          <Link className={styles.promptLink} to={AUTH.login.registerPrompt.to}>
            {loginContent.registerPrompt?.linkLabel ?? AUTH.login.registerPrompt.linkLabel}
          </Link>
        </p>

        <LegalConsentNote />
      </form>
    </AuthLayout>
  );
}
