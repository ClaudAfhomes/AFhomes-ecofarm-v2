import { loadPublicEnv } from '../packages/config/src/env.js';

/** Begin the public startup read while the application's modules download. */
export function preloadFeatureFlags() {
  let endpoint = '';
  return {
    name: 'afhomes-feature-flags-preload',
    configResolved(config: { env: Record<string, unknown> }) {
      endpoint = `${loadPublicEnv(config.env).VITE_API_BASE_URL}/settings/features`;
    },
    transformIndexHtml() {
      return [{
        tag: 'link',
        attrs: { rel: 'preload', as: 'fetch', href: endpoint, crossorigin: 'anonymous' },
        injectTo: 'head' as const,
      }];
    },
  };
}
