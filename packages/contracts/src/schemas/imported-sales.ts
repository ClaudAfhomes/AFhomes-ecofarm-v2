import { z } from 'zod';
import { exactDecimalStringSchema } from './money.js';

export const importedSalesQuerySchema = z
  .object({
    view: z.enum(['my-sales', 'team-sales']).default('my-sales'),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Start date must not follow end date');

export const importedSalesListSchema = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      reference: z.string(),
      customerName: z.string().nullable(),
      customerNumber: z.string(),
      tier: z.string(),
      status: z.string(),
      roles: z.array(z.string()),
      amount: exactDecimalStringSchema.nullable(),
      commissionPolicy: z.enum(['settled_before_system', 'normal_qualification']),
    }),
  ),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export type ImportedSalesList = z.infer<typeof importedSalesListSchema>;
