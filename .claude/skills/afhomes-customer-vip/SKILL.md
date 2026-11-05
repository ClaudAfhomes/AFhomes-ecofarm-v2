---
name: afhomes-customer-vip
description: AF Homes customers and VIP membership — customer numbers, VIP control numbers, Bronze/Silver/Gold tiers, activation, card credentials and Stay Points (weekday/weekend). Use for customer records, lookup, VIP issuance, membership or points work.
---

# Customers, VIP and Stay Points

## Sources
- `docs/AFHOMES-BUSINESS-RULES.md` §3.2 (customer ID), §4 (VIP control number), §13 (open decisions)
- `docs/mongodb/VIP-ISSUANCE-SETUP-2026-11-02.md`, `DAY-POINT-ALLOWANCES-REPORT.md`,
  `IDENTITY-PURCHASE-ACCEPTANCE.md`, `GSD-CUSTOMER-LOOKUP-REPORT.md`, `MEMBER-PROFILE-REPORT.md`
- Code: `api/_lib/customers.mongo.ts`, `vip-issuance.mongo.ts`, `vip-schemes.spec.ts` (schemes via contracts + `commerce.ts`), `customer-points.mongo.ts`,
  `customer-activation.mongo.ts`, `customer-directory.mongo.ts`; portal `apps/web/src/features/customer/`

## Verified facts (2026-11-04)
- VIP tier codes **approved (D14, owner 2026-11-04; Rules §4):** `B1` = Bronze, `S1` = Silver,
  `G1` = Gold. No other source tier code (B2, S2, P1, R1, reserved G2/P2/R2) is an approved V2 product.
- VIP control number (format unchanged): `YYMMDD NNNNN VT P MM S` (17 chars), validated in code by
  `/^\d{11}[BGS]1[CT]\d{2}[SN]$/` — tier per D14, C=cash (forces `01`), T=terms, S/N contract.
  Server-issued, unique-indexed, nondecreasing counter; never editable or regenerated on status change.
  Other numbering decisions (OD-01, OD-03, OD-05, OD-06, OD-12) remain open (U6).
- **Customer ID format is final (D12, owner 2026-11-04):** `AF-CUS-YYYY-NNNNNN`.
  The existing MongoDB generator reportedly uses a different format: native POST in `customers.mongo.ts`
  issues random `AF-CUS-XXXXX` (comment: "preserve readable random AF IDs"); the parser accepts both.
  Correcting the generator requires a separate implementation audit and explicit authorization (U1).
  Existing identifiers must be preserved and handled through an approved compatibility strategy.
  Before implementation, review sequence allocation, collision handling, import behavior and migration policy.
- Distinct customer code `AF-CC-XXXXXXXX`. Customer/sale/payment/membership/accreditation IDs stay separate.
- Activation requires full verified payment; customers set their own password via single-use expiring link.
- QR/fallback credentials are hashed; rotated, never recovered or re-displayed.
- Points: safe integers; weekday/weekend ledger deltas with shared whole-point 70/30 rounding.
  Card purchase payments are not ordinary spend. Imported balances preserved.
- Redemption and Services are disabled (`FEATURE_FLAGS`); points data does not enable them.
- Government ID numbers are write-only; API exposes masked values.

## Unverified — read source before use
Tier caps/annual thresholds, cycle start rules, prices. Never invent them.

## Never
Hand-edit VIP numbers, points balances or snapshots; recompute history from current catalog.
