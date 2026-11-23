# Atlas read-index apply (Phase 3) - 4 November 2026

Owner-approved, single-action change: nine additional read indexes created in Atlas database
`afhomes_dev` only, through the guarded installer. This record is not standing authorization
for any further index, validator, schema or data change.

## Target verification (read-only, before apply)

| Check | Result |
| --- | --- |
| Database | `afhomes_dev`, selected by the runtime scope guard (development scope; hosted production not enabled) |
| Cluster | Atlas, MongoDB 8.0.37, 3-member replica set; the credential sees only `afhomes_dev` |
| Non-production | Not deployed (owner, 3 Nov; D13) |
| Live sessions | 6 unexpired development auth sessions (3 accounts, created 3-4 Nov Manila; local acceptance/development). The pre-apply check initially counted the wrong collection (`session` instead of `auth_sessions`); corrected after apply |
| Backup status | **Unverified** - Atlas backup/snapshot state is not readable with this credential. Recovery path for this change is a named `dropIndex`, which itself needs approval |
| Earlier six performance indexes | Already present; installer plan showed exactly the nine below as `missing` |
| Conflicts / duplicates | None (no name conflict, no equivalent key already present, no collection collation) |

## Applied indexes

Command: `api/scripts/prepare-mongodb-performance.ts --apply --approve-indexes=afhomes_dev --approve-plan=<digest>`

- Approved plan fingerprint (before): `df116be66f74b4ec58d2da2be26bb0a5ac4be1630383375b98817c8e59b7d1d8`
- Plan fingerprint after (all 15 entries `present`): `6c5a904f83fba843cb0ff72dd54a81503680c1fa3d6403d6da1097258d7cf134`
- Result: 9 added, 0 deferred, exit 0. Every created index has options `{}` (no unique, TTL,
  sparse, partial or collation) and a key identical to `api/_lib/performance-indexes.mongo.ts`.

| Collection | Name | Key |
| --- | --- | --- |
| memberships | `read_card_fallback_hash` | `{ fallback_code_hash: 1 }` |
| memberships | `read_card_qr_hash` | `{ qr_token_hash: 1 }` |
| customers | `read_customers_created` | `{ created_at: -1, _id: 1 }` |
| customer_applications | `read_applications_created` | `{ created_at: -1 }` |
| reservation_agreements | `read_reservations_created` | `{ created_at: -1 }` |
| reservation_agreements | `read_reservation_application_progress` | `{ origin: 1, status: 1, customer_application_id: 1 }` |
| audit_events | `read_audit_entity_history` | `{ entity_type: 1, entity_id: 1, created_at: -1 }` |
| commissions | `read_commission_staff_beneficiary` | `{ beneficiary_staff_id: 1, created_at: -1 }` |
| commissions | `read_commission_ost_beneficiary` | `{ beneficiary_ost_id: 1, created_at: -1 }` |

## Inventory before / after

| Item | Before | After |
| --- | ---: | ---: |
| Collections | 68 | 68 (identical) |
| Indexes | 172 | 181 |
| Indexes removed or modified | - | none |
| Document counts (all collections) | - | unchanged |

`dbHash` is not permitted for this credential; "no business-document writes" rests on unchanged
counts and on index creation not writing documents.

## Query-plan verification (explain executionStats, dummy filter values)

| Query | Before | After |
| --- | --- | --- |
| Card QR / fallback hash `$or` | `COLLSCAN` | `OR` of `IXSCAN(read_card_fallback_hash)`, `IXSCAN(read_card_qr_hash)` |
| Customers newest page | `SORT <- COLLSCAN` | `LIMIT <- FETCH <- IXSCAN(read_customers_created)` |
| Applications / reservations newest | `SORT <- COLLSCAN` | `IXSCAN(read_*_created)`, no sort stage |
| Reservation application progress | `COLLSCAN` | `PROJECTION_COVERED <- IXSCAN` (0 documents) |
| Audit history by entity | `SORT <- COLLSCAN` (119 docs) | `IXSCAN(read_audit_entity_history)` (0 docs) |
| Commissions by beneficiary | `SORT <- COLLSCAN` | `IXSCAN(read_commission_*_beneficiary)` |

Atlas `afhomes_dev` holds 2-119 documents per affected collection, so no Atlas latency gain is
claimed. Measured gains come from disposable 10,000-customer data (Phase 2).

## Compatibility

Read-only calls of the real directory and dashboard functions against Atlas succeeded; no code uses
index hints. Focused specs 26/26 and API typecheck passed.

## Redundant-index review (no removal)

On a disposable replica, `$type: 'string'` partial indexes were not used for plain equality, so
`memberships.customer_id_1` and `card_sales.customer_id_1` are required. Only
`payments.payments_reservation_status_idx` (partial `origin: 'reservation'`) is covered by
`reservation_id_1_status_1`; it is declared in core setup (`official-forms.mongo.ts`) and removal is
not proposed until usage statistics are available.

## Phase 8 addendum: auth session indexes (applied 4 November 2026)

Owner-approved, single action: two indexes on `afhomes_dev.auth_sessions` through the same guarded
installer. No other Atlas write.

| Check (read-only, before apply) | Result |
| --- | --- |
| Database / scope | `afhomes_dev`, development scope, same cluster fingerprint as the Phase 3 apply |
| Sessions | 7 (6 unexpired), 7 distinct string tokens, 0 duplicate / empty / non-string tokens, string userIds |
| Existing auth_sessions indexes | `_id` only; no name conflict |
| Guarded plan | 15 entries present, only the two approved entries missing; digest `0702d4323eb0…a38` |

- Apply: `--apply --approve-indexes=afhomes_dev --approve-plan=0702d4323eb0a2033ab0bad7be6f7746e1756da87ef822f6c99258c357164a38`
  -> added `auth_sessions/unique_auth_session_token` (`{ token: 1 }`, unique) and
  `auth_sessions/read_auth_session_user` (`{ userId: 1 }`); 0 deferred; plan after: all 17 present
  (digest `80749b3372c3…62f1`).
- After: indexes 181 -> 183, collections 68 unchanged, sessions unchanged (7 / 6 unexpired / 0 duplicates).
- Query plans (read-only explain, dummy values): Better Auth token lookup
  `EXPRESS_IXSCAN(unique_auth_session_token)`; revoke-by-user `IXSCAN(read_auth_session_user)`.
- Live sign-in on Atlas was not exercised (no credentials are used by the agent); sign-in, use,
  sign-out and duplicate-token rejection with these exact indexes were verified on disposable replicas.
- Rollback (separate approval): drop the two indexes by name; no documents were changed.
