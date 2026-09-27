# AF Homes PHASE 7 — Sales genealogy

## Current-state audit

`referral_relationships` is the authoritative, versioned immediate-upline model. Its partial unique index already provides one active upline per subject; inactive rows preserve corrections. `hierarchy_role` is the subject role. `card_sales.referral_relationship_id` freezes the relationship used by a sale, while seller staff/OST IDs and customer referral attribution remain separate historical facts.

`referral_codes`, `ost_applications`, and `ost_members` carry sponsor references for the later OST registration workflow. Phase 7 does not activate that workflow or duplicate those fields. Codes already have a unique hash, owner, expiry, usage limit, active flag, and creator. No raw code is exposed by genealogy.

The canonical seller account state is `staff_users.status` (`invited`, `active`, `inactive`, `suspended`). An OST additionally reports the explicit `ost_members.status` when that later-workflow record exists. Sales recency is not used.

## Collision and migration plan

The existing application accepted any higher role as an upline, while the approved Phase 7 chain requires exact adjacency. The forward-only migration `20261002000001_afhomes_phase7_genealogy.sql` adds database role validation, self/direct/indirect-cycle rejection, scoped RLS, and a hardened correction RPC. A preflight aborts with `PHASE7_EXISTING_HIERARCHY_CONFLICT` if an applied database contains incompatible active edges; it never repairs or rewrites them silently.

The correction RPC retires the old edge and inserts a new edge atomically. It checks `sales.uplines:update` inside SQL, validates the new edge through the same trigger, and records old/new uplines plus the mandatory reason in `audit_events`. Existing sale foreign keys continue to point to retired relationship rows.

## Authorization and API

Super Admin and non-seller staff with an explicit effective `network.genealogy` grant receive global visibility. VD, SSM, and SM receive their own bounded subtree plus their upline chain. OST receives only its own record and upline chain. Permission restrictions are honored before scope. The API exposes `/genealogy`, `/:staffId`, and the `/upline`, `/downline`, and `/summary` suffixes through one literal Vercel import.

Summary data is deliberately basic: direct and descendant counts, active/inactive counts, and role counts. It contains no invented commission, bonus, promotion, performance, or sales-total rules.
