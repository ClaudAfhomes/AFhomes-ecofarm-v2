import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const prepare = fileURLToPath(new URL('../../scripts/prepare-vercel-env.mjs', import.meta.url));
describe('VIP release deployment guard', () => {
  it('enables Git Preview deployment for claud/develop without wildcard changes', () => {
    expect(config.git.deploymentEnabled).toEqual({ 'claud/develop': true });
  });
  it('keeps the monorepo build, API function and customer/staff routing', () => {
    expect(config.installCommand).toBe('pnpm install --filter=!@afhomes/db-testing');
    expect(config.buildCommand).toBe(
      'pnpm typecheck:deploy && node scripts/prepare-vercel-env.mjs && pnpm exec turbo run build && node scripts/assemble-vercel-output.mjs',
    );
    expect(config.functions['api/router.ts'].includeFiles).toBe('packages/**');
    expect(config.rewrites).toContainEqual({
      source: '/api/v1/:path*',
      destination: '/api/router',
    });
    expect(config.rewrites).toContainEqual({
      source: '/admin/:path*',
      destination: '/admin/index.html',
    });
  });

  it.each(['preview', 'production'])('refuses a %s build without the server key', (VERCEL_ENV) => {
    const result = spawnSync(process.execPath, [prepare], {
      encoding: 'utf8',
      env: {
        VERCEL_ENV,
        SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
        VITE_SUPABASE_URL: 'https://fixture.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(result.stderr).not.toContain('public-fixture');
  });

  it('accepts complete Preview configuration without printing credentials', () => {
    const result = spawnSync(process.execPath, [prepare], {
      encoding: 'utf8',
      env: {
        VERCEL_ENV: 'preview',
        SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
        VITE_SUPABASE_URL: 'https://fixture.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
        SUPABASE_SERVICE_ROLE_KEY: 'server-fixture',
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('server-fixture');
  });

  it('leaves offline local builds independent of Vercel credentials', () => {
    const result = spawnSync(process.execPath, [prepare], { encoding: 'utf8', env: {} });
    expect(result.status).toBe(0);
  });
});
