# Points earning and usage (BR-PTS)

Owner instruction of 2026-11-21, recorded as stated. These rules sit alongside the CLAUDE.md guardrail "Points: the annual cap follows the card tier; the balance at activation is 0 — points are earned only by spending on AF Homes services/products" (user-confirmed 2026-11-11). Nothing here sets a specific points value: every value is configured by an administrator.

### BR-PTS-01 — Points are earned by availing an AF Homes service or product

- **Documentation status:** SOURCE_DOCUMENTED (owner instruction)
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** Owner instruction in the Claude Code session, 2026-11-21
- **Source location:** Conversation text
- **Source authority:** Owner
- **Original rule:** "Customer can gain points at availing products or services at AF Homes. For example, a customer avails 1 teppanyaki at 2k per head, and the configured set-up for that transaction is per avail: the customer gains 200 points. These are not fixed; admins can still set them up. He gets the points by scanning the QR presented by the GSD."
- **Rule explanation:** Every service or product has an earning rule that an admin sets. When a VIP avails it, the GSD records the sale and shows a claim QR. The customer scans it and the points are added once.
- **Formula or calculation:** points earned = configured points per avail × quantity. The 200 points in the example is illustrative only, not a configured value.
- **Inputs:** Service/product, its active earning rule, quantity, the VIP membership.
- **Outputs:** One earned points-ledger entry per claim.
- **Conditions:** Active VIP membership; an active earning rule for the item; the Services module switched on.
- **Exceptions:** A claim QR can be claimed only once (no duplicate award). The tier's annual cap applies.
- **Effective dates:** NOT DOCUMENTED
- **People and permissions:** Admin configures the rules (`operations.catalog`). GSD records the sale and shows the claim QR (`operations.sales`). The customer claims in the portal.
- **Workflow:** Admin sets up the rule → GSD records the avail → claim QR → customer scans → points are credited.
- **Current code behavior:** Earning rules and claims under `api/_handlers/earning*`; one earned entry per claim (unique index). Not re-verified line by line on 2026-11-21.
- **Gap analysis:** Match in design.
- **Related tests:** Earning handler specs (not individually listed here).
- **Dependencies:** BR-PTS-02; the card-tier annual cap.
- **Open questions:** None from this instruction.
- **History:** 2026-11-21: recorded.

### BR-PTS-02 — Points are used by the GSD scanning the VIP's QR

- **Documentation status:** SOURCE_DOCUMENTED (owner instruction)
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** Owner instruction in the Claude Code session, 2026-11-21
- **Source location:** Conversation text
- **Source authority:** Owner
- **Original rule:** "The GSD can scan the QR of the customer (VIP), then select whatever services are available that the customer can use points for, or deduct from the total bill value of that service. Avoid duplicate transactions."
- **Rule explanation:** The GSD scans the VIP card. They then either redeem a catalog item for points, or apply points as a discount on a bill. Scanning alone never spends points. Each transaction is de-duplicated.
- **Formula or calculation:** Catalog redemption: the configured points cost × quantity. Bill discount: the configured peso value per point (set by an admin). Neither value is fixed in this rule.
- **Inputs:** VIP QR or fallback code, the catalog item or bill amount, a de-duplication reference.
- **Outputs:** One redemption or discount record and one points-ledger debit.
- **Conditions:** Active customer and membership; enough balance; the Redemption module switched on.
- **Exceptions:** A repeated submission with the same reference returns the original result and does not spend again.
- **Effective dates:** NOT DOCUMENTED
- **People and permissions:** GSD (`operations.redemption`); catalog and rate configuration (`operations.catalog`).
- **Workflow:** Scan (read only) → choose an item or enter the bill → confirm → receipt.
- **Current code behavior:** `GET /redemptions/resolve` (read), `POST /redemptions` inside `public.redeem_membership_points` (idempotent per `(redeemed_by, idempotency_key)`), and redemption rules for bill discounts. See the AGENTS.md "Redemption" section.
- **Gap analysis:** Match in design.
- **Related tests:** `api/_handlers/redemptions.spec.ts`, `api/_handlers/redemption-pos.spec.ts`.
- **Dependencies:** BR-PTS-01.
- **Open questions:** None from this instruction.
- **History:** 2026-11-21: recorded.

### BR-PTS-03 — The audit log groups actors by category and department

- **Documentation status:** SOURCE_DOCUMENTED (owner instruction)
- **Implementation status:** IMPLEMENTED_UNVERIFIED
- **Source document:** Owner instruction in the Claude Code session, 2026-11-21
- **Source location:** Conversation text
- **Source authority:** Owner
- **Original rule:** "At the audit log reports there must be a category like GSD, OST, IST etc., also per department. At the audit log you can see every detail and transaction or change."
- **Rule explanation:** The audit log can be filtered by the actor's role (GSD, OST, Finance, and so on), by the IST group (SM / SSM / VD), and by department. Each entry shows what changed, before and after. Sensitive values stay hidden.
- **Formula or calculation:** None.
- **Inputs:** The actor's current role assignment and the role's department.
- **Outputs:** A filtered audit list; per-entry before → after values.
- **Conditions:** `governance.audit` permission. The audit log is never hidden by a module switch (owner decision 2026-11-21).
- **Exceptions:** A filter uses the actor's current role, not the role they held when the event happened.
- **Effective dates:** NOT DOCUMENTED
- **People and permissions:** Holders of `governance.audit`.
- **Workflow:** Not applicable.
- **Current code behavior:** `serveAudit` in `api/_handlers/reports.ts`; `apps/admin/src/features/reports/AuditPage.tsx`.
- **Gap analysis:** Match.
- **Related tests:** `api/_handlers/reports.spec.ts` "filters by role category, the IST group and department"; `apps/admin/src/features/reports/reports-audit.spec.tsx`.
- **Dependencies:** None.
- **Open questions:** Should the category reflect the role held at the time of the event? It currently uses the current role. Today's audit rows store no role snapshot.
- **History:** 2026-11-21: recorded.
