import { z } from 'zod';

/** Module switches (Admin > Settings > Modules). Keys mirror `@afhomes/shared` FEATURE_FLAG_KEYS. */
export const featureFlagsSchema = z.object({
  sales: z.boolean(),
  finance: z.boolean(),
  payroll: z.boolean(),
  commissions: z.boolean(),
  network: z.boolean(),
  services: z.boolean(),
  redemption: z.boolean(),
  reports: z.boolean(),
  cms: z.boolean(),
});
export type FeatureFlagsResponse = z.infer<typeof featureFlagsSchema>;

/** A save sends only the switches that changed; at least one is required. */
export const updateFeatureFlagsSchema = featureFlagsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Change at least one module.' });
export type UpdateFeatureFlagsRequest = z.infer<typeof updateFeatureFlagsSchema>;
