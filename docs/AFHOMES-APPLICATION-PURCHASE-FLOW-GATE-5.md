# Gate 5 — Security / Concurrency Verification

**Scope:** Tasks G–K of `docs/superpowers/plans/2026-10-07-application-first-purchase-flow.md`
against `supabase/migrations/20261101000001_afhomes_application_purchase_flow.sql`.

**Target:** disposable local PostgreSQL only. No shared Supabase project was contacted.
No commit. No push. No deployment.

**Classification: PASS — GATE 5 SECURITY / CONCURRENCY VERIFIED**

---

## 1. Verification commands and actual output

| Command | Result | Exit |
|---|---|---|
| `pnpm --filter @afhomes/contracts test` | 183 passed (12 files) | 0 |
| `pnpm --filter api test` | 1865 passed (89 files) | 0 |
| `pnpm --filter @afhomes/admin test` | 599 passed (55 files) | 0 |
| `pnpm test:db:local` | **1890/1890** — §61=56, §62=37, §63=40 | 0 |
| `pnpm test:db:harness` | 13/13 (injected-fault run exits non-zero, cleanup still runs) | 0 |
| `supabase/security/rls_invariants.sql` | **zero rows (PASS)** | 0 |
| `pnpm typecheck:deploy` | 7/7 packages | 0 |
| `pnpm typecheck` | 7/7 + `tsc -p supabase` | 0 |
| `pnpm lint` | 0 errors (10 pre-existing warnings) | 0 |
| `pnpm build` | 2/2 | 0 |
| `pnpm check:env` | 474 browser / 173 server files scanned, PASS | 0 |
| `git diff --check` | clean | 0 |
| `git diff --cached --check` | clean (nothing staged) | 0 |

---

## 2. Finalization preconditions (Task G)

`public.finalize_reservation_purchase_once(request, reservation, actor)` refuses unless **all** hold:

| Precondition | Domain refusal | Proven |
|---|---|---|
| Reservation exists | `AGREEMENT_NOT_FOUND` | §61 |
| `origin = 'application'` | `RESERVATION_ORIGIN_INVALID` | §61 |
| `status = 'executed'` | `RESERVATION_NOT_EXECUTED` | §61 |
| Application still `approved` | `APPLICATION_NOT_APPROVED` | §61 (incl. explicit rejected + cancelled) |
| Exact `purchase_terms_id` present | `PURCHASE_TERMS_REVIEW_REQUIRED` | §59, §61 |
| Terms identity matches the agreement | `PURCHASE_TERMS_IDENTITY_INVALID` | §61 |
| Frozen seller active | `SELLER_INACTIVE` (403) | §61 |
| Current sale-time hierarchy complete | `SALE_COMPLETE_HIERARCHY_REQUIRED` | §61 |
| **Zero** recorded (undecided) payments | `RESERVATION_UNDECIDED_PAYMENTS` | §61 |
| Verified total ≥ frozen total | `RESERVATION_NOT_FULLY_PAID` | §61 |
| No unrelated open sale | `SALE_ALREADY_EXISTS` | §61 |
| Actor holds `finance.payment_verification:update` | `MUTATION_FORBIDDEN` | §61 |

**Undecided-payment rule.** Verified money totalling the full price does **not** excuse a recorded but
undecided row. Finalizing over it would let a later rejection silently unbalance a sale already
declared paid in full, so it blocks. Proven by a reservation with verified = frozen total **and** a
later recorded row still pending.

---

## 3. Exactly-one-AF-CSALE and no-copied-payment proofs

- **One sale.** `card_sales` has exactly one `origin='normal'` row per customer; both callers of two
  simultaneous finalizers receive the **same** sale id (§63 race 5, race 11).
- **No copy.** The payment count for the reservation is unchanged before and after; the sorted set of
  payment **UUIDs** after finalization equals the set that was recorded; every payment number is
  unique; `reservation_id` is retained so the money stays traceable to the agreement (§61).
- **No second ledger.** `payments` is the only table either branch writes.
- **Frozen economics.** Every snapshot on the sale equals the immutable terms row, and a live
  `card_plans` price/points edit does not move it (§61).
- **Hierarchy rollback.** With the seller's active referral chain removed, the sale insert's
  hierarchy trigger raises and the whole transaction rolls back: no sale, no link, no payment change,
  no `purchase_finalized` evidence (§61).
- **Fault after payment linking.** An audit trigger raising on `PURCHASE_FINALIZED` — i.e. *after* the
  sale, commission, payment links and pointer updates — restores every pre-transaction count and
  leaves every payment unlinked again (§61).

---

## 4. Activation integration (Task H)

`public.activate_card_sale` is a **forward replacement**. Signature `(uuid, uuid, integer)`, all six
result columns, the membership-number allocator, the credential hashing, the points semantics, the
commission advance and the one-time plaintext behaviour are unchanged. Two additions:

1. `private.mutation_actor_role(p_actor_id,'finance.card_activation','update')` inside the transaction.
   The old body only checked the actor was non-null, so any authenticated caller reaching the function
   could activate. The grant is re-resolved from the live role graph per call; revoking it in the
   database takes effect on the **very next** call (§62).
2. An immutable `membership_activated` evidence row, written inside the same transaction, containing
   the membership business number, tier, points, term, expiry, frozen total, verified total and
   activator — and **no** QR token, fallback code, hash, onboarding token or government ID (§62).

**Replay** returns the existing membership, reports `already_active`, returns **no** new plaintext,
leaves the stored hashes byte-identical, and creates no second membership, points account, evidence
row or commission advancement (§62).

**Legacy.** A sale-origin sale meets the *same* financial recheck — never a bypass. A legacy
activation writes no purchase evidence, because it has no reservation to justify one (§62).

---

## 5. Historical printable records (Task I)

Five kinds: `reservation`, `payment_recorded`, `payment_verified`, `purchase_finalized`,
`membership_activated`.

- `public.purchase_document(kind, source, actor, revision)` is the only way out of the private
  schema and authorizes **fresh** on every call from the live role graph. Possessing a document UUID
  grants nothing.
- Fields are constructed **field-by-field** in SQL; there is no caller-supplied JSON payload.
- `api/_lib/purchase-documents.ts` is a pure function of that evidence. It reads no business table, so
  today's price, seller, commission, balance and plan benefits cannot reach a page.
- A `RECORDED` receipt is labelled `RECORDED - NOT VERIFIED` in its title, its summary line and its own
  field, and never reads `STATUS: VERIFIED`.
- A source with no captured evidence answers `evidenceAvailable:false` with
  `LEGACY_RECORD_WITHOUT_CAPTURED_EVIDENCE` and **no fields at all** — never a substituted figure.
- `FORBIDDEN_FIELD_PATTERN` is asserted against credential, hash, token, government-ID, secret and
  storage-path key names, so a new field cannot slip in unnoticed.

---

## 6. Concurrency (Task K) — 12 races, two independent sessions each

`lock_timeout = 4s`, `statement_timeout = 20s` on both sessions; `Promise.allSettled`; no sleep-only
tests. Every case asserts no `40P01`, exact row counts and exact ids.

| # | Race | Result |
|---|---|---|
| 1 | duplicate reservation creation | exactly 1 AF-RES |
| 2 | duplicate payment creation (same request id) | exactly 1 ledger row |
| 3 | simultaneous payment verification | exactly 1 winner, 1 verified receipt |
| 4 | verification vs reservation cancellation | no deadlock, coherent ledger row |
| 5 | **two simultaneous finalizers** | exactly 1 AF-CSALE, same id to both, 0 memberships |
| 6 | finalization vs late payment recording | ≤ 1 sale, nothing silently dropped |
| 7 | finalization vs payment decision | ≤ 1 sale, only created when money was verified |
| 8 | activation replay | exactly 1 membership, 1 points account, same id to both |
| 9 | old purchase-terms review version race | exactly 1 captured version |
| 10 | legacy payment verification vs activation | no deadlock, ≤ 1 membership |
| 11 | same object, different request ids | exactly 1 AF-CSALE, no duplicated commission |
| 12 | document evidence revision concurrency | one revision captured once |

**No deadlock occurred in any race.**

---

## 7. Security escalation attempts (all refused)

| Attempt | Answer |
|---|---|
| seller without the finance grant finalizing | `MUTATION_FORBIDDEN` |
| inactive actor finalizing / recording / verifying | `MUTATION_FORBIDDEN` |
| actor without `finance.card_activation` activating | `MUTATION_FORBIDDEN` |
| grant revoked in the database | refused on the very next call |
| cross-customer / unrelated reservation source | `AGREEMENT_NOT_FOUND`, `APPLICATION_NOT_FOUND` |
| sale-origin agreement on a purchase route | 404 (not forbidden — ids are not probeable) |
| draft / submitted / rejected / cancelled application finalizing | `RESERVATION_NOT_EXECUTED` / `APPLICATION_NOT_APPROVED`, zero new rows |
| inactive frozen seller | `SELLER_INACTIVE` |
| incomplete current hierarchy | `SALE_COMPLETE_HIERARCHY_REQUIRED`, whole transaction rolled back |
| browser-supplied price / total / commission / seller / saleId / activate flag | 400 before any RPC |
| browser-supplied evidence JSON | impossible — no such parameter exists |
| document read without the permission | `MUTATION_FORBIDDEN` |
| unknown document kind | `PURCHASE_DOCUMENT_KIND_INVALID` |
| legacy source with no evidence | explicit "unavailable", no invented figures |
| RLS/ACL audit | zero rows |

---

## 8. Reporting and double-count

A reservation-origin AF-PAY is counted exactly once in every surface. Before finalization it is read
by `reservation_id`; after linking the **same row** is read by `sale_id` as well, and the payments
report merges both branches and dedupes **by payment id**, so the transition cannot double the money.
`purchase_finalized` evidence requires the paid total and zero recorded rows, so a "paid in full" claim
can never outlive a later rejection (§60, §61, §63).

---

## 9. Legacy compatibility

Sale-origin reservations, payments, verification, reports, activation and imports all remain on their
original paths. `origin` defaults to `'sale'` on every pre-existing row; no legacy row is
reinterpreted as application-origin. The forward replacement of `verify_card_payment` changed the
**lock order only** (sale before payment); every result column, sale-status advance, commission
advance and audit is unchanged.

---

## 10. Known limitations — stated, not claimed

1. **Browser UAT is NOT VERIFIED.** No authenticated browser session was available. The UI is proven
   by component tests with the real client, real schemas and real component, not by a human driving
   the app.
2. **Task J UI scope.** Wired and tested: the Finance queue renders reservation rows with reservation
   number, frozen total, verified money and balance; Print reservation; Finalize gated on the
   server-reported figures and on the finance update grant; reservation-scoped ledger read with no
   sale-scoped call; query invalidation across `business` and `reports`. **Not** built: the
   application-form reservation creation screen beyond the Task C wiring, the reservation detail
   lifecycle panel, the payment-history table with per-payment print buttons, and the activation
   confirmation button. Those are the remainder of Task J and are **not** claimed here.
3. Managed-platform proof (real Supabase Auth, Storage, PostgREST) remains out of scope, as at Gate 3.
4. `git diff --check` emits CRLF warnings on two pre-existing files; no whitespace errors.

---

## 11. Process

- **Commits created:** none.
- **Push performed:** no.
- **Shared database changed:** no.
- **Production deployed:** no.
- **PostgreSQL cleanup:** only this worktree's embedded workers (port 55443) were created and reaped;
  no unrelated `postgres.exe` was signalled.