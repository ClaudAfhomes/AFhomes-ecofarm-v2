import { z } from 'zod';

/**
 * API error envelope. Shape is authoritative: every handler failure returns
 * `{ error: { code, message, details?, requestId?, timestamp } }`.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
    timestamp: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * The stable set of error codes the AF Homes API emits. Domain-specific codes
 * (commission, voucher, payout, qualification) are added here when their Phase
 * 2+ handlers land, so a client can narrow on `code` without string matching.
 */
export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
