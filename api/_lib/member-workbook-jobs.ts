import { z } from 'zod';
import { createMemberSchema, memberWorkbookJobsSchema } from '@afhomes/contracts';
import { authorizeAfHomes } from './afhomes-access.js';
import { deny, fail, jsonBody, method, subPath, type Db } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

export async function readMemberWorkbookJobs(db: Db, actor: string, jobId: string | null = null) {
  const result = await db.rpc('get_member_workbook_jobs', { p_actor: actor, p_job: jobId });
  if (result.error)
    throw new Error(
      'Import job storage is unavailable; the reviewed migration must be applied before importing.',
    );
  return memberWorkbookJobsSchema.parse(result.data);
}

/** Fixed Auth UUID + admin-owned row marker prevent adoption of unrelated accounts. */
export async function provisionMemberWorkbookRow(
  db: Db,
  actor: string,
  jobId: string,
  rowId: string,
  evidenceVerified: boolean,
  temporaryPassword: string,
) {
  const claimed = await db.rpc('claim_member_workbook_row', {
    p_actor: actor,
    p_job: jobId,
    p_row: rowId,
    p_evidence_verified: evidenceVerified,
  });
  if (claimed.error)
    throw new Error(
      'This row is held for review, conflicts with an existing record, or needs its parent imported first. No new account was requested.',
    );
  if (claimed.data?.completed) return;
  const authId = z.string().uuid().parse(claimed.data?.authId);
  const email = z.email().parse(claimed.data?.email);
  const owned = (
    user: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null,
  ) =>
    user?.id === authId &&
    user.email?.toLowerCase() === email.toLowerCase() &&
    user.app_metadata?.member_import_row_id === rowId;
  const before = await db.auth.admin.getUserById(authId);
  if (before.error && before.data?.user)
    throw new Error('Account lookup is uncertain. Resume this same job after service recovery.');
  if (before.data?.user && !owned(before.data.user))
    throw new Error('Reserved account ownership could not be verified. Stop for review.');
  if (!before.data?.user) {
    // A transport failure is not evidence that the account is absent.
    if (
      !before.error ||
      (!['user_not_found', 'not_found'].includes(before.error.code ?? '') &&
        before.error.status !== 404)
    )
      throw new Error('Account lookup is uncertain. Resume this same job after service recovery.');
    const created = await db.auth.admin.createUser({
      id: authId,
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { member_import_row_id: rowId },
    });
    if (created.error || !owned(created.data?.user ?? null)) {
      const recovered = await db.auth.admin.getUserById(authId);
      if (!owned(recovered.data?.user ?? null))
        throw new Error(
          'Account creation is unconfirmed. Resume only this job; never create a replacement account.',
        );
    }
  }
  const installed = await db.rpc('install_member_workbook_row', {
    p_actor: actor,
    p_job: jobId,
    p_row: rowId,
  });
  if (installed.error)
    throw new Error(
      'Import is not confirmed. The reserved account remains bound to this job; resume it after reviewing the conflict. Do not use its login until import is confirmed.',
    );
}

export async function handleMemberWorkbookJobs(req: VercelRequest, res: VercelResponse, db: Db) {
  const path = subPath(req);
  const read = /^workbook\/jobs(?:\/([0-9a-f-]+))?$/.exec(path);
  const confirm = /^workbook\/jobs\/([0-9a-f-]+)\/rows\/([0-9a-f-]+)\/confirm$/.exec(path);
  if ((!read || method(req) !== 'GET') && (!confirm || method(req) !== 'POST'))
    return fail(res, 'NOT_FOUND', 'Import job endpoint not found.', 404);
  const auth = await authorizeAfHomes(req, 'network.members', 'create');
  if ('error' in auth) return deny(res, auth);
  if (!['admin', 'super_admin'].includes(auth.roleSlug))
    return fail(res, 'FORBIDDEN', 'Administrator review is required.', 403);
  res.setHeader('Cache-Control', 'no-store');
  const jobId = confirm?.[1] ?? read?.[1] ?? null;
  if (jobId && !z.uuid().safeParse(jobId).success)
    return fail(res, 'VALIDATION_ERROR', 'Invalid job.', 400);
  try {
    if (confirm) {
      const body = z
        .object({
          evidenceVerified: z.boolean(),
          temporaryPassword: createMemberSchema.shape.temporaryPassword,
        })
        .strict()
        .safeParse(jsonBody(req));
      if (!body.success || !z.uuid().safeParse(confirm[2]).success)
        return fail(
          res,
          'VALIDATION_ERROR',
          'Review and explicitly confirm this row with a temporary password.',
          400,
        );
      try {
        await provisionMemberWorkbookRow(
          db,
          auth.userId,
          jobId!,
          confirm[2]!,
          body.data.evidenceVerified,
          body.data.temporaryPassword,
        );
      } catch (e) {
        // Only a fixed code is recorded; no provider error, identity value or credential is logged.
        await db.rpc('record_member_workbook_failure', {
          p_actor: auth.userId,
          p_job: jobId!,
          p_row: confirm[2]!,
        });
        throw e;
      }
    }
    return res.status(200).json(await readMemberWorkbookJobs(db, auth.userId, jobId));
  } catch (e) {
    return fail(
      res,
      'CONFLICT',
      e instanceof Error ? e.message : 'Import job is unavailable.',
      409,
    );
  }
}
