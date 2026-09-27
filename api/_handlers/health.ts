import { setCors } from '../_lib/cors.js';
import { getSupabaseEnv } from '../_lib/env.js';
import { toErrorEnvelope } from '../_lib/envelope.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';
import { serviceClient } from '../_lib/rest.js';

/**
 * GET /health (+ /api/v1/health via the vercel.json rewrite, and the daily
 * Vercel cron) - liveness plus a real dependency check.
 *
 * `ok` is the single field a monitor should alert on: it is true only when the
 * API is up AND its database answers. A reachable API whose database is
 * unavailable returns 503, so an uptime check cannot mistake a broken database
 * for a healthy service.
 *
 * The probe reads `modules`: a small, always-present AF Homes table the whole
 * permission model depends on, so a failure means the schema is genuinely
 * unusable rather than one optional table being absent.
 *
 * Response shape is stable (`ok`, `db`, `service`, `time`) and deliberately
 * free of credentials, keys, SQL, stack traces, and environment values.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res, req, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    const { error, status } = toErrorEnvelope('NOT_FOUND', `Method ${req.method} not allowed`, 405);
    res.status(status).json({ error });
    return;
  }

  // Unconfigured Supabase is a deployment fault, not a dependency outage: 500.
  const { url, serviceKey } = getSupabaseEnv();
  if (!url || !serviceKey) {
    const { error } = toErrorEnvelope('INTERNAL', 'Health dependency is not configured', 500);
    res.status(500).json({
      ok: false,
      db: 'error',
      service: 'afhomes-api',
      time: new Date().toISOString(),
      error,
    });
    return;
  }

  let db: 'ok' | 'error' = 'ok';
  try {
    const supabase = serviceClient();
    if (!supabase) {
      db = 'error';
    } else {
      const { error } = await supabase.from('modules').select('key').limit(1);
      if (error) db = 'error';
    }
  } catch {
    db = 'error';
  }

  const healthy = db === 'ok';
  const failure = healthy
    ? {}
    : { error: toErrorEnvelope('INTERNAL', 'Health dependency is unavailable', 503).error };
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    db,
    service: 'afhomes-api',
    time: new Date().toISOString(),
    ...failure,
  });
}
