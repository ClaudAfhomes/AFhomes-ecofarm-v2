import { z } from 'zod';

/**
 * Public (client-exposed) environment schema. Only `VITE_`-prefixed values may
 * ship to the browser bundle (DEVELOPMENT-GUIDELINES §18; FOLDER-STRUCTURE §7).
 * Private/backend configuration NEVER appears here.
 */
const vitePublicEnvSchema = z.object({
  /** Base URL of the AF Homes REST API. Defaults to same-origin `/api/v1`. */
  VITE_API_BASE_URL: z.string().min(1).default('/api/v1'),
  /** Base URL of the Admin application for cross-origin redirects from the web origin. */
  VITE_ADMIN_URL: z.string().min(1).default('http://localhost:5174/admin'),
  /** Base URL of the Web (public/member) application for cross-origin redirects from the admin origin. */
  VITE_WEB_URL: z.string().min(1).default('http://localhost:5173'),
  /** Supabase project URL (public). Get from Supabase Dashboard → Project Settings → API. */
  VITE_SUPABASE_URL: z.string().url().optional(),
  /** Supabase anonymous key (public, RLS enforced). */
  VITE_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  /** Current Supabase browser credential; preferred over the legacy anon key. */
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof vitePublicEnvSchema>;

/**
 * Parse an environment record (e.g. Vite's `import.meta.env`) into the typed
 * public config. Unknown keys are ignored; a missing or malformed required
 * value throws a Zod error at bootstrap.
 */
export function loadPublicEnv(env: Record<string, unknown>): PublicEnv {
  return vitePublicEnvSchema.parse(env);
}
