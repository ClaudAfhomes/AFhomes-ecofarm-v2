import { featureFlagsSchema, updateFeatureFlagsSchema } from '@afhomes/contracts/feature-flags';
import { FEATURE_FLAGS, setFeatureFlags } from '@afhomes/shared/features';

import { invalidateFeatureFlags, refreshFeatureFlags } from '../_lib/feature-flags.js';
import { deny, fail, jsonBody, mapRpcError, method, subPath } from '../_lib/handler-kit.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

/**
 * Module switches (migrations 20270105000025/26):
 *
 *   GET settings/features   public: one boolean per module, nothing else. Both apps read it
 *                           before rendering so hidden modules never flash.
 *   PUT settings/features   governance.config update; body = only the changed switches.
 *                           SQL re-checks the permission and writes the audit row.
 *
 * This family is never gated by a module switch itself.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (subPath(req) !== 'features') return fail(res, 'NOT_FOUND', 'Route not found.', 404);
  const verb = method(req);
  if (verb === 'GET') {
    await refreshFeatureFlags();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(featureFlagsSchema.parse({ ...FEATURE_FLAGS }));
  }
  if (verb !== 'PUT') return fail(res, 'NOT_FOUND', 'Route not found.', 404);

  const { authorizeAfHomes } = await import('../_lib/afhomes-access.js');
  const auth = await authorizeAfHomes(req, 'governance.config', 'update');
  if ('error' in auth) return deny(res, auth);
  const parsed = updateFeatureFlagsSchema.safeParse(jsonBody(req));
  if (!parsed.success)
    return fail(
      res,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the modules.',
      400,
    );
  const svc = serviceClient();
  if (!svc) return fail(res, 'INTERNAL', 'Settings storage is unavailable.', 503);
  const { data, error } = await svc.rpc('update_feature_flags', {
    p_actor: auth.userId,
    p_input: parsed.data,
  });
  if (error) return mapRpcError(res, error);
  setFeatureFlags(data as Record<string, unknown>);
  invalidateFeatureFlags();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(featureFlagsSchema.parse({ ...FEATURE_FLAGS }));
}
