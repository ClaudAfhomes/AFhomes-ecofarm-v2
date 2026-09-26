/**
 * Vercel build helper: derive VITE_WEB_URL / VITE_ADMIN_URL when they are not
 * explicitly set in the project env. Both apps live on the same origin (web at
 * `/`, admin at `/admin`), so the redirect targets must stay on the CANONICAL
 * host - otherwise login on the production domain redirects to a
 * per-deployment URL, a different origin whose localStorage cannot see the
 * session, and the user bounces back to login. Prefer
 * `VERCEL_PROJECT_PRODUCTION_URL` (the stable production domain); fall back to
 * `VERCEL_URL` (previews) when it is unset. Real process-env values win over
 * the written `.env.production` files.
 *
 * Do NOT set VITE_WEB_URL / VITE_ADMIN_URL in the Vercel project env: that
 * pins them to one host and breaks preview deployments.
 */
import { writeFileSync } from 'node:fs';

const url = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
if (!url) process.exit(0);

const lines = [];
if (!process.env.VITE_WEB_URL) lines.push(`VITE_WEB_URL=https://${url}`);
if (!process.env.VITE_ADMIN_URL) lines.push(`VITE_ADMIN_URL=https://${url}/admin`);

if (lines.length > 0) {
  const body = `${lines.join('\n')}\n`;
  writeFileSync('apps/web/.env.production', body);
  writeFileSync('apps/admin/.env.production', body);
}
