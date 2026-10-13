# Checkpoint A: approved security SQL applied and verified

2026-10-13. Target: `ikaevepedpqygdlipsei`. Following the user's instruction to continue safely, all three reviewed migrations were applied in the exact authorized order and individually verified. **Checkpoint A passed; history is now 71 versions.** Optional MFA remains false. The user subsequently authorized committing and pushing this security release to `claud/develop`; Production promotion, unrelated SQL, Auth configuration and business writes remain outside scope.

## Completed execution

The TLS failure was a missing Supabase root CA in the client's trust configuration. Downloaded the public CA over verified HTTPS from `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`; verified its CA identity and SHA-256 fingerprint `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`. The connection now verifies the chain and hostname with `rejectUnauthorized:true`. No system trust store, project SSL enforcement or credentials changed. [Supabase's documented certificate verification procedure](https://supabase.com/docs/guides/platform/ssl-enforcement).

An exact allowlisted executor used a separate transaction per file, a locked history table, full hash/baseline checks, transactional postconditions and history insertion together, then repeated verification after commit. History records contain the exact approved versions, names and full SQL bodies. The broad migration runner and connector-generated versions were not used.

| Exact version | Commit / post-verification | History count |
| --- | --- | --- |
| `20261128000002` | PASS / PASS, 2026-10-13 06:27:44 UTC | 69 |
| `20261129000001` | PASS / PASS, 2026-10-13 06:29:27 UTC | 70 |
| `20261129000002` | PASS / PASS, 2026-10-13 06:30:55 UTC | 71 |

After every migration, compared both row counts and SHA-256 hashes of sorted row contents for **71 existing protected tables**, including public/private business tables, audit history, Auth users/MFA factors and Storage buckets/objects. All matched before and after; the newly authorized policy singleton is excluded from that preservation comparison. No genuine data was exported into evidence.

Final results:

- The three self-service RPCs have the approved search path, unchanged approved bodies and authenticated-only grants.
- Document and Storage SELECT policies call the scoped ownership helpers; all helper definitions match the approved SQL. Raw `extracted_data`, `reviewed_data`, and `sha256` grants are false. Actual authenticated SELECT probes independently fail with **42501** for all three columns, using separate savepoints.
- `private.staff_security_policy` contains exactly one `singleton=true`, `admin_mfa_required=false` row. Browser and service roles have no direct table access; getter returns false and is executable only by authenticated/service roles, plus its owner.
- Internal permission/business guards retain their intended ACLs, approved bodies and search paths. Authenticated Super Admin AAL1 business access passes under optional MFA; its self-session resolves correctly. Existing accounts/factors were not altered.
- All six RLS-invariant queries return zero violations after each step and at final verification. There are 193 public/private functions; unaffected baseline definitions and inspected EXECUTE privileges remain unchanged. Final history contains the original 68 versions plus exactly the approved three.
- Auth account count remains one; the Super Admin is active and password-ready; VIP plans remain BRONZE, GOLD and SILVER. Production health remains HTTP 200, `ok:true`, `db:ok`, using the previously verified deployed SHA.

[Final live verification](evidence/checkpoint-final-verification.json), [per-version evidence](evidence/checkpoint-applied-20261128000002.json), [document migration evidence](evidence/checkpoint-applied-20261129000001.json), [staff migration evidence](evidence/checkpoint-applied-20261129000002.json).

Local release candidate based on the unchanged remote `claud/develop` SHA `362bde5cccffd90fab5d6c87467db9ba25f8993f`: **3,598 uncached unit/API tests**, **2,464 disposable PostgreSQL checks**, document ownership/cross-owner/raw-field probes and ten staff security scenarios all pass. All 73 candidate migrations execute locally; this does not mean unrelated migrations were applied to the shared project. Typecheck, lint, build, environment isolation and diagnostic self-check pass. Lint retains 22 existing warnings; build retains the existing chunk-size warning. Typecheck/lint/build reused valid Turbo caches; root Supabase typecheck executed. An initial test command incorrectly passed `--force` to Vitest; corrected it to the Turbo command and the complete uncached run passed without changing coverage or timeouts.

Managed browser login, recovery/email, customer/OST sessions, actual signed Storage downloads and forced-password behavior using new managed fixtures remain unexecuted. Local fixtures provide those SQL denial proofs without shared-project mutations. F-05 remains entitlement-blocked. The exposed Vercel bypass token still requires owner rotation; it is excluded from every committed artifact.

## Earlier stopped attempts (superseded by the verified execution above)

## Verified preconditions

Project identity: AF homes, ACTIVE_HEALTHY, ap-northeast-1, PostgreSQL 17.6.1.166. Applied history: 68 versions, all three approved versions absent. Inspected live function inventory: 189 functions. The existing self-service search paths and replaced permission-function signatures were read.

All three SQL files match the approved `security-release-manifest.json`. Raw and LF-normalized SHA-256 are identical:

| Ordered file | Verified SHA-256 |
| --- | --- |
| `20261128000002_afhomes_self_search_path_hardening.sql` | `4f6f851392d3bb4a07ea8703f32dc4d632c608cbe6d60d01bff7db98d8077ba4` |
| `20261129000001_afhomes_document_scope_security.sql` | `ae052d7e5e6c6bf9262ca54f0f085576445b3dae2d55f4b5982a0c85c11f0fca` |
| `20261129000002_afhomes_staff_business_security.sql` | `effe09b1b2929772622bad4234e82ab864d1003a02c9cbbbf42f8b74f6c56272` |

## Vercel exit code 2: exact error and correction

Reproduced both original queries using the original inline Node wrapper, with stderr captured instead of discarded. Each child exited **2** with:

```text
Error: Invalid arguments. Use an API path starting with /, or run `vercel api` interactively.
```

The wrapper used `execFileSync('cmd.exe', ['/d', '/s', '/c', command])` and `stdio: ['ignore','pipe','ignore']`. Its catch reported the child status but exited 1 itself. Windows shell argument forwarding made the CLI reject the wrapped API path. The identical project request succeeded through direct PowerShell; shell-free Node invocation also succeeds. This is an invocation defect, not evidence of expired authentication, wrong team scope, or a fresh permission denial. Earlier connector 403 responses are separate evidence.

Added [read-only verification script](../../scripts/checkpoint-vercel-verification.mjs), using the existing cached CLI 63.1.2 JavaScript entrypoint with an argument array and no shell. It captures both streams internally, preserves failed child exit codes, classifies known argument/authentication/permission/target errors, withholds unknown potentially sensitive output, rejects malformed JSON and failed required assertions, and emits only selected metadata. No login, linking, install, environment change, or token flag is used.

Verification: `node scripts/checkpoint-vercel-verification.mjs --self-test` passes error classification, synthetic-secret withholding, and an actual invalid-path CLI failure with status 2. `node --check` passes; scoped Prettier formatting completed. The complete read-only Vercel verification exits 0. Broad application suites were not repeated: application code and approved SQL are unchanged.

## Fresh Production and environment verification

- Authenticated CLI user: `claudmarsjimenezafhomes-9026`; CLI version 63.1.2.
- Team scope `afhomes`, account `team_Z85dMbGy92EW0TavrIP4Yb1Y`; project `afhomes-ecofarm-v2`, ID `prj_apBNxtW4R8E7JohbFg6K8aUGin4j`. Explicit IDs verify the target without creating a missing local `.vercel` link.
- Current Production target and newest Production history entry agree: deployment **`dpl_5K11YDShndKNLcPmdrf4DwivHL7N`**, READY, SHA **`52efaf5dc05db39eb1b59595b22bec71f068b08e`**, branch `preview/afhomes-rebuild`.
- Production URL: `afhomes-ecofarm-v2-39t675eph-afhomes.vercel.app`. Fresh `GET /api/v1/health`: HTTP 200, `ok:true`, `db:ok`, `service:afhomes-api`.
- Production configuration contains `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`, `VITE_WEB_URL`, and `VITE_ADMIN_URL`. Values and credentials are not recorded.
- `AFHOMES_REQUIRE_ADMIN_MFA` is absent across the inspected project environment rows and absent from the current deployment environment-key metadata. This matches the approved optional policy: the SQL singleton must remain `admin_mfa_required=false`.
- Production and Preview `SUPABASE_URL` / `VITE_SUPABASE_URL` hostnames match `ikaevepedpqygdlipsei.supabase.co`. Only the match result is emitted. The public entry asset did not independently expose a Supabase hostname; no artifact-level mapping claim is made from that scan. Healthy deployed database access corroborates the configured mapping, but does not independently reveal its target.
- Production Branch setting remains `main`, differing from the deployed branch; this verification changes neither setting nor deployment.

[Sanitized Vercel evidence](evidence/checkpoint-vercel-verification.json).

## SQL preflight and new stop condition

Fresh connector identity confirms AF homes, target `ikaevepedpqygdlipsei`, ACTIVE_HEALTHY, PostgreSQL 17.6.1.166. All 68 history versions match the reviewed baseline. All 189 public/private function definitions and inspected anon/authenticated/service-role EXECUTE privileges match the reviewed baseline after LF normalization and comparison using identity arguments. Default argument formatting and stored Windows line endings are normalized, not mislabeled as drift. The three full file hashes above still match the approved manifest; SQL contents, dependencies and optional-MFA insertion were reread.

The actual deployed SHA is the same SHA used by the existing old-API compatibility matrix (17/17 before and 17/17 after the batch, previously executed locally). A fresh source scan confirms no direct document reads, forced-password flag, or MFA-getter references in the deployed apps and staff access module. Existing compatibility proof remains applicable; a live post-SQL compatibility result is not claimed.

Before any write, tested the direct PostgreSQL execution path with `rejectUnauthorized:true`, after removing URL TLS overrides. Target hostname/pooler username was checked internally. The connection failed with **`SELF_SIGNED_CERT_IN_CHAIN`**, exit 1. This means the configured direct path cannot currently authenticate its certificate chain using the Node trust store; it does not establish whether the missing trust is a project CA or a local interception CA. No credential values or connection URI were printed. No query, migration transaction, DDL, or history insert was sent on that path.

**STOPPED BEFORE MIGRATION 1.** The authorization requires stopping on a failed prerequisite or unexpected error. TLS verification was not disabled. The existing runner's `rejectUnauthorized:false` was not used as a bypass. The connector migration tool does not expose an exact version parameter, so it was not substituted without proof that it would preserve the approved versions.

Required next step: establish the authenticated, trusted certificate chain for the exact direct execution path, then repeat the read-only checkpoint. Do not acquire a CA from an unverified peer or weaken TLS verification. The existing authorization remains limited to the same three files, hashes, target and order; a trust-store repair does not authorize SQL changes or expanded migration scope.

## Actual database state at the earlier stop

- Migration history remains 68; approved versions `20261128000002`, `20261129000001`, `20261129000002` are absent.
- `private.staff_security_policy`, `public.afhomes_admin_mfa_required()`, `private.staff_business_access(uuid)` and `private.can_read_identity_document(uuid)` are absent.
- Auth account count: 1. Super Admin count: 1. VIP plan count: 3, codes BRONZE/GOLD/SILVER.
- Authenticated SELECT privileges on `identity_documents.extracted_data`, `reviewed_data` and `sha256` remain true. The F-01 column denial is not installed.
- No optional-MFA policy row was created and MFA was not enabled. Existing accounts, business records, audit history and Auth configuration were not changed.
- The Super Admin is active, assigned to an active role, and not forced to change its password. All six existing RLS-invariant queries return zero violations. These baseline invariants do not certify the unapplied F-01/F-02 fixes.

## Post-migration verification status at the earlier stop

All three migration applications, per-step postconditions, final getter/singleton checks, ownership/column-denial enforcement, final RPC permission verification and post-SQL production compatibility are **NOT EXECUTED**, because no SQL was applied. They are not marked PASS. The existing function ACLs were read, not changed.

## Recovery and next approval boundary

The documented forward-only recovery plan was reconfirmed: a failed pre-commit migration transaction rolls back without a history entry; after a successful commit retain tightened policies and repair forward with separately reviewed SQL. Never reinstall vulnerable definitions, toggle MFA as an automatic rollback, reset the database, or rewrite business/audit history. No recovery SQL is needed now because nothing was applied.

After certificate trust is repaired, revalidate target, hashes, history, Production and optional MFA before resuming the existing authorized three-file sequence. Verify each successful version before the next. Git push, PR publication, Vercel deployment, merge, Auth changes, MFA enablement, the performance index and any additional SQL remain separately gated.

## Sensitive-output incident

The initial direct PowerShell reproduction printed the raw project response, including encrypted environment metadata and an automation protection-bypass token. This was an output-handling error. The token is not repeated in these files; subsequent responses stay inside the process and only selected fields are emitted. The owner should rotate the exposed protection-bypass token. Rotation was not performed because Vercel configuration writes are outside this task's authorization. This incident does not imply exposure of plaintext Supabase credentials.

[Machine-readable current results](evidence/checkpoint-a-execution.json). The earlier stop was respected; the later continuation applied only the explicitly approved three-file batch. No PR, merge, manual Vercel deployment, index, unrelated migration, Auth change or Production promotion is part of this checkpoint.
