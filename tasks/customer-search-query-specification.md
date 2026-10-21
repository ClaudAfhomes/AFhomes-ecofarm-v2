# AF Homes Ecofarm V2 — GSD Customer Lookup: Active VIP Members Only

**Status:** Implementation specification and agent handoff; not implemented by this file  
**Date:** 2026-10-21  
**Required repository path:** `tasks/customer-search-query-specification.md`  
**Source reviewed:** `ClaudAfhomes/AFhomes-ecofarm-v2`, remote `claud/develop` branch (2026-10-21)  
**Priority:** The rules in this document supersede the existing **GSD Customer Lookup**'s broad customer-discovery behavior. They do **not** redefine other customer searches.

> ## READ THIS FIRST — Unambiguous target
>
> **CHANGE THE EXISTING AUTHENTICATED GSD CUSTOMER LOOKUP, NOT A PUBLIC CUSTOMER SEARCH.**
>
> - **Screen:** `/admin/customer-lookup`
> - **UI source:** `apps/admin/src/features/memberships/CustomerLookupPage.tsx`
> - **API:** `GET /memberships/customer-lookup?search=...` (under the API v1 prefix)
> - **API source:** the `customer-lookup` GET branch of `api/_handlers/memberships.ts`
> - **Permission:** `operations.customer_lookup`, view-only
> - **Target:** Only customers with **active customer status AND currently active, unexpired VIP memberships** can be found, suggested, selected, or displayed.
> - **Visible record:** **first name, masked last name, VIP tier, valid-until date**.
> - **No match:** An inactive, prospect, suspended, cancelled, or expired member must behave exactly like a nonexistent customer in this GSD lookup.
> - **Do not** introduce a new anonymous/public customer-search feature. Do not change the Admin Customers master directory or the Member Transaction/Redemption lookup.

## 1. Business rules (MUST)

### BR-01 — Customer must be active

`customers.status` **MUST equal** `active`. A name matching a customer with status `prospect`, `suspended`, or `cancelled` **MUST NOT appear** in search results or name suggestions, even if their saved membership row is marked active.

### BR-02 — VIP membership must be active *and not expired*

An eligible customer **MUST** have an authoritative membership belonging to that customer with:

- `memberships.status = 'active'`;
- a **non-null, valid** `memberships.expires_at` strictly **later** than the trusted server/database current instant; and
- a current plan/tier resolving to `GOLD`, `SILVER`, or `BRONZE`.

A customer with no membership, an expired membership, a suspended/cancelled membership, or a membership whose expiration is already reached **MUST NOT appear**. An `active` status string alone is not sufficient if the expiry has passed. Apply any additional **existing** authoritative eligibility/activation restrictions without inventing a new activation mechanism. Investigate historical/imported members before imposing a new `activated_at IS NOT NULL` requirement that could wrongly exclude genuinely active historical memberships.

### BR-03 — Historical/import labels do not establish active membership

A workbook's `Active VIP` label, `Fully Paid`, a saved VIP-package claim, an approved reservation, an active sale, a payment record, or an existing customer login **MUST NOT** qualify a record by itself. Actual persisted customer and membership lifecycle data is authoritative. This lookup must not create, activate, renew, suspend, or otherwise mutate anything.

### BR-04 — Only eligible records are searchable

The active-customer + active-membership + future-expiry predicates **MUST be enforced on the server/database before sorting, LIMIT/OFFSET, totals, or autocomplete suggestions**. Filtering an unprotected, broad API response in React is **NOT acceptable**. Do not count or disclose inactive matches. A fully written name of a noneligible customer MUST return the same no-match response as an unknown name.

### BR-05 — Output is minimal and masked

Once a match passes eligibility, the **GSD lookup response and UI** MUST display only:

| Display label | New strict field | Rule | Example (synthetic) |
| --- | --- | --- | --- |
| First Name | `firstName` | Customer's given/first name | `Juan` |
| Last Name | `maskedLastName` | First Unicode letter/grapheme of surname + fixed `***`; do **not** preserve original length | `D***` |
| VIP Tier | `vipTier` | Authoritative tier of qualifying membership | `GOLD` |
| Valid Until | `validUntil` | Date derived from authoritative `memberships.expires_at`, formatted in `Asia/Manila` | `2033-10-21` |

Example GSD card: **Juan D*** — Gold VIP — Valid until October 21, 2033**.

**“Hashed last name” means a visual surname mask**, e.g. `D***`, not a cryptographic hash. A hash would not produce the requested readable display and could expose guessable surnames. For `De la Cruz`, show `D***`, not `De ***`, `D* la C***`, `De la Cruz`, or a hash digest. Internal storage must preserve the actual full name; mask only the GSD response/projection and presentation. Names with Unicode characters, punctuation, spaces, and compound surnames must be handled safely.

Never include the raw full surname/full name, middle name, customer UUID/ID, Customer Number, Customer Code, Membership Code/Number, email, phone, birthday, address, government ID/TIN, payment, points, seller details, or credential/QR data **in the GSD search API response**, even if hidden by CSS. No raw names in suggestion labels, `aria-label`, tooltips, HTML attributes, logs or client telemetry. Authorized customer-master and other independent internal contracts remain unaffected.

If a required name/tier/expiry value is invalid or unavailable, fail closed for this search: do not render an unmasked placeholder or guess the expiry.

### BR-06 — Generic no-match message

When an entered name belongs to an ineligible customer or does not exist, show **the same message**, for example:

> **No active VIP customer found.** Check the name and try again.

Do not reveal *why* a particular person is absent: no `inactive`, `expired`, `suspended`, `cancelled`, `no membership`, or `customer exists` hints. The GSD search result response is an empty list in every such case. Preserve distinct, generic network and authorization errors so outages are not misrepresented as empty results.

## 2. Reconcile with existing code — exact implementation scope

| Path / component | Verified current behavior on reviewed branch | Required change or preservation |
| --- | --- | --- |
| `apps/admin/src/features/memberships/CustomerLookupPage.tsx` | Current GSD search uses live, debounced suggestions; selection displays a card with **full name**, Customer ID/Code, customer/membership statuses, VIP tier and validity. | **Change this GSD page** to show active-eligible suggestions only. Both suggestion rows and selected card must render only the four permitted display fields. Replace broad “find any customer”/“customer does not exist” explanatory wording with active VIP lookup wording. Preserve existing keyboard-accessible suggestion/select behavior. |
| `api/_handlers/memberships.ts` → `GET customer-lookup` | GSD permission is `operations.customer_lookup`. It deliberately calls `customerDirectory(..., { membersOnly: false, limit: 50 })` so nonactive records currently appear. | **Change this endpoint** to enforce **all** active-only predicates server-side. It MUST NOT return broad `customerLookupFromDirectory` data. Maintain the current read-only method, authorization, validation and routing. |
| `api/_lib/customer-directory.ts` | Shared wrapper for `customer_directory` RPC; other routes rely on it. | Inspect the actual RPC and schema before editing. If it cannot safely enforce the strict GSD rule **before paging**, introduce an isolated GSD-specific predicate/query/RPC instead of globally changing the shared directory semantics. |
| `api/_lib/member-lookup.ts` | `customerLookupFromDirectory` currently includes full name, identifiers, customer status, category and membership metadata. | Define or use an **isolated strict GSD projection** with the four approved fields. Avoid changes to shared DTOs that would break another consumer. Do not let unused sensitive fields leak into JSON. |
| `packages/contracts/src/schemas/…` | `customerLookupSchema` currently describes broad GSD records. | Add or narrow the correct GSD-only response schema and update only its known consumers/tests. Server should enforce a strict allowlist with four fields. |
| `/admin/customers`; `GET /customers` | Admin/customer-master list, including prospect and suspended/cancelled records when authorized. | **DO NOT change** this staff operational directory, its filters, permissions, editing, or customer creation. Admin/Finance must be able to manage existing nonactive records in their authorized workflows. |
| `/admin/member-lookup`; `GET /memberships/lookup` | Authenticated member transaction lookup for staff operations/redemption; exposes Membership Code where authorized. | **DO NOT change** the member-transaction workflow, its identifier resolution, available points, or authorization. Do not let GSD privacy limits unintentionally break redemption. |
| `/customer/**` | Customer's own authenticated portal. | **DO NOT change.** |
| `/sale-team-search` | Public IST/OST AA-number accreditation verification. | **DO NOT change.** This request has nothing to do with seller lookup or a public customer lookup. |

**Critical warning:** Changing GSD's `membersOnly: false` to `membersOnly: true` **alone is insufficient** unless the existing SQL is proven to require active customer status, active membership status, and unexpired validity **before** it pages. `membersOnly` and a directory category such as `ACTIVE_VIP` must not be guessed to mean the full new rule. Inspect and test their actual definitions.

## 3. GSD lookup user journey (retain and narrow existing UX)

1. An authorized GSD/Employee opens `/admin/customer-lookup` with `operations.customer_lookup` view permission. Nobody without that permission may call or view the lookup.
2. Search field is initially empty; **no customer records are shown by default**.
3. User types a name. Preserve the current GSD minimum of **2 characters** and server maximum of **120 characters** unless the repository's canonical validation requires stricter bounds. Keep the current debounced, suggestion-first search (no new Search button necessary).
4. Search the real customer first/middle/last-name fields internally using normalised, case-insensitive, parameterized matching. Preserve existing optional Customer ID/Customer Code matching if present, but **never display those identifiers**. Do not introduce Membership Code matching into general GSD lookup.
5. Server returns **eligible active VIP rows only**, projected and masked. The dropdown shows up to the current **6 suggestions**, never names of ineligible customers.
6. A suggestion is selected via mouse or keyboard. The details card displays **First Name · Masked Last Name · VIP Tier · Valid Until**. No extra customer, membership, financial, or private fields.
7. Typing again clears the selected card. Only results from the currently settled search may appear; superseded network responses must not restore stale/ineligible data.
8. Revalidate eligibility when selecting/showing a record, or use another mechanism that prevents cached or placeholder data from displaying a membership that has since become suspended/expired. Avoid showing previous-query rows while a new term is loading.
9. If no eligible rows match, the suggestion list and result area must communicate **No active VIP customer found**, without confirming the existence of a noneligible person.
10. Auth failures, service errors, or rate limiting show their appropriate safe UI state; do not fabricate success or display raw SQL/runtime errors.

**Matching vs. disclosure:** The server may use full customer names to search; the browser **must receive and render only masked results**. Staff permissions to use the search do not automatically authorize display of all data from the customer master.

## 4. Technical eligibility / projection contract

Conceptual eligibility (adapt to the actual canonical migration/schema and current lifecycle constraints; not executable migration SQL):

```sql
-- Applied within a dedicated, authorized GSD customer-lookup query:
WHERE c.status = 'active'
  AND m.customer_id = c.id
  AND m.status = 'active'
  AND m.expires_at IS NOT NULL
  AND m.expires_at > now()
  AND cp.code IN ('BRONZE', 'SILVER', 'GOLD')
  -- AND safe server-parameterized, normalized search predicate
-- Perform filtering before LIMIT / OFFSET / totals.
```

- The qualified membership and plan must be joined against actual canonical tables. Avoid accidental duplicates or a join to an outdated product tier.
- Perform expiration comparisons using trusted database/server time, not the browser's clock, and treat `expires_at <= now()` as ineligible. If an expired membership's DB status remains `active`, it is **still excluded**.
- Render the date for Philippine users in `Asia/Manila`; do not calculate VIP validity using current product defaults. Historical contracts may have frozen, legitimate expiration dates.
- Trim and normalize search input, use parameterized SQL, escape wildcard control characters as necessary. Limit query size, number of rows, CPU load and returned fields.
- Return one logical result per qualifying customer/membership. Duplicated same-name customers may both appear if individually eligible, but no internal IDs should be returned simply for rendering keys.
- Respect existing Supabase grants, server-side staff principal resolution, and permission enforcement. **Do not make the endpoint anonymous and do not grant `anon` SELECT on private tables.**
- Make status changes/revocations promptly visible in subsequent lookup queries. Disable inappropriate caching (`Cache-Control: no-store` is appropriate for GSD search), reconcile React Query freshness with this requirement, and avoid storing search identity results in durable client storage.

**Recommended strict GSD response DTO** (illustrative; use canonical Zod conventions):

```ts
type GsdActiveVipLookup = {
  firstName: string;
  maskedLastName: string;
  vipTier: 'BRONZE' | 'SILVER' | 'GOLD';
  validUntil: string; // ISO YYYY-MM-DD display date in Asia/Manila
};

type GsdActiveVipLookupResponse = {
  data: GsdActiveVipLookup[];
};
```

Synthetic example:

```json
{
  "data": [{
    "firstName": "Juan",
    "maskedLastName": "D***",
    "vipTier": "GOLD",
    "validUntil": "2033-10-21"
  }]
}
```

Ineligible or nonexistent input:

```json
{"data": []}
```

If the app's shared `requestList` helper requires the existing `{data, meta}` envelope, **preserve the standard envelope without sensitive metadata** and apply the strict four-field allowlist to each item. A `meta.total` field, if retained, must count **eligible only** matches, never total matching customer identities. Document any envelope adjustment in the endpoint/schema tests.

## 5. GSD acceptance tests (agents MUST add or update)

| Test case | Expected GSD search/suggestion/card result |
| --- | --- |
| Customer active, Gold membership active with future expiry | Appears; first name, `X***` last name, Gold, exact valid-until date |
| Customer active, Silver membership active with future expiry | Appears; Silver and correct expiry |
| Customer active, Bronze membership active with future expiry | Appears; Bronze and correct expiry |
| Customer prospect with matching name | No suggestions/results |
| Customer suspended with active membership | No suggestions/results |
| Customer cancelled with active membership | No suggestions/results |
| Customer active with no membership | No suggestions/results |
| Customer active with expired membership status | No suggestions/results |
| Customer active with suspended/cancelled membership | No suggestions/results |
| Membership `status = active` but expiry is yesterday | No suggestions/results |
| Membership expiry equals current instant | No suggestions/results |
| Membership has null/invalid expiry | No suggestions/results |
| Historical import says `Active VIP` but no valid membership | No suggestions/results |
| Active customer whose valid membership was suspended after lookup | Card is cleared/not displayed after authoritative revalidation |
| Ineligible known name versus unknown name | Identical no-match behavior and response; no status disclosure |
| Compound surname, Unicode, apostrophe, mixed case | Correct name matching and privacy mask; only first surname grapheme visible |
| Partial/full name and valid Customer Code input | Existing supported input matching retained, but eligible results only and no code displayed |
| Membership Code entered into GSD general search | Does not expand the lookup's existing code-search scope |
| First search request finishes after a newer query | Old results cannot be shown for the newer term |
| Keyboard suggestion navigation and selection | Works with filtered/masked entries; card updates only for eligible selection |
| API response checked byte-for-byte | No full surname, `fullName`, IDs/codes, contacts, financial data or credentials |
| GSD caller lacks permission | Existing access denial; no data returned |
| Admin Customer master list loads prospect/suspended rows | **Still works:** not changed |
| Staff Member Transaction/Redemption lookup runs | **Still works:** not changed |
| Customer portal and sale-team public verification | **Still work:** not changed |
| Pagination/limit with many inactive records first | Eligible matching customers still returned: filtering occurs before LIMIT |

Tests must exercise the **real PostgreSQL** eligibility predicate (disposable/local DB) as well as handler, DTO, and UI behavior. Mock-only tests do not establish server-side exclusion. Check the current project schema/migration count instead of assuming old snapshots remain current.

## 6. Agent instructions / change boundaries

**An AI coding agent assigned to implement this task MUST:**

1. Read this entire specification and `AGENTS.md` before making changes.
2. Inspect the latest **local checkout** first, as local uncommitted or recently copied coworker work may differ from reviewed remote `claud/develop`. Preserve existing work and resolve conflicts deliberately.
3. Read the existing GSD component, `GET /memberships/customer-lookup` handler, `customerDirectory` RPC/function/migrations, member-lookup mapper, Zod contract, and relevant tests. Locate any other consumers before changing a shared export.
4. Produce a minimal, scoped change that implements **this existing authenticated GSD lookup**, not a public page or duplicate backend module.
5. Apply eligibility in the authoritative server/database query *before paging*, and mask/allowlist fields before JSON serialization and UI rendering. Avoid broad RLS or shared directory modifications.
6. Update wording, autocomplete, result card and all affected tests. Preserve keyboard, loading, error, and refetch behavior where not in conflict with privacy/eligibility.
7. Run targeted API/frontend tests and disposable PostgreSQL tests, plus typecheck/lint where practical. Report exactly what ran, passed, failed, or could not be verified.
8. Report changed files, exact eligibility predicate, what fields are emitted, and how existing Admin/Transaction lookups were protected. Clearly distinguish **implemented and tested** from **proposed or unverified**.
9. **Do not push, merge, deploy, execute live migrations, change shared production data, or modify `orly/develop` without separate explicit approval.**

**Non-goals:** Public customer lookup, anonymous API, automatic customer activation/renewal, changes to product tenure, payment/points/redemption logic, staff customer-master behavior, deletion of historical customers, or disclosure of VIP member identifiers.

## 7. Code references verified during specification review

All references are from the remote `claud/develop` checkout read for this task:

- `AGENTS.md` — codebase authority, status lifecycle, authorization and DB rules.
- `packages/contracts/src/schemas/lifecycle.ts` — customer (`prospect`, `active`, `suspended`, `cancelled`) and membership (`active`, `expired`, `suspended`, `cancelled`) statuses.
- `apps/admin/src/features/memberships/CustomerLookupPage.tsx` — current GSD typed suggestions and selected card; currently displays private full name and identifiers.
- `api/_handlers/memberships.ts` — `GET /memberships/customer-lookup` currently has `membersOnly: false`, `limit: 50`, `operations.customer_lookup` auth; separate `GET /memberships/lookup` has `membersOnly: true` and member-transaction semantics.
- `api/_lib/customer-directory.ts` — shared RPC wrapper; current exact SQL definitions must be verified against the active local migrations.
- `api/_lib/member-lookup.ts` — staff customer lookup projection currently returns full name and identifiers.
- `apps/admin/src/app/App.tsx` and `apps/admin/src/app/navigation.ts` — GSD route and permission-controlled navigation.
- `apps/admin/src/features/business/BusinessCustomersPage.tsx`, `api/_handlers/customers.ts` — operational customer-master directory; must stay intact.
- `api/_handlers/customer-portal.ts`, `packages/contracts/src/schemas/customer.ts` — separately scoped customer-owned portal.
- `docs/AFHOMES-CUSTOMER-WORKBOOK-IMPLEMENTATION.md` — company imports cannot fabricate activation merely from a stated `Active VIP` label.

**Interpretation rule for agents:** If a code comment or old test says the GSD Customer Lookup must return prospect/suspended/cancelled customers, that reflects the **old behavior** and must be updated for **this GSD endpoint only**. Those customers must remain available on authorized administrative customer-master screens. If the current code differs from the reviewed branch, reconcile against its actual data model and report the differences rather than blindly following stale function names.
