import { z } from 'zod';

/**
 * Phase 15 Reports and Audit Center contracts.
 *
 * Every report is served from the same scoped server-side query whether it is
 * rendered on screen (`format=json`) or exported (`format=csv|xlsx|pdf`). An
 * export is a JSON envelope carrying the file bytes as base64: the API's
 * response shape only offers `json`/`end`, so a raw binary body would need
 * adapter changes in the dev server, the Vercel function, and every test
 * double. Base64-in-JSON keeps all three identical, and the browser turns it
 * back into a download without ever computing a row itself.
 */

export const reportTypeSchema = z.enum([
  'sales',
  'customers',
  'payments',
  'memberships',
  'commissions',
  'redemptions',
  'genealogy',
  'ost',
  'points',
  'plans',
]);
export type ReportType = z.infer<typeof reportTypeSchema>;

export const reportFormatSchema = z.enum(['json', 'csv', 'xlsx', 'pdf']);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

export const REPORT_EXPORT_CAP = 5000;
export const REPORT_PAGE_MAX = 200;

export const reportQuerySchema = z.object({
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  status: z.string().trim().max(40).optional(),
  planId: z.string().uuid().optional(),
  seller: z.string().uuid().optional(),
  role: z.string().trim().max(40).optional(),
  itemId: z.string().uuid().optional(),
  kind: z.string().trim().max(20).optional(),
  search: z.string().trim().max(120).optional(),
  format: reportFormatSchema.default('json'),
  limit: z.coerce.number().int().min(1).max(REPORT_EXPORT_CAP).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportScopeSchema = z.object({
  kind: z.enum(['global', 'finance', 'team', 'self', 'redemption']),
  viewerRole: z.string(),
  label: z.string(),
});
export type ReportScope = z.infer<typeof reportScopeSchema>;

export const reportRowSchema = z.record(z.string(), z.unknown());
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportResponseSchema = z.object({
  report: reportTypeSchema,
  generatedAt: z.string(),
  scope: reportScopeSchema,
  window: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  filters: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
  data: z.array(reportRowSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  }),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;

export const reportExportSchema = z.object({
  report: z.union([reportTypeSchema, z.literal('audit')]),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  filename: z.string(),
  mime: z.string(),
  encoding: z.literal('base64'),
  content: z.string(),
  rowCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  truncated: z.literal(false),
  generatedAt: z.string(),
});
export type ReportExport = z.infer<typeof reportExportSchema>;

/* ------------------------------------------------------------------ */
/* Audit Center                                                        */
/* ------------------------------------------------------------------ */

export const auditQuerySchema = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(100).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  format: reportFormatSchema.default('json'),
  limit: z.coerce.number().int().min(1).max(REPORT_EXPORT_CAP).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditEventSchema = z.object({
  id: z.union([z.string(), z.number()]),
  createdAt: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditResponseSchema = z.object({
  report: z.literal('audit'),
  generatedAt: z.string(),
  scope: reportScopeSchema,
  window: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  filters: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
  data: z.array(auditEventSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  }),
});
export type AuditResponse = z.infer<typeof auditResponseSchema>;
