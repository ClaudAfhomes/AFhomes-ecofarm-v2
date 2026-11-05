# Auth session index installation proposal - 4 November 2026

Status: **installed in Atlas `afhomes_dev` on 4 November 2026 (Phase 8)** - see the addendum in
`ATLAS-INDEX-APPLY-2026-11-04.md`. No credential, session or other data change was made.

## What and why

| Collection | Name | Key | Options | Serves |
| --- | --- | --- | --- | --- |
| `auth_sessions` | `unique_auth_session_token` | `{ token: 1 }` | `unique: true` | Better Auth session read on every authenticated request (`aggregate {token}`) and sign-out (`delete {token}`) |
| `auth_sessions` | `read_auth_session_user` | `{ userId: 1 }` | - | App session revocation by user (`mongo-runtime.ts`, `member-profile-update.mongo.ts`, `customers.mongo.ts`, `organization.mongo.ts`) |

Today only `_id` is indexed (repository setup code and Atlas `afhomes_dev`), so the token lookup
scans every session. Better Auth issues one random token per session (`modelName: 'auth_sessions'`,
`api/_lib/auth.ts`), so uniqueness matches its own assumption and also rejects a duplicate token.

## Local evidence (disposable replicas only)

- 20,000 sessions: token lookup COLLSCAN of 20,000 documents -> 1 key / 1 document; revoke-by-user
  20,000 keys + 20,000 documents -> 1 / 1; authenticated request average 35.2 ms -> 17.3 ms.
- Sign-in, authenticated requests, sign-out and post-sign-out rejection behave identically with the
  indexes; a duplicate token insert fails with duplicate-key error 11000.
- Index plan spec (`performance-indexes.mongo.spec.ts`): the unique index is created unique, a
  duplicate is rejected, and an existing non-unique `{ token: 1 }` index is reported as
  `index-option-conflict` and refused (never silently kept or replaced).
- Read-only Atlas check (counts only, 4 Nov): `afhomes_dev.auth_sessions` 7 sessions, 7 distinct
  string tokens, 0 duplicates, string `userId`s - a unique build would succeed.

## Guarded installation procedure (requires explicit approval)

1. Read-only plan: `api/scripts/prepare-mongodb-performance.ts --plan` against `afhomes_dev`;
   confirm only `auth_sessions/unique_auth_session_token` and `auth_sessions/read_auth_session_user`
   are `missing`, every other entry `present`, and record the digest.
2. Immediately before apply, recount duplicates (read-only aggregate, counts only). Any duplicate or
   non-string token: stop and review.
3. Apply: `--apply --approve-indexes=afhomes_dev --approve-plan=<digest>`. The installer refuses
   other databases, a changed plan, or any conflict.
4. Verify: definitions (`unique: true` on the token index), index count +2, no other index changed,
   explain shows `IXSCAN`/`EXPRESS_IXSCAN` for the token lookup, sign-in/sign-out smoke test.
5. Rollback (separate approval): drop the two indexes by name; no data is changed by either step.

Risk: a unique build fails (no partial state) if duplicate tokens appear before the build; the
build itself is online on MongoDB 8.0 and the collection is tiny.
