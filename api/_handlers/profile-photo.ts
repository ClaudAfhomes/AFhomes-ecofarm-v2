import { randomUUID } from 'node:crypto';
import {
  PROFILE_PHOTO_MAX_EDGE,
  profilePhotoInputSchema,
} from '@afhomes/contracts';
import { resolveAfHomesPrincipal } from '../_lib/afhomes-access.js';
import { resolveCustomerPrincipal } from '../_lib/customer-access.js';
import { deny, fail, jsonBody, method, subPath } from '../_lib/handler-kit.js';
import { storageClient } from '../_lib/storage.js';
import { PROFILE_PHOTO_BUCKET, profilePhotoPath, decodeProfilePhoto } from '../_lib/profile-photo.js';
import { consumeIdentifierAttempt } from '../_lib/rate-limit.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const scope = subPath(req),
    verb = method(req);
  if (!['staff', 'customer'].includes(scope) || !['GET', 'PUT'].includes(verb))
    return fail(res, 'NOT_FOUND', 'Route not found.', 404);
  try {
    const principal =
      scope === 'staff' ? await resolveAfHomesPrincipal(req) : await resolveCustomerPrincipal(req);
    if ('error' in principal) return deny(res, principal);
    const canUpload =
      'mustChangePassword' in principal
        ? !principal.mustChangePassword && !principal.mfaRequired
        : principal.status === 'active';
    if (verb === 'PUT' && !canUpload)
      return fail(
        res,
        'FORBIDDEN',
        'Complete account verification before changing your photo.',
        403,
      );
    const storage = storageClient();
    if (!storage)
      return fail(res, 'INTERNAL', 'Profile photos are unavailable. Please retry.', 503);
    const bucket = storage.from(PROFILE_PHOTO_BUCKET),
      path = profilePhotoPath(principal.userId);
    let saved = false;
    if (verb === 'PUT') {
      const verdict = consumeIdentifierAttempt(req, `photo:${principal.userId}`);
      if (!verdict.allowed) {
        res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
        return fail(res, 'RATE_LIMITED', 'Too many uploads. Try again shortly.', 429);
      }
      const input = profilePhotoInputSchema.safeParse(jsonBody(req));
      if (!input.success)
        return fail(res, 'VALIDATION_ERROR', 'Choose a compressed profile image.', 400);
      if (input.data.expectedUserId !== principal.userId)
        return fail(
          res,
          'CONFLICT',
          'Your signed-in account changed. Reload before uploading.',
          409,
        );
      const bytes = decodeProfilePhoto(input.data.dataBase64);
      if (!bytes)
        return fail(
          res,
          'VALIDATION_ERROR',
          `Use a valid JPEG up to 0.5 MB and ${PROFILE_PHOTO_MAX_EDGE} pixels per side.`,
          400,
        );
      // One immutable owner path: upsert replaces old bytes, without delete-before-upload or orphan paths.
      const result = await bucket.upload(path, bytes, {
        contentType: 'image/jpeg',
        cacheControl: '0',
        upsert: true,
      });
      if (result.error)
        return fail(
          res,
          'INTERNAL',
          'Could not confirm your photo upload. Refresh to check before retrying.',
          503,
        );
      saved = true;
    } else {
      const result = await bucket.list(principal.userId, { limit: 1, search: 'profile.jpg' });
      if (result.error)
        return fail(res, 'INTERNAL', 'Profile photos are unavailable. Please retry.', 503);
      if (!result.data.some((object) => object.name === 'profile.jpg'))
        return res.status(200).json({ url: null, expiresAt: null, canUpload, notice: null });
    }
    const signed = await bucket.createSignedUrl(path, 300);
    if (signed.error || !signed.data?.signedUrl) {
      if (!saved) return fail(res, 'INTERNAL', 'Could not load your photo. Please retry.', 503);
      return res.status(200).json({
        url: null,
        expiresAt: null,
        canUpload,
        notice: 'Photo saved. Refresh the preview to view it.',
      });
    }
    // Distinct read URL prevents a previous cached object from appearing after replacement.
    const url = new URL(signed.data.signedUrl);
    url.searchParams.set('v', randomUUID());
    res.status(200).json({
      url: url.href,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      canUpload,
      notice: null,
    });
  } catch {
    fail(res, 'INTERNAL', 'Profile photos are unavailable. Refresh to check before retrying.', 503);
  }
}
