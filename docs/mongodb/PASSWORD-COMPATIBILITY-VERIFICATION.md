# Source password compatibility preparation

29 October 2026. `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.

## Behavior

The default verifier and all new password hashes remain Better Auth native.
`AFHOMES_ENABLE_LEGACY_PASSWORDS=true` explicitly enables a migration verifier
for credentials tagged `afhomes-supabase-bcrypt-v1:` followed by a bcrypt hash.
The flag is server-only, defaults off and rejects values other than `true` or
`false`. It has not been added to a real environment file or enabled against Atlas.

Only reviewed migration tooling may produce that tag. There is no credential
import endpoint, source export or live importer in this change. The generic
business mapping planner still refuses credentials. The existing MongoDB owner
must remain excluded from source credential replacement.

The compatibility verifier accepts bcrypt revisions 2a/2b/2y with costs 4 through
14. Malformed or untagged bcrypt fails closed. Inputs over 72 UTF-8 bytes are
rejected rather than silently truncated. Review the actual source cost and
password-policy compatibility before a migration; unsupported credentials need
a separately reviewed recovery route. Never lower a source hash cost or invent
replacement passwords.

Successful sign-in does not rewrite a hash. A normal password change/reset writes
the existing native hash format. Existing temporary-password flags are preserved;
the staff password-change endpoint uses the same selected verifier for the old
password and its existing transactional compare-and-set update. The existing
client sign-out flow remains intact. No invitations, bootstrap or MFA changes.

## Dependency

`bcryptjs` 3.0.3 is pinned in the API workspace and lockfile. It supplies bcrypt
verification not available in Node's crypto module or the existing native
password verifier. It has no runtime dependencies, includes TypeScript types and
uses the BSD-3-Clause license. No browser import was added. Reviewed upstream
format/async comparison/72-byte behavior:
[versioned upstream README](https://github.com/dcodeIO/bcrypt.js/blob/v3.0.3/README.md).
This dependency review is not a whole-repository vulnerability audit.

## Disposable proof

The three new regressions initially failed before implementation. The focused
rerun passed **30 tests in 3 files** (`migration-password`, `auth`, `mongo-runtime`).
The full API suite with the bridge included also passed: **3,126 tests in 196
files**, one worker, as part of the root serial run.

- Default-off and invalid-flag behavior; native passwords still verify.
- Tagged 2a/2b/2y, wrong passwords, malformed/untagged/excessive-cost hashes and
  exact UTF-8 byte boundary behavior.
- Real HTTP and a fresh loopback replica: source-format sign-in, business-access
  denial until first password change, native replacement hash, client sign-out,
  old-cookie denial, new-password sign-in and separate native owner sign-in.
  The synthetic owner's credential BSON remains byte-for-byte identical.

No real user password/hash, database URI, source data or environment file is used
by these tests. No Atlas account, schema or business record changed. Full-source
identity mapping, rollback/reconciliation, real encrypted backups and browser
acceptance remain open. This is compatibility preparation, not a migration or a
production-readiness claim.
