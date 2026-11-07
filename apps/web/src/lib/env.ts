import { loadPublicEnv } from '@afhomes/config';

/**
 * Typed public environment for the public app. Only `VITE_`-prefixed values are
 * available in the client bundle (DEVELOPMENT-GUIDELINES §18).
 */
export const env = loadPublicEnv(import.meta.env);
