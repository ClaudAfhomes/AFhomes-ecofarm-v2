/**
 * Normalized Philippine address vocabulary.
 *
 * These types are the AF Homes contract, deliberately NOT a mirror of any
 * provider's response shape. A provider adapter owns every source-specific
 * field name; application code sees only `code`/`name`/`type`.
 *
 * `code` is the official PSGC code and is the ONLY geographic identifier the
 * server trusts. Names are display values and are never proof of hierarchy -
 * a submitted name is re-resolved against the provider and discarded.
 *
 * Names keep the authority's casing and spelling exactly. Any encoding repair is
 * the provider adapter's job and happens before a value reaches this schema, so
 * this schema must never become a transcoder.
 */
import { z } from 'zod';

/** PSGC codes are 10 digits. Anything else is a different vintage or a typo. */
export const geographicCodeSchema = z
  .string()
  .regex(/^\d{10}$/, 'Use the official 10-digit PSGC code');

export const provinceSchema = z.object({
  code: geographicCodeSchema,
  name: z.string().trim().min(1),
});
export type Province = z.infer<typeof provinceSchema>;

/**
 * City and municipality stay distinct. Collapsing them into one string loses
 * the distinction the official form asks for, and it is the difference between
 * an independent city and a municipality under the same province.
 */
export const localityTypeSchema = z.enum(['city', 'municipality']);
export type LocalityType = z.infer<typeof localityTypeSchema>;

export const localitySchema = z.object({
  code: geographicCodeSchema,
  name: z.string().trim().min(1),
  type: localityTypeSchema,
  provinceCode: geographicCodeSchema,
});
export type Locality = z.infer<typeof localitySchema>;

export const barangaySchema = z.object({
  code: geographicCodeSchema,
  name: z.string().trim().min(1),
  localityCode: geographicCodeSchema,
});
export type Barangay = z.infer<typeof barangaySchema>;

/** Path/query parameter for a single geographic level. */
export const addressHierarchyQuerySchema = geographicCodeSchema;

/** The verified triple a submitted application must carry, or nothing. */
export const addressHierarchySchema = z.object({
  provinceCode: geographicCodeSchema,
  localityCode: geographicCodeSchema,
  barangayCode: geographicCodeSchema,
});
export type AddressHierarchy = z.infer<typeof addressHierarchySchema>;