/**
 * Local API dev server - Q1 Vercel Functions fallback for `vercel dev`.
 * Runs on :3000 so Vite proxy `/api → http://localhost:3000` works without
 * `@vercel/static-build` / `turbo run build`.
 *
 * Reuses the exact same router as the deployed single Vercel function
 * (`api/v1/[...slug].ts`) via `api/_lib/router.ts` - no logic is duplicated.
 * Security/auth/validation/RLS behavior is preserved because the same handler
 * code is invoked.
 *
 * Usage: pnpm exec tsx api/dev-server.ts        (port 3000)
 *        pnpm exec tsx api/dev-server.ts 3001   (custom port)
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { findRouteCoverageGaps } from './_lib/route-coverage.js';
import { getSupabaseEnv } from './_lib/env.js';
import { toErrorEnvelope } from './_lib/envelope.js';
import { routeRequest } from './_lib/router.js';

// ---------------------------------------------------------------------------
// Load root .env (Node-compatible, no Vite). Mirrors supabase/seed.ts.
// Root `.env.local` is the documented single override file (see AGENTS.md),
// so it must be loaded here: the previous version only read root `.env` plus
// the per-app files, which meant a root-only setup left SUPABASE_URL and the
// service key empty and every authenticated call failed. Real process env
// (shell / Vercel dashboard) always wins; among files, later files win so
// apps/<app>/.env.local can still override the shared root file.
// ---------------------------------------------------------------------------
const initialEnvKeys = new Set(Object.keys(process.env));
function loadEnvFile(path: string) {
  try {
    const content = fs.readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Allow quoted values pasted from dashboards (`KEY="val"`).
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (!key || !value) continue;
      // Never overwrite a real environment variable; files only fill gaps
      // (later files overwrite earlier files so app-specific wins over root).
      if (initialEnvKeys.has(key)) continue;
      process.env[key] = value;
    }
  } catch {}
}
loadEnvFile('.env');
loadEnvFile('.env.local');
loadEnvFile('apps/web/.env.local');
loadEnvFile('apps/admin/.env.local');

const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);

function toVercelHeaders(
  nodeHeaders: http.IncomingHttpHeaders,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(nodeHeaders)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : (v as string | undefined);
  }
  return out;
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      // Try JSON, else leave as string (handler will handle)
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const method = req.method ?? 'GET';
  const host = req.headers.host ?? `localhost:${port}`;
  const fullUrl = `http://${host}${req.url ?? '/'}`;
  let url: URL;
  try {
    url = new URL(fullUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid URL' } }));
    return;
  }

  const pathname = url.pathname;
  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  const body = await parseBody(req);
  const vercelReq = {
    method,
    query,
    headers: toVercelHeaders(req.headers),
    body,
    url: pathname + url.search,
  };

  // Adapt Node ServerResponse to the VercelResponse shape handlers expect.
  const headersOut: Record<string, string> = {};
  let statusCode = 200;
  const vercelRes: Record<string, unknown> & {
    setHeader: (n: string, v: string) => void;
    status: (c: number) => typeof vercelRes;
    json: (b: unknown) => void;
    end: () => void;
  } = {
    setHeader: (n: string, v: string) => {
      headersOut[n.toLowerCase()] = v;
    },
    status: (code: number) => {
      statusCode = code;
      return vercelRes;
    },
    json: (body: unknown) => {
      const payload = JSON.stringify(body);
      headersOut['content-type'] = headersOut['content-type'] ?? 'application/json';
      res.writeHead(statusCode, headersOut);
      res.end(payload);
      const ms = Date.now() - started;
      // On 401, note whether credentials were even sent (no values logged):
      // `no-credentials` = frontend/session issue (logged out, expired, cookie
      // not forwarded); `credentials-rejected` = backend rejected a token.
      let authHint = '';
      if (statusCode === 401) {
        const h = vercelReq.headers as Record<string, string | undefined>;
        const hasBearer = typeof h.authorization === 'string' && h.authorization.length > 0;
        const cookie = typeof h.cookie === 'string' ? h.cookie : '';
        const hasCookie = /(?:^|;\s*)sb-[^;=]+-auth-token(?:\s*=)/.test(cookie);
        authHint = hasBearer || hasCookie ? ' (credentials-rejected)' : ' (no-credentials)';
      }
      console.log(`[dev-server] ${method} ${pathname} -> ${statusCode} (${ms}ms)${authHint}`);
    },
    end: () => {
      res.writeHead(statusCode, headersOut);
      res.end();
      const ms = Date.now() - started;
      console.log(`[dev-server] ${method} ${pathname} -> ${statusCode} (${ms}ms)`);
    },
  };

  try {
    const handled = await routeRequest(vercelReq, vercelRes);
    if (!handled) {
      const { error } = toErrorEnvelope('NOT_FOUND', `No handler for ${pathname}`, 404);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error }));
      console.log(`[dev-server] ${method} ${pathname} -> 404 (no handler)`);
    }
  } catch (e) {
    const err = e as Error;
    // eslint-disable-next-line no-console
    console.error(`[dev-server] request error for ${method} ${pathname}:`, err?.message ?? err);
    if (!res.headersSent) {
      const { error } = toErrorEnvelope('INTERNAL', 'Internal server error', 500);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error }));
    }
  }
});

server.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[dev-server] listen error:', err);
  process.exit(1);
});

// Route-coverage self-check: every handler file must be imported AND
// referenced in a routing branch (in `api/_lib/router.ts`), otherwise its
// requests 404 with "No handler for ...". Warn loudly instead of failing.
const thisFile = fileURLToPath(import.meta.url);
const routerFile = path.join(path.dirname(thisFile), '_lib', 'router.ts');
for (const gap of findRouteCoverageGaps(
  path.join(path.dirname(thisFile), '_handlers'),
  fs.readFileSync(routerFile, 'utf8'),
)) {
  // eslint-disable-next-line no-console
  console.warn(
    `[dev-server] WARNING: ${gap.file} is ${gap.reason === 'not-imported' ? 'not imported' : 'imported but never routed'} - requests to it will 404. Add it to the route table.`,
  );
}

// Schema self-check: probe the AF Homes foundation tables via PostgREST so a
// missing migration is caught at startup (loud) instead of every endpoint
// returning "Could not find the table ... in the schema cache".
// Skipped when Supabase is not configured (mock/dev-server-only mode).
const REQUIRED_TABLES = ['modules', 'roles', 'departments', 'staff_users'] as const;

void (async () => {
  const { url, serviceKey } = getSupabaseEnv();
  if (!url || !serviceKey) return;
  const { createClient } = await import('@supabase/supabase-js');
  const svc = createClient(url, serviceKey, { auth: { autoRefreshToken: false } });
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    const { error } = await svc.from(table).select('*').limit(1);
    if (error) missing.push(table);
  }
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[dev-server] FATAL: AF Homes schema incomplete (missing: ${missing.join(', ')}) - run \`pnpm db:migrate\`.`,
    );
  }
})();

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[dev-server] API listening on http://localhost:${port} (api/v1/*)`);
  // eslint-disable-next-line no-console
  console.log(
    `[dev-server] Vite proxy /api -> http://localhost:${port} (see apps/web|admin/vite.config.ts)`,
  );
});
