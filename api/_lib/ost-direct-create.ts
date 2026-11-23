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
 * Password provisioning and SQL cannot share a transaction. Only an account
 * created by this request may be removed after a confirmed SQL rejection;
 * uncertain outcomes are preserved for review.
 */
import type { Db, FailureCode } from './handler-kit.js';
import { saveProfilePhoto, removeProfilePhoto } from './profile-photo.js';

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
  if (/OST_ACCREDITATION_EXPIRED_REQUIRED/.test(message))
    return {
      code: 'CONFLICT',
      message: 'OST accreditation must expire before a team change can be approved.',
      status: 409,
    };
  if (/OST_TRANSFER_SAME_TEAM|OST_TRANSFER_GENEALOGY_CONFLICT/.test(message))
    return {
      code: 'CONFLICT',
      message:
        'Choose a different active Sales Manager and refresh the current team before retrying.',
      status: 409,
    };
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

export async function createAndInstallDirectOst(
  db: Db,
  input: {
    applicationId: string;
    actorId: string;
    email: string;
    fullName: string;
    temporaryPassword: string;
    aaNumber: string | null;
    startsOn: string;
    expiresOn: string;
    profilePhotoBase64?: string | undefined;
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
  let createdHere = false;
  if (!memberId) {
    const created = await db.auth.admin.createUser({
      email: input.email,
      password: input.temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
    if (created.error || !created.data?.user) {
      const duplicate = /already.*(registered|exists)|duplicate/i.test(
        String(created.error?.message ?? ''),
      );
      return {
        ok: false,
        code: duplicate ? 'CONFLICT' : 'INTERNAL',
        message:
          'Unable to create this login. Review the password and existing accounts before retrying.',
        status: duplicate ? 409 : 500,
      };
    }
    memberId = created.data.user.id as string;
    createdHere = true;
  }
  if (createdHere && input.profilePhotoBase64) {
    try {
      await saveProfilePhoto(memberId, input.profilePhotoBase64);
    } catch {
      const removed = await db.auth.admin.deleteUser(memberId);
      let cleanupFailed = !!removed.error;
      try {
        await removeProfilePhoto(memberId);
      } catch {
        cleanupFailed = true;
      }
      return {
        ok: false,
        code: 'INTERNAL',
        status: 503,
        message: cleanupFailed
          ? 'Account cleanup needs administrator review before retrying.'
          : 'Could not save the profile photo. Retry using the same application.',
      };
    }
  }
  const installed = await db.rpc('install_direct_ost_password', {
    p_application_id: input.applicationId,
    p_actor_id: input.actorId,
    p_auth_id: memberId,
    p_starts_on: input.startsOn,
    p_expires_on: input.expiresOn,
    p_aa_number: input.aaNumber,
  });
  if (installed.error) {
    // A transport failure may hide a committed install. Never delete on uncertainty.
    if (createdHere && /^(22|23|42|P0001)/.test(String(installed.error.code ?? ''))) {
      const outcome = await db.from('ost_members').select('id').eq('id', memberId).maybeSingle();
      if (!outcome.error && !outcome.data) {
        const removed = await db.auth.admin.deleteUser(memberId);
        if (removed.error)
          return {
            ok: false,
            code: 'INTERNAL',
            status: 500,
            message: 'Account cleanup needs administrator review before retrying.',
          };
        if (input.profilePhotoBase64) await removeProfilePhoto(memberId);
      }
    }
    const failure = ostDirectFailure(installed.error);
    if (failure) return { ok: false, ...failure };
    throw installed.error;
  }
  return { ok: true, memberId, termId: installed.data ? String(installed.data) : null };
}
