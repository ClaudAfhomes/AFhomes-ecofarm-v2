import {
  loginResponseSchema,
  normalizeRole,
  qualificationQuestionSchema,
  registerResponseSchema,
  resendVerificationResponseSchema,
  verifyEmailResponseSchema,
} from '@jad/contracts';
import type {
  LoginRequest,
  LoginResponse,
  QualificationQuestion,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/**
 * Member auth services (SCR-AUTH-001..005) - typed wrappers over the API client.
 * All calls go through `lib/api/client` (no ad-hoc fetch) and validate
 * responses against the `@jad/contracts` schemas.
 */

/** `POST /auth/login` - establish a session (FR-AUTH-004, SCR-AUTH-001). */
export function login(credentials: LoginRequest): Promise<LoginResponse> {
  return request('/auth/login', loginResponseSchema, {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

/** `POST /auth/register` - create a `Pending` application (FR-REG-001..013, SCR-AUTH-002). */
export function registerApplication(input: RegisterRequest): Promise<RegisterResponse> {
  return request('/auth/register', registerResponseSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `POST /auth/verify-email` - one-time code verification (FEAT-009, SCR-AUTH-003). */
export function verifyEmail(input: VerifyEmailRequest): Promise<VerifyEmailResponse> {
  return request('/auth/verify-email', verifyEmailResponseSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * `POST /auth/verify-email/resend` - re-issue the one-time code. MOCK-ONLY:
 * the dev mock returns `devOnlyCode` (shown in a clearly-labeled simulated
 * email banner); the real API emails the code and returns none.
 */
export function resendVerificationCode(email: string): Promise<ResendVerificationResponse> {
  return request('/auth/verify-email/resend', resendVerificationResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** `POST /me/resubmit` - corrected data for a REJECTED application (FR-REG-005, SCR-AUTH-005). */
export function resubmitApplication(input: Partial<RegisterRequest>): Promise<RegisterResponse> {
  return request('/me/resubmit', registerResponseSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `GET /programs/:id/qualification-questions` (API-SPECIFICATION #86 PROPOSED; content TBD OD-002). */
export function getQualificationQuestions(programId: string): Promise<QualificationQuestion[]> {
  return requestList(`/programs/${programId}/qualification-questions`, qualificationQuestionSchema);
}

/**
 * Minimal read interface over the Supabase client for login role resolution.
 * Structurally satisfied by both the real client and unit-test fakes.
 */
export interface LoginRoleClient {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => Promise<{ data: unknown[] | null; error: unknown }>;
      in: (column: string, values: string[]) => Promise<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

/**
 * Authoritative login role resolution (staff-first).
 *
 * Staff-only identities (`StaffUser`, no `Member` row - e.g. the provisioned
 * super-admin) hold no `MemberRole` link, so member-table resolution alone
 * misclassifies them as `user` and sends them to the member panel. Checking
 * the own `StaffUser` row first (anon-readable via `staffuser_select_own`
 * RLS) mirrors `SupabaseSessionProvider` and keeps login and refresh
 * consistent. Direct `Role` reads may be revoked for anon (Phase 6) -
 * failures are tolerated and fall through to `user_metadata`, then `user`.
 * Metadata is client-writable and must never confer privilege beyond this
 * last-resort fallback.
 */
export async function resolveLoginRole(
  client: LoginRoleClient,
  userId: string,
  metadata: Record<string, unknown>,
): Promise<'admin' | 'user'> {
  // 1. Staff identity → admin (Phase 5 staff separation).
  try {
    const { data: staff, error: staffErr } = await client
      .from('StaffUser')
      .select('id')
      .eq('id', userId);
    if (!staffErr && Array.isArray(staff) && staff.length > 0) return 'admin';
  } catch {
    // fall through to member-tier resolution
  }

  // 2. Member-tier roles via MemberRole → Role. Only the quoted tables
  // exist in the schema (auth foundation migration) - legacy snake_case
  // variants are gone, since probing them can only produce PGRST205 noise.
  const variants: [linkTable: string, roleTable: string][] = [['MemberRole', 'Role']];
  for (const [linkTable, roleTable] of variants) {
    try {
      const { data: links, error: linkErr } = await client
        .from(linkTable)
        .select('roleId')
        .eq('memberId', userId);
      if (linkErr || !Array.isArray(links) || links.length === 0) continue;
      const ids = (links as { roleId: string }[]).map((l) => l.roleId);
      const { data: roles, error: roleErr } = await client
        .from(roleTable)
        .select('slug,name')
        .in('id', ids);
      if (!roleErr && Array.isArray(roles) && roles.length > 0) {
        const slugs = (roles as { slug: string }[]).map((r) => r.slug);
        if (slugs.some((s) => normalizeRole(s) === 'admin')) return 'admin';
        return 'user';
      }
      const collected: string[] = [];
      for (const rid of ids) {
        const { data: one } = await client.from(roleTable).select('slug,name').eq('id', rid);
        if (Array.isArray(one))
          for (const row of one as { slug: string }[]) collected.push(row.slug);
      }
      if (collected.some((s) => normalizeRole(s) === 'admin')) return 'admin';
      if (collected.length > 0) return 'user';
    } catch {
      // ignore and try next table variant
    }
  }

  // 3. Last resort: user_metadata (client-writable - never authoritative for staff).
  const metaRole = metadata?.['role'];
  if (typeof metaRole === 'string' && normalizeRole(metaRole) === 'admin') return 'admin';
  return 'user';
}
