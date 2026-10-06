import { z } from 'zod';

/**
 * Phase 2B operational dashboard queue cards (AF Homes queue-card pattern).
 *
 * Three lightweight server-side counts for the dashboard top section. Each
 * count is `null` when the caller may not know it (pattern A: the endpoint
 * returns only what the caller's modules authorize), so the client never
 * renders - or infers - an unauthorized queue depth.
 *
 * - `ostMembers`: every `ost_members` row. There is no archived/deleted
 *   member state, so the total registered membership is the whole table
 *   (the legacy non-archived member count). A snapshot/stat, not an action queue.
 * - `ostApplications`: `ost_applications` in `OST_REVIEWABLE_STATUSES`
 *   (submitted/under_review/changes_requested). Terminal states
 *   (approved/rejected/withdrawn) are decided work, never pending work.
 * - `paymentVerification`: `card_sales` in the finance-queue status set
 *   (submitted/payment_pending/payment_in_progress/overdue) - the exact set
 *   `GET /queues/finance` lists, so the card and the queue can never disagree.
 *
 * Withdrawals are deliberately absent: the payout workflow does not exist yet
 * (Phase 4), and a zero/placeholder card would be a fake count with a dead
 * route.
 */
const countSchema = z.number().int().nonnegative();

export const dashboardQueuesSchema = z.object({
  ostMembers: countSchema.nullable(),
  ostApplications: countSchema.nullable(),
  paymentVerification: countSchema.nullable(),
});
export type DashboardQueues = z.infer<typeof dashboardQueuesSchema>;
