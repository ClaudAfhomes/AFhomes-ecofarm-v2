# Security remediation checkpoint - 4 November 2026

Local fixes and plans only. No Atlas write, credential rotation, deployment or git operation was
performed. No secret value appears in this document.

## P0-1 Exposed credentials

### Assessment

| Item | Finding |
| --- | --- |
| Files | `scripts/check-auth.ts`, `check-mfa-policy.ts`, `check-mfa.ts`, `disable-mfa.ts`, `reset-password.ts`, `setup-atlas-indexes.ts`, `smoke-test-purchase.ts`, `verify-password.ts` (untracked, created 2026-10-26) |
| Secrets embedded | Atlas connection string (**same database user, host and password as `.env.local`**), the application's **`BETTER_AUTH_SECRET`** (identical to `.env.local`), an administrator password literal, and seven temporary-password candidates |
| Behaviour | Several wrote to Atlas `afhomes_dev` (admin password reset, MFA disable, index setup, purchase workflow signed in as the administrator); others printed password hashes and MFA secrets |
| Dependencies | None: no package script, code or document references them; guarded equivalents exist in `api/scripts/` |
| Git history / index | Not present in any commit on any ref, not staged, never tracked |
| Other copies in the repository | `.env.local` (expected, ignored) and five ignored `.tmp-bin/mongodb-bootstrap-*/credentials.json` files (26 Oct bootstrap outputs) containing the temporary-password candidates. No tracked file, log or document contains any of the secrets |
| Session transcript | The seven temporary-password candidates were displayed once in the local Claude Code session transcript during this audit (a redaction gap); treat them as exposed |

### Cleanup performed

- All eight scripts moved unchanged (SHA-256 verified) to
  `C:\Users\SSD-CLAUD\afhomes-quarantine\credential-scripts-2026-11-04\` - outside the repository,
  not under OneDrive, inheritance removed, owner-only access. A README sits next to the folder.
  They were not edited or deleted because the administrator password literal may be the only
  written record of the current credential.
- `.gitignore`: exact-path entries for the eight scripts (no broad patterns).
- Re-scan after the move: secrets remain only in `.env.local` and the ignored `.tmp-bin` bootstrap
  outputs; none in tracked, staged or newly written files.

## Rotation plan (requires separate approval; nothing executed)

Consumers of the exposed database credential: `.env.local` -> `pnpm dev` (API on 3084 and both
apps), and every operator script that loads `.env.local` (`api/scripts/*`: bootstrap, readiness,
validators, performance plan/apply, backup, capture). Not deployed (D13): no Droplet, systemd unit
or CI workflow holds it (`deploy/digitalocean/afhomes.service` contains no secret; no
`.github/workflows`). `.env.mongodb-maintenance.local` did not contain the exposed password; the
owner should confirm which database user it uses.

1. **Prepare.** Stop local `pnpm dev`/API processes. In Atlas -> Database Access, note the exposed
   user's roles; in Network Access confirm the IP allowlist is not `0.0.0.0/0`. Review the Atlas
   activity feed / access history for 26 Oct - today.
2. **Database user (zero-downtime cutover).** Create a new database user with least privilege
   (`readWrite` on `afhomes_dev` only, unless an approved operator task needs more) and a generated
   password. Update `MONGODB_URI` in `.env.local` (owner edits the file; never paste it into chat).
3. **Verify.** Run read-only checks only: `scripts/ping-mongodb.ts`, then
   `api/scripts/prepare-mongodb-performance.ts --plan` (expect every installed entry `present`;
   the digest changes with each plan revision and with Atlas state, so compare statuses), then start
   `pnpm dev` and sign in.
4. **Revoke.** Delete (or disable) the old database user in Atlas; confirm the app still works.
5. **`BETTER_AUTH_SECRET`.** Generate a new value of at least 32 characters locally, set it in
   `.env.local`, restart. Effects: every existing session is signed out (currently 7 development
   sessions); outstanding signed private-file links and upload tokens stop working (they are
   short-lived). No stored data is re-keyed: identifier hashes are unkeyed SHA-256 and private files
   are not encrypted with this secret. Any old `auth_two_factors` rows become undecryptable (MFA is
   disabled on the MongoDB branch).
6. **Administrator password.** The administrator changes their own password through the normal
   signed-in change-password flow. Do not rerun bootstrap or use scripts; the separate Supabase
   administrator is unaffected.
7. **Dispose.** After steps 1-6 are verified: securely delete the quarantine folder and the five
   `.tmp-bin/mongodb-bootstrap-*/credentials.json` files (separate approval).

## P0-2 `GET /genealogy/ost-contacts` (fixed locally)

Before: any caller with `network.genealogy` view received email/phone for arbitrary
`staffIds` (`api/_lib/genealogy.mongo.ts`). After: the server builds the caller's genealogy
projection first and returns contacts only for sellers in that view - exactly the nodes
`GET /genealogy` returns (self, uplines and downline for VD/SSM/SM; self and uplines for OST; every
seller for non-seller roles such as Super Admin). Any other id, unauthorized or unknown, receives
the same `{ phone: null, email: '' }` entry, so existence is not revealed. Authentication and the
module permission are checked before any lookup; malformed input or an unverifiable genealogy
fails closed with no data. Response shape is unchanged (one entry per requested id).

Uplines stay readable because the official-forms referral chain (SVD, SSM, SM, referrer, VIP
recommender) is chosen from that same view; restricting to downline only would remove those
contact options for SM/SSM users and needs an owner decision.

The legacy Supabase handler `api/_handlers/genealogy.ts:19-50` has the same unscoped code; it is
not used by the native MongoDB runtime and was not changed.

Regression tests: `api/_lib/network.mongo.spec.ts` ("returns OST contacts only inside the caller
genealogy view…"): unauthenticated, own downline, own uplines, other team, sibling branch, unknown
ids, mixed requests, OST scope, Super Admin, non-seller ids, 200-id enumeration probe, deny-only
restricted role, malformed request.

## P0-3 Referral visibility (defect confirmed; **fixed locally in Phase 8**)

Phase 8 correction (`api/_lib/referrals.mongo.ts`): sellers now see a current relationship only when
**both** ends are in their genealogy view, and a retired relationship only when they were a party to it
(subject or upline). Non-seller roles (Super Admin, Admin, Finance) are unchanged; a caller without a
resolvable identity gets no rows. Regression test: `network.mongo.spec.ts` ("limits referral
relationships to the caller genealogy (U8)…"), which fails on the previous filter. The original
analysis follows.

`GET /referrals` for VD/SSM/SM/OST (`api/_lib/referrals.mongo.ts:90-109`) computes the caller's
genealogy view (self, up to four uplines, and downline except for OST) but then keeps an edge when
**either** end is in that view (line 108). Every edge whose upline is one of the caller's ancestors
is therefore returned, with both names (`view()`, lines 40-60). Reproduced on a synthetic tree:

| Caller | Edges outside the caller's genealogy view |
| --- | --- |
| SM | sibling SM -> shared SSM; other SSM -> shared VD; retired edge into the shared SSM |
| SSM | other SSM -> shared VD; retired edge into own SSM |
| OST | fellow OSTs -> shared SM; sibling SM -> shared SSM; other SSM -> VD; retired edge |

Proposed correction (needs approval): keep an edge only when **both** `subject_staff_id` and
`upline_staff_id` are in the caller's view; decide separately whether retired edges into the
caller's own downline remain visible as team history. Proposed regression tests (in
`network.mongo.spec.ts`): SM must not see a sibling SM or an uncle SSM; OST must see only its own
chain; SSM must still see its whole downline; Super Admin unchanged; names of excluded edges never
appear in the response body.

## P1 Authentication indexes (disposable test only; not created in Atlas)

Better Auth (`modelName: 'auth_sessions'`, fields `token`, `userId`, `expiresAt`) issues: insert at
sign-in, `aggregate {token}` on every authenticated request, `delete {token}` at sign-out. The app
also deletes by `userId` (`mongo-runtime.ts:236`, `member-profile-update.mongo.ts:226`,
`customers.mongo.ts:182`, `organization.mongo.ts:514`). No index other than `_id` exists, in code
or in Atlas.

| Query (20,000 sessions, disposable) | Without index | With index |
| --- | --- | --- |
| Session by `token` (every request) | COLLSCAN, 20,000 docs | 1 key, 1 doc |
| Delete other sessions by `userId` | 20,000 keys + 20,000 docs | 1 key, 1 doc |
| Authenticated request average | 35.2 ms | 17.3 ms |

Recommended (separate Atlas approval): `auth_sessions { token: 1 }` **unique** and
`auth_sessions { userId: 1 }`. Atlas `afhomes_dev` currently has 7 sessions, 7 distinct string
tokens, no duplicates, so a unique build would succeed. Session sign-in, use, sign-out and
post-sign-out rejection behaved identically with the indexes; a duplicate token is rejected.
These should also be declared in the core index plan so readiness checks can detect them.

## Phase 8 review finding: masked email searchable (U11, fixed locally)

`GET /members?search=` compared the search term with every visible member's email before the list
masking blanked it for members outside the caller's detail scope (for example a sales manager's
uplines). Repeated searches could therefore confirm a masked address. Search now uses the same
blanked email for those rows, in both the paged and the unpaged list; names and other visible fields
remain searchable. Regression test: `members-pagination.mongo.spec.ts` ("does not let search match an
email the caller cannot see"), which fails on the previous filter.

## Phase 9 security notes (5 November; local changes only)

- **No new vulnerability found; none reopened.** U8 and U11 stay fixed: paged and unpaged referral
  lists share one visibility function (`visibleTo`), and page totals count only authorized rows. The
  pagination spec fails if a page bypasses U8 or if a cursor is not bound to its caller.
- **Cursors** are HMAC-SHA256 positions bound to the caller and to the list. They use a separate
  derived key per list (`afhomes-referrals-cursor-v1`, `afhomes-members-cursor-v1`), are compared
  in constant time, and never grant access: authorization is recomputed on every page.
- **Indexed genealogy traversal** changes only how the same rows are read. Scope, projection and
  `ost-contacts` filtering are unchanged; invalid rows anywhere still fail closed (400) through the
  full read.
- **Still open, unchanged, and not resolved by any performance work:** U9 (credential rotation
  pending; scripts quarantined; credentials unchanged as instructed); U10 (`ost-contacts` upline
  policy); the legacy Supabase `api/_handlers/genealogy.ts` `ost-contacts` handler (unscoped, not
  mounted by the MongoDB runtime). Two lower-risk items carry over from Phase 8: referral POST/PATCH
  can confirm that a staff id exists (it needs the write permission), and a custom non-seller role
  granted `network.referrals` sees every relationship (a grant decision). Faster responses are not
  evidence of secure behaviour; production security approval remains separate.
