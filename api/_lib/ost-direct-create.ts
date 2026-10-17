/**
 * Direct OST creation from the Members console.
 *
 * The official pipeline approves an OST through the sponsored workflow
 * (submission -> signatures -> sponsor endorsement -> management approval).
 * When management onboards the person directly, the two signatures are
 * transcribed by the operator and the sponsor's endorsement does not exist -
 * so the direct install function records NO endorsement rather than
 * attributing one to a sponsor who did not act.
 *
 * The GoTrue invitation and the SQL install cannot share a transaction. The
 * SQL call is the one that can fail after the invitation exists, and the
 * invitation is deliberately preserved in that case: an invite response does
 * not prove the account was newly created, so deleting it could destroy a
 * pre-existing login. The operator retries from the OST queue instead.
 */
import { resolveAdminUrl } from './admin-url.js';
import type { Db, FailureCode } from './handler-kit.js';

export type OstDirectFailure = { code: FailureCode; message: string; status: number };
export type OstDirectInstall =
  { ok: true; memberId: string; termId: string | null } | ({ ok: false } & OstDirectFailure);

/**
 * Map an OST/transfer RPC failure onto a client-safe answer. Returns null for
 * anything unrecognized so the caller can throw the real error and log it.
 * Raw driver text never reaches the client.
 */
export function ostDirectFailure(
  error: { message?: string; code?: string } | null,
): OstDirectFailure | null {
  const message = String(error?.message ?? '');
  const code = String(error?.code ?? '');
  if (code === '42501' || /MUTATION_FORBIDDEN/.test(message))
    return {
      code: 'FORBIDDEN',
      message: 'You cannot perform this accreditation action.',
      status: 403,
    };
  if (/ACCREDITATION_NUMBER_TAKEN/.test(message))
    return { code: 'CONFLICT', message: 'This AA number is already issued', status: 409 };
  if (
    /OST_ACCREDITATION_EXPIRED_REQUIRED|OST_CONVERSION_|OST_ANNUAL_VALIDITY_REQUIRED|OST_ROLE_WORKFLOW_REQUIRED|OST_TRANSFER_SPONSOR_REQUIRED/.test(
      message,
    )
  )
    return {
      code: 'CONFLICT',
      message: 'Review the accreditation expiry, conversion eligibility and one-year validity.',
      status: 409,
    };
  if (/AA_SEQUENCE_EXHAUSTED/.test(message))
    return {
      code: 'CONFLICT',
      message: 'The monthly AA sequence is exhausted. Contact the administrator.',
      status: 409,
    };
  if (/OST_ACTIVE_SM_REQUIRED/.test(message))
    return {
      code: 'VALIDATION_ERROR',
      message: 'Choose an active Sales Manager as sponsor.',
      status: 400,
    };
  if (/OST_DUPLICATE_ACCOUNT/.test(message))
    return {
      code: 'CONFLICT',
      message: 'A person with this email or phone number is already registered.',
      status: 409,
    };
  if (/OST_APPLICATION_IN_PROGRESS/.test(message))
    return {
      code: 'CONFLICT',
      message: 'An OST application for this person is already in progress.',
      status: 409,
    };
  if (/OST_RENEWAL_IN_PROGRESS/.test(message))
    return {
      code: 'CONFLICT',
      message: 'An OST renewal is in progress. Complete or withdraw it before transferring.',
      status: 409,
    };
  if (/OST_SIGNATURE_EVIDENCE_REQUIRED|OST_SIGNATURE_DATES_REQUIRED/.test(message))
    return {
      code: 'VALIDATION_ERROR',
      message: 'Both signatures and their actual dates are required to complete an OST.',
      status: 400,
    };
  if (/OST_VALIDITY_REQUIRED/.test(message))
    return {
      code: 'VALIDATION_ERROR',
      message: 'Choose the approved start and expiry dates.',
      status: 400,
    };
  if (/OST_IDENTITY_REQUIRED/.test(message))
    return {
      code: 'CONFLICT',
      message:
        'This account already holds an OST registration, or the email is not the member\u2019s own.',
      status: 409,
    };
  if (/INVALID_APPLICATION_TRANSITION/.test(message))
    return { code: 'CONFLICT', message: 'The application is not ready for approval.', status: 409 };
  if (/MUTATION_PAYLOAD_CONFLICT/.test(message))
    return {
      code: 'CONFLICT',
      message: 'The application changed. Review it before retrying.',
      status: 409,
    };
  if (/ACCREDITATION_REQUIRED/.test(message))
    return {
      code: 'CONFLICT',
      message: 'This member holds no accreditation to transfer.',
      status: 409,
    };
  if (/ACCREDITATION_KIND_CONFLICT/.test(message))
    return {
      code: 'CONFLICT',
      message: 'This member already holds an accreditation of the other kind.',
      status: 409,
    };
  if (/INVALID_HIERARCHY_DIRECTION|HIERARCHY_ROLE_REQUIRED/.test(message))
    return {
      code: 'VALIDATION_ERROR',
      message: 'Choose the correct immediate head for the new position.',
      status: 400,
    };
  if (/INVALID_ACCREDITATION_TARGET|INVALID_ACCREDITATION\b/.test(message))
    return {
      code: 'VALIDATION_ERROR',
      message: 'Choose a valid position for this member.',
      status: 400,
    };
  if (/TRANSFER_REASON_REQUIRED/.test(message))
    return { code: 'VALIDATION_ERROR', message: 'Give a reason for the transfer.', status: 400 };
  if (/APPLICATION_NOT_FOUND/.test(message))
    return { code: 'NOT_FOUND', message: 'Accreditation record not found.', status: 404 };
  if (
    /INVALID_OST_FORM|INVALID_REFERRAL_CODE|INVALID_TRANSFER|not-null|check constraint/.test(
      message,
    )
  )
    return { code: 'VALIDATION_ERROR', message: 'Some fields need attention', status: 400 };
  if (/duplicate key|23505/.test(message))
    return {
      code: 'CONFLICT',
      message: 'A record with these details already exists.',
      status: 409,
    };
  if (/ROLE_NOT_FOUND/.test(message))
    return { code: 'INTERNAL', message: 'The OST role is not configured.', status: 500 };
  return null;
}

export async function inviteAndInstallDirectOst(
  db: Db,
  input: {
    applicationId: string;
    actorId: string;
    email: string;
    fullName: string;
    startsOn: string;
    expiresOn: string;
  },
): Promise<OstDirectInstall> {
  const existing = await db
    .from('ost_members')
    .select('id')
    .eq('application_id', input.applicationId)
    .maybeSingle();
  if (existing.error)
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Unable to verify the approval outcome. Review before retrying.',
      status: 500,
    };
  let memberId = existing.data?.id as string | undefined;
  if (!memberId) {
    const redirectTo = resolveAdminUrl();
    if (!redirectTo)
      return {
        ok: false,
        code: 'INTERNAL',
        message: 'Account invitation is not configured.',
        status: 500,
      };
    const invited = await db.auth.admin.inviteUserByEmail(input.email, {
      redirectTo,
      data: { full_name: input.fullName },
    });
    if (invited.error || !invited.data?.user)
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'Unable to invite this account. Review existing accounts before retrying.',
        status: 409,
      };
    memberId = invited.data.user.id as string;
  }
  const installed = await db.rpc('install_direct_ost_accreditation', {
    p_application_id: input.applicationId,
    p_actor_id: input.actorId,
    p_auth_id: memberId,
    p_starts_on: input.startsOn,
    p_expires_on: input.expiresOn,
  });
  if (installed.error) {
    const failure = ostDirectFailure(installed.error);
    if (failure) return { ok: false, ...failure };
    throw installed.error;
  }
  return { ok: true, memberId, termId: installed.data ? String(installed.data) : null };
}
