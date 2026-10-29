# Separate MongoDB administrator bootstrap

26 October 2026, explicitly authorized by the user after confirming that the
original administrator belongs to Supabase. A separate **Super Admin** was
created successfully in `afhomes_dev`. The original Supabase account, password,
assignments and data were not read, copied, reset or changed.

## Scope executed

- An operator-only `mongodb:bootstrap-admin` command, separate from the inherited
  Supabase bootstrap. No public bootstrap or Better Auth admin handler is mounted.
- Target validation using the existing server-only MongoDB connection factory;
  credentials loaded from ignored `.env.local` without displaying values.
- Bootstrap namespace indexes, missing canonical module descriptors, one
  Super Admin role, MFA policy, one Better Auth credential identity, staff row,
  role assignment, bootstrap marker and audit entry. No commercial data seed,
  existing-data migration or full business-schema initialization was performed.
- One generated temporary password in a Git-ignored local JSON file. The script
  restricted the new credential directory to the current Windows user before
  writing it. Neither password nor password hash was printed or added to docs.
- `must_change_password=true` and privileged MFA required. No invitations sent.

Missing module descriptors use the existing `MODULE_CATALOG`. Existing module,
role and policy values are not overwritten; an incompatible or weakened policy
causes refusal. The command does not adopt an orphan identity, reset a password,
repair assignments or create a second initial owner.

## Evidence

- Four disposable-replica-set tests pass: existing-account refusal, transactional
  audit-failure rollback, concurrent/idempotent creation without password reset,
  actual Better Auth login and server-enforced password-change/MFA gates.
- Tests use the configured client `timeoutMS=15000`, rather than a different
  local client configuration. API typechecking passed.
- Atlas command returned PASS after committed marker/identity/role checks and
  verifying the persisted password hash with Better Auth's password verifier.
  This verification did not create a real login session.
- The first attempts rolled back: permission-catalog round trips exceeded the
  client's transaction budget, then a pinned-driver `insertMany`/CSOT interaction
  was reproduced locally. The final code reads the catalog once, uses individual
  writes to avoid that driver path and sets a bounded 60-second operator
  transaction timeout. No account was created by the failed attempts.

The driver interaction matters for the remaining conversion: do not assume an
`insertMany` transaction proven with a timeout-free fixture works with the actual
configured client. The shared test replica helper now accepts an explicit timeout
for such parity checks. No dependency version was changed.

## Operations and limits

From the repository root, preflight is read-only:

```powershell
corepack pnpm mongodb:bootstrap-admin --email owner@example.invalid --name 'Owner Name'
```

`--apply` is an explicit write operation requiring authorization. A completed
matching bootstrap returns `already exists` without changing its credentials.
The account's private local credential file was linked in the completion message;
do not copy its contents into chat, logs or Markdown.

The normal application still routes to Supabase. A separate user-requested Atlas
localhost now runs via **`pnpm dev`** (also `corepack pnpm dev:mongodb:admin`) at
`http://localhost:5184/admin/login` (API on 3084). It uses the existing server-only
auth secret and MongoDB configuration, an isolated MongoDB-mode frontend and an
outer API allowlist for converted reads plus authentication/session/password/MFA.
It runs no
seeds, bootstrap or business-schema setup; commercial writes return 403.
The public frontend is `http://localhost:5183`. The user-requested `.env.local`
update changes only non-secret localhost URLs/auth-provider settings. Existing
credentials are unchanged. The native dashboard was validated with a read-only
query against `afhomes_dev`. Thirteen focused runtime/dashboard/development-gate
tests and API typechecking passed after this startup change.
Existing servers on 3000/5173/5174 are left running. Four real native HTTP tests
pass with the configured 15-second client timeout, including password change.

`dev:mongodb:local` uses a new
synthetic database and cannot authenticate this Atlas account. Native Atlas
runtime configuration, real-browser login/MFA acceptance and full-platform
cutover remain separate work. Creating this account does not complete conversion.
No commit, push, deployment or other database initialization was performed.
