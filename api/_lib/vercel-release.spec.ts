import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
describe('VIP release deployment guard', () => {
  it('disables Git deployment only for claud/develop without wildcard re-enablement', () => {
    expect(config.git.deploymentEnabled).toEqual({ 'claud/develop': false });
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
});
