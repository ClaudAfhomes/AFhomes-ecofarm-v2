/** Build subprocesses receive public configuration and a small OS/tool allowlist only. */
export function hostedBuildEnvironment(
  input: NodeJS.ProcessEnv,
  origin: string,
  envDir: string,
): NodeJS.ProcessEnv {
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('A public HTTPS build origin is required');
  const safe: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'PNPM_HOME',
    'COREPACK_HOME',
    'COREPACK_ENABLE_DOWNLOAD_PROMPT',
    'CI',
  ])
    if (input[key] !== undefined) safe[key] = input[key];
  return {
    ...safe,
    NODE_ENV: 'production',
    AFHOMES_DEV_ENV_DIR: envDir,
    VITE_AUTH_PROVIDER: 'mongodb',
    VITE_API_BASE_URL: '/api/v1',
    VITE_WEB_URL: base.origin,
    VITE_ADMIN_URL: base.origin + '/admin',
    ...(input.VITE_TURNSTILE_SITE_KEY
      ? { VITE_TURNSTILE_SITE_KEY: input.VITE_TURNSTILE_SITE_KEY }
      : {}),
  };
}
