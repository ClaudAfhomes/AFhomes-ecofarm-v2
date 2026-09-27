import { z } from 'zod';
import { hierarchyRoleSchema } from './lifecycle.js';

export const genealogyStatusSchema = z.enum(['invited','active','inactive','suspended']);
export const genealogyNodeSchema = z.object({
  staffId:z.string().uuid(), fullName:z.string(), role:hierarchyRoleSchema,
  status:genealogyStatusSchema, ostStatus:z.enum(['active','inactive','suspended']).nullable(),
  uplineStaffId:z.string().uuid().nullable(), directDownlineCount:z.number().int().nonnegative(),
  totalDescendantCount:z.number().int().nonnegative(),
});
export const genealogySummarySchema = z.object({
  staffId:z.string().uuid(), totalDirectDownline:z.number().int().nonnegative(),
  totalDescendants:z.number().int().nonnegative(), activeSellerCount:z.number().int().nonnegative(),
  inactiveSellerCount:z.number().int().nonnegative(),
  roleCounts:z.object({vice_director:z.number().int().nonnegative(),senior_sales_manager:z.number().int().nonnegative(),sales_manager:z.number().int().nonnegative(),ost:z.number().int().nonnegative()}),
});
export type GenealogyNode=z.infer<typeof genealogyNodeSchema>;
export type GenealogySummary=z.infer<typeof genealogySummarySchema>;
