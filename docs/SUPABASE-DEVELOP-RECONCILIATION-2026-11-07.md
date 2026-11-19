# Supabase develop reconciliation — approval candidate

Status: the user approved exactly the two listed migrations; both APPLIED and
verified on 7 November 2026 at 10:01 SGT. No push or deployment was included.

Target: existing AF Homes project `ikaevepedpqygdlipsei` (production).
Checkout: `claud/supabase`; develop source `e759f6904b4fef31ddb6be07f68a903c07c9ee49`.

## Read-only findings

The configured project, database connection and public Supabase URL agree.
The connected Supabase plugin belongs to a different inactive project and was
not used for this inspection. The existing local connection used certificate
verification and a transaction with `transaction_read_only=on`.

Live history contains 127 versions. Twenty-two earlier branch files lack history
entries, but that does not mean their objects are missing: 24 of 26 compared
function definitions and privileges match a fresh database with every branch
migration. Replaying the old gap files could replace newer definitions or run
historical backfills. This proposal does neither and does not stamp those gaps.

Confirmed differences:

- The original purchase-terms CHECK still requires a review reason, alongside
  the newer nullable length CHECK. The application permits an omitted reason.
- Live application mirroring can overwrite the government ID type from form
  input. The branch leaves that type to the verified document workflow.
- `public.purge_customer(uuid)` has browser execution grants live. Its body
  matches the branch, but the branch restricts execution to the server role.

The lookup filters and public verification function definitions already match
the branch. Verification is enabled with privacy approval and cleanup readiness.
Customer-ID, OST-ID, receipt, service-image and profile-photo buckets are private.
VIP card-number columns are present; removed reservation signature/remark fields
are already absent.

## Exact proposed scope

Only these two migrations, in this order:

| File | SHA-256 |
| --- | --- |
| `20261226000001_afhomes_supabase_review_reason_reconciliation.sql` | `f3008b673c71ca6e30d52ff93ec6ed553369915d10f86c6d6e67fdbc27131c71` |
| `20261227000001_afhomes_develop_catalog_reconciliation.sql` | `fa831d5c27b4e8ac518036c176e3f95e6cd88cba90b117e6593a0b8c2ece1067` |

The first removes only the obsolete mandatory-reason constraint. Supplied
reasons retain the existing 5–500 character validation. The second installs the
branch's application-mirror definition and revokes browser access to the purge
RPC, retaining service-role execution. It performs no customer backfill or purge.

No seed, administrator/account modification, customer import, historic financial
change, unrelated migration, migration-history repair, push or deployment is
included. Existing migration files are unchanged by this reconciliation.

## Verification and release gates

`pnpm test:db:reconciliation` passed on disposable PostgreSQL: it reproduces
both catalog differences, proves browser purge denial against an existing
synthetic customer, preserves the ID type, repairs the reason constraint,
replays both migrations twice without changing business row counts, and checks
the RLS invariants.

The current dated-stay/external-import suite passed, including approval,
separate allowances, concurrency, settlement, refund and retry behavior. The
ordinary local DB command now requires this current suite after the core suite;
retired dateless success scenarios are distinguished from the active workflow.

Read-only HTTP checks against the local application and configured Supabase:

- API health: 200.
- Public verification configuration: 200, available.
- Customer lookup without a staff session: 401.
- Public search and customer-lookup HTML routes: 200.

The core PostgreSQL suite passed 2,404 checks, followed by the mandatory current
dated-stay/import suite. The Supabase API suite passed 2,824 tests across 153 files.
Workspace typecheck, both app builds, lint (no errors), and environment isolation
passed. The complete admin suite passed 1,073 tests across 117 files.
Browser interaction remains unverified while its access
host is unavailable. HTTP responses and unit tests are not browser acceptance.

Before any approved apply, recheck project identity, exact file hashes, live
function/ACL fingerprints and both versions' history. Stop on unexpected drift.
Use certificate-verified TLS; never print the connection string or keys.
After apply, verify both recorded versions, the single nullable reason CHECK,
mirror definition, purge execution grants, private buckets, unchanged business
row counts and the existing RLS audit baseline. Report local and live proof
separately. Durable evidence must contain no credentials or customer values.

## Applied result

The guarded repository runner applied only the two approved files over
certificate-verified TLS. History increased from 127 to 129 with no other new
version. Read-only post-verification confirmed one nullable reason CHECK,
browser purge execution denied and service execution retained, the approved
mirror body installed, unchanged business row counts, unchanged private buckets
and verification settings, and the same RLS baseline (only the two pre-existing
platform cron policies; no application invariant violations).

An initial byte-level function-definition check flagged carriage-return
formatting. Independent checks confirmed that the live body exactly matches the
approved file and the complete definition matches the branch after line-ending
normalization. No migration was edited or reapplied to resolve that check.

Sanitized local evidence: `.tmp-bin/reconciliation-live-before.json`,
`.tmp-bin/reconciliation-live-after.json`, and
`.tmp-bin/reconciliation-mirror-postcheck.json`. These remain ignored.
