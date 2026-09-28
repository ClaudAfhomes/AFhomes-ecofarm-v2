type VercelUrlEnv = {
  AFHOMES_ADMIN_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

const httpsUrl = (host: string): string | null => {
  const value = host.trim();
  if (!value || /[\s/@]/.test(value)) return null;
  try {
    const parsed = new URL(`https://${value}`);
    return parsed.protocol === 'https:' && parsed.pathname === '/' ? parsed.origin : null;
  } catch {
    return null;
  }
};

/**
 * Resolve the server-controlled staff invitation target.
 *
 * An explicit operator value wins. Otherwise Vercel previews use their own
 * deployment host, while production uses the stable project production host.
 * Request headers are deliberately ignored so Host/X-Forwarded-Host input can
 * never become an Auth email redirect.
 */
export function resolveAdminUrl(env: VercelUrlEnv = process.env): string | null {
  const configured = env.AFHOMES_ADMIN_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (
        (parsed.protocol === 'https:' ||
          (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) &&
        !parsed.username &&
        !parsed.password
      ) {
        return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '') || ''}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  const host =
    env.VERCEL_ENV === 'production'
      ? env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL
      : env.VERCEL_URL ?? env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin = host ? httpsUrl(host) : null;
  return origin ? `${origin}/admin` : null;
}
