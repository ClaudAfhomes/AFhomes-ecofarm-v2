import { describe, expect, it } from 'vitest';
import { preloadFeatureFlags } from '../../scripts/preload-feature-flags.js';

describe('public startup resource hint', () => {
  it.each([
    [undefined, '/api/v1/settings/features'],
    ['/custom-api', '/custom-api/settings/features'],
    ['https://api.fixture.test/v1', 'https://api.fixture.test/v1/settings/features'],
  ])('uses the same configured API base as the client (%s)', (base, expected) => {
    const plugin = preloadFeatureFlags();
    plugin.configResolved({ env: base ? { VITE_API_BASE_URL: base } : {} });
    const tags = plugin.transformIndexHtml();
    expect(tags).toHaveLength(1);
    expect(tags[0]?.attrs).toMatchObject({
      href: expected, as: 'fetch', rel: 'preload', crossorigin: 'anonymous',
    });
  });
});
