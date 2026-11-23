import { featureFlagsSchema } from '@afhomes/contracts';
import { setFeatureFlags } from '@afhomes/shared';

import { request } from './api/client';

/**
 * Loads the module switches (Admin > Settings > Modules) before the first
 * render. A slow or failed read keeps the code defaults (every module ON);
 * the server still enforces the stored switches on every API call.
 */
export async function loadFeatureFlags(): Promise<void> {
  try {
    setFeatureFlags(
      await request('/settings/features', featureFlagsSchema, {
        auth: 'none',
        signal: AbortSignal.timeout(3000),
      }),
    );
  } catch {
    // Keep the defaults; never block the app on this read.
  }
}
