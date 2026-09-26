-- Phase 3 (perf) - list-order indexes backed by code-path evidence.
--
-- The admin/member list endpoints order by these columns on every fetch but
-- had no supporting index, forcing a sort of the whole table:
--   Member.createdAt - GET /admin/members orders by createdAt DESC
--                           (api/_handlers/admin/members.ts)
--   Sale.submittedAt - GET /admin/sales orders by submittedAt DESC
--                           (admin/sales.ts); the member's own list filters
--                           by sellerId then orders by submittedAt
--                           (sales.ts), so a composite serves it exactly
--   Commission.createdAt - GET /me/commissions orders by createdAt DESC
--                           (me/commissions.ts)
-- Composite indexes (memberId + createdAt, sellerId + submittedAt) serve the
-- per-member/ per-seller lists exactly; the plain column indexes serve the
-- global admin lists. Idempotent (`if not exists`).
-- Down: drop each index by name.

create index if not exists "Member_createdAt_idx" on "Member"("createdAt");
create index if not exists "Sale_submittedAt_idx" on "Sale"("submittedAt");
create index if not exists "Sale_sellerId_submittedAt_idx" on "Sale"("sellerId", "submittedAt");
create index if not exists "Commission_memberId_createdAt_idx" on "Commission"("memberId", "createdAt");