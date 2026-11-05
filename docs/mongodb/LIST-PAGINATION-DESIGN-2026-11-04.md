# List pagination design (Members, Genealogy, Referrals) - 4 November 2026

Status: **Members implemented (Phase 8, opt-in):** `GET /members?limit=&cursor=` returns
`{ data, meta: { total, limit, nextCursor } }` (default 50, max 200, name/id order, HMAC cursor bound to the
caller and filters; page-row validation only). Requests without `limit`/`cursor` are unchanged.
**Referrals implemented (Phase 9, 5 Nov, opt-in, local only):** `GET /referrals?limit=&cursor=` returns
`{ data, meta: { total, limit, nextCursor } }` (default 50, max 200). Order: displayed `assignedAt`
descending, then `id` ascending (deterministic, including equal timestamps). `total` counts the rows
left after the U8 visibility filter; the same `visibleTo` function serves paged and unpaged requests.
Names are resolved for the page rows only. The HMAC cursor is bound to the caller and to this list
(own key label `afhomes-referrals-cursor-v1`, so a Members cursor is rejected); a tampered, foreign or
malformed cursor or limit gets 400 and no rows. Requests without `limit`/`cursor` are byte-for-byte
the Phase 8 response. Tests: `api/_lib/referrals-pagination.mongo.spec.ts` (5 tests; four planted
bugs - U8 bypass on pages, reversed order, unbound cursor, names for all rows - each fail it).
Contract: `referralListQuerySchema` in `@afhomes/contracts`. No client uses either paged list yet.
Genealogy endpoints: not paginated (see below).

## Current contracts and consumers

| Endpoint | Response | Admin consumer | Notes |
| --- | --- | --- | --- |
| `GET /members` (`position`, `search`) | `{ data, meta: { total } }`, whole visible list | `features/network-members/services.ts` via `requestList` (reads `data` only) | Server validates every member row on every call; sellers see their visibility scope with non-detail rows masked |
| `GET /members/uplines`, `/members/ost-referrers` | whole filtered list | form pickers | Small, active-only lists |
| `GET /genealogy` | all visible nodes | `features/genealogy/services.ts` `getGenealogy()`; official-forms referral chain | The client builds the tree and the SVD/SSM/SM/referrer chain from the full node list |
| `GET /genealogy/:id/downline` | all visible descendants | genealogy detail page | |
| `GET /referrals` | all visible relationships, `assigned_at` desc | `features/business/services.ts` | U8 fixed in Phase 8 (both ends in the caller view; retired rows only for a party) |

`list()` (`api/_lib/handler-kit.ts`) always returns `meta.total = data.length`; `requestList` ignores
`meta`, so additive `meta` fields are backward compatible.

## Recommendation

1. **Opt-in, additive parameters only.** Keep today's response when no paging parameter is sent, so
   every existing consumer is unchanged. When `limit` (and `cursor` or `offset`) is present, return
   `{ data, meta: { total, limit, nextCursor } }`.
2. **Members and Referrals: keyset (cursor) pagination.**
   - Members: order `fullName` (case-folded) then `id`; cursor = opaque, signed (HMAC) pair of the
     last sort values. Referrals: order `assigned_at` desc then `id` asc (adds the missing
     tie-breaker; today's tie order is unspecified).
   - Cursors are deterministic under concurrent inserts and avoid deep `$skip` cost; `offset` may be
     accepted for parity with the customer directory but is capped (e.g. 10,000).
   - Page size: default 50, maximum 200, validated by the contract schema.
   - `total` stays exact and is computed after authorization and filters (`$facet` or a
     separate count on the same scoped filter).
3. **Genealogy: do not page the node list.** The tree and the referral-chain pickers need the whole
   visible graph. Instead add bounded, purpose-built reads later: `GET /genealogy/:id/children`
   (direct downline, paged) and a server-side chain lookup for official forms. Keep `GET /genealogy`
   as is.
4. **Authorization before paging.** Visibility/masking rules run first; paging only slices the
   authorized, filtered, ordered set. A cursor encodes sort values only - never identity or scope -
   and is re-validated against the caller's scope on every request (no cursor reveals rows outside
   it). Requests with a cursor from another filter set are rejected (400).
5. **Large result sets.** With paging, Members can project and validate only the requested page
   plus what scope checks need - but full-list validation semantics (one malformed member fails
   the request) must then be replaced by an explicit, separately approved validation policy.
6. **Rollout.** Contracts in `packages/contracts` first (optional fields), server support behind the
   opt-in parameters, then migrate admin screens one at a time with `requestListEnvelope`.

## Open decisions for the owner

- Whether paged Member lists may stop failing on malformed rows outside the page (same question as
  the approved directory behaviour).
- Default/maximum page sizes per screen.
- ~~Whether Referrals paging waits for the U8 visibility fix~~ - U8 was fixed first (Phase 8);
  Referrals paging followed in Phase 9.
- When (and whether) the admin screens adopt the paged requests; both lists still read every row
  to authorize, total and order, so paging reduces names, response size and browser work, not the
  database read.
