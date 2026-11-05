---
paths:
  - "api/_lib/auth*.ts"
  - "api/_lib/afhomes-access*.ts"
  - "api/_lib/customer-access*.ts"
  - "api/_lib/identifier.ts"
  - "api/_handlers/auth*.ts"
  - "api/_handlers/admin/**"
  - "packages/contracts/src/schemas/role-baseline*.ts"
  - "apps/admin/src/app/navigation.ts"
---

# Security rules

- Staff permission = role permissions MINUS deny-only restrictions; super_admin by slug.
  Resolved per request, no cache. Invariants A–H in AGENTS.md each have regression tests — keep them green.
- Customer access is ownership only; no module row, no staff capability via the portal.
- Native auth: password-only (MFA removed by owner), mandatory temporary-password change for staff,
  single-use expiring activation for VIP customers. Turnstile enforced on login portals.
- Identifiers (QR, fallback code, AA numbers) never authorize anything.
- Never weaken a check to make a test pass. Never log credentials, tokens, government IDs.
- Legacy bcrypt bridge `AFHOMES_ENABLE_LEGACY_PASSWORDS` is default-off; do not enable.
