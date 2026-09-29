type CustomerUrlEnv = {
  AFHOMES_WEB_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

function safeOrigin(value: string, allowPath: boolean): string | null {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && loopback.has(parsed.hostname))) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (!allowPath && parsed.pathname !== '/')
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the server-controlled customer portal origin.
 *
 * Request headers are deliberately ignored so an attacker-controlled Host or
 * X-Forwarded-Host value can never become an emailed activation link.
 */
export function resolveCustomerPortalOrigin(env: CustomerUrlEnv = process.env): string | null {
  const configured = env.AFHOMES_WEB_URL?.trim();
  if (configured) return safeOrigin(configured, true);

  const host =
    env.VERCEL_ENV === 'production'
      ? (env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL)
      : (env.VERCEL_URL ?? env.VERCEL_PROJECT_PRODUCTION_URL);
  return host ? safeOrigin(`https://${host.trim()}`, false) : null;
}

/**
 * Put the bearer token in the URL fragment. Fragments reach the browser but
 * are not sent to the web server, access logs, proxies, or Referer headers.
 */
export function customerActivationUrl(
  token: string,
  env: CustomerUrlEnv = process.env,
): string | null {
  const origin = resolveCustomerPortalOrigin(env);
  if (!origin || !token) return null;
  return `${origin}/customer/activate#token=${encodeURIComponent(token)}`;
}
