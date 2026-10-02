# Approved A/B/C apply verification

Date: 2026-10-02, Asia/Singapore. Project: `ikaevepedpqygdlipsei`.
Branch: `preview/afhomes-rebuild`.
HEAD: `6001155021039c3b1aa3883e8938369fb98604c5`.

**PASS - approved migration apply and live PostgreSQL verification.**
This is not deployed application acceptance. No deployment, commit, push or
bulk live customer import was performed.

## Requested final report

1. **A applied: YES.** Executed using only `--only=20261019000001`.
2. **A history count: 1.**
3. **A RPC: PASS.** Live body equals the reviewed replacement; both defective
   `v_plan.holder_limit` references are gone. Signature, result, SECURITY DEFINER,
   search path and service-only execution are preserved. Live Bronze/Silver/Gold
   drafts and Gold plus secondary succeed; Bronze/Silver secondary reject.
   Every smoke record was rolled back.
4. **B applied: YES.** Executed only after A verification, using
   `--only=20261019000002`.
5. **B history count: 1.**
6. **Import objects: PASS.** Both tables and all seven intended import, directory,
   matching, lifecycle and allocation functions are present. Every explicitly
   defined function body equals reviewed B. Browser function execution is denied;
   service execution is granted to the intended callable functions.
7. **Legacy provenance: PASS.** `origin`, `import_job_id`, `import_row_id` exist.
   Legacy creation is explicitly marked, preserves unknown seller as NULL, and
   contains no commission insert. The hierarchy trigger changes only to skip
   explicitly marked legacy history; normal behavior is preserved.
8. **Historical payments: PASS, within the approved minimal validation scope.**
   Live definitions match reviewed amount/date/method/scheme guards and dated
   payment writes. Live negative guards reject missing historical member total,
   missing actual scheme, and missing non-spot-cash context. No actual legacy
   customer creation was committed or positive import allocation executed live.
9. **Member numbers: PASS.** The exact reviewed advisory-lock allocator,
   collision loop, format guard and exhaustion guard are live; normal activation
   changed only to call that allocator. Supplied-number uniqueness and sequence
   advancement guards are present. Invalid format rejects live before allocation.
   Concurrency/positive allocation was proven in the preceding disposable suite;
   production customer/sale/member sequences were intentionally not advanced.
10. **Reactivation and identifiers: PASS.** Transactional live probes reject
    cancelled, suspended and expired to Active with actual existing/requested
    states. Contradictory customer number and case-insensitive email owner reject.
    Case-insensitive trimmed email lookup matches the synthetic record. The
    installed membership-owner cross-check equals reviewed code.
11. **Category query: PASS.** The real `customer_directory` executes before and
    after C and uses `cash_price_snapshot`. Live synthetic cases prove Active VIP,
    cancellation/suspension/expiry precedence, suspended-customer precedence and
    reservation-only classification when reservation equals required initial.
12. **Retry/counts: PASS for live SQL.** A committing job's already-committed row
    returns the same IDs on retry. Live CHECK constraints reject `completed` with
    five invalid rows; 495 plus 5 correctly accepts `completed_with_errors`.
    Backward transition to committing rejects. HTTP resume/paging behavior remains
    reviewed local API code; it was not deployed during this apply.
13. **XLSX protections: local source verified unchanged.** The reviewed 8 MB
    upload, 24 MB expanded, per-part/shared-string/cell/text/column budgets,
    5000-row cap, strict ZIP/XML parsing and workbook relationship resolution
    remain intact. These are API protections, not migration SQL. Deployed parser
    behavior was not verified or changed in this task.
14. **Google protections: local source verified unchanged.** HTTPS
    `docs.google.com` validation, server-built export URL, redirect rejection,
    streamed 5 MB cap and 20-second timeout remain reviewed local code.
    No Google credential or browser secret was added. Deployed behavior remains
    unverified; no API deployment occurred.
15. **RLS/authorization: PASS.** Both import tables have RLS and exactly their
    expected authenticated SELECT policy. Live authenticated INSERT/UPDATE/DELETE
    probes fail; service-role job insertion succeeds transactionally. Admin has
    view/create/update and no delete. No unrelated role gained the module.
    Super Admin effective permission passes; an unassigned identity is denied.
16. **C applied: YES.** Executed only after B verification, using
    `--only=20261019000003`.
17. **C history count: 1.**
18. **Private trigger grants: PASS.** `anon` and `authenticated` cannot execute
    either `private.reject_overlapping_commission_rule()` or
    `private.validate_official_form_holders()`. Bodies, arguments, result,
    SECURITY DEFINER properties and search paths remain unchanged. The live
    repository RLS invariant audit returns zero violations.
19. **#19: UNAPPLIED.** History count 0; local bytes equal HEAD. The three
    `2026101800000x` history counts are each 1 and their local files remain
    byte-identical to HEAD.
20. **Unexpected migrations: NO.** History changes exactly from the reviewed
    25-version baseline to that baseline plus A/B/C. The three apply logs show
    exactly A, then B, then C, one migration per invocation.
21. **Unexpected retained data mutation: NO.** All synthetic smoke records were
    inside rollback transactions. Customers, applications/holders, sales,
    payments, memberships, commissions, points accounts/ledger and audit counts
    equal preflight counts. Customer/sale/member sequences are unchanged by B
    validation. Authorized schema, module/role permission and history changes
    are the intended migration effects. No Auth account/invitation was created.
22. **Git state:** no commit, push or implementation edit. Branch/HEAD remain
    as above. A/B/C SHA-256 hashes are unchanged from preflight. The existing
    working tree has 33 modified tracked files and 19 existing untracked files;
    this new verification report adds one untracked file. Tracked diff totals:
    **33 files changed, 3625 insertions, 665 deletions**. Full status and stat
    are linked below, including the preceding authorized UAT/import work.

## Preflight and verification notes

The no-network preflight selected exactly A/B/C. Live preflight verified the
project-specific database hostname/user, configured ref, branch/HEAD, unique
local versions, exact reviewed live history, unrecorded A/B/C and #19, protected
applied files, and A's exact two-reference correction against the live function.
The guarded migration workflow was used; no broad apply or migration repair ran.

The first temporary B smoke fixture omitted required `balance_due_at`. That
transaction rolled back. Only the temporary fixture was corrected; no migration
or application source was changed. The complete B verification then passed.

Read-only Supabase security advisor checks before/after C report the same two
informational RLS-without-policy notices for existing server-only tables and an
existing disabled leaked-password-protection warning. No advisor finding names
the new import tables. No Auth/security setting was changed. RLS and privileges
were verified separately, consistent with
[Supabase's RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Immutable applied-file hashes

| Migration | SHA-256 |
|---|---|
| A | `04a776723fbcc18f3afc9cdd8f4845d25ef8724297ea2b7338e5d3c05cc9916e` |
| B | `233bdda1b22f27f0ab258f2ea0b8de1970e7ceef719cd8211c7759162d543fd3` |
| C | `5b4fc561db41efe070d79df218d54d71ac5412c1feb6e43a96df03ccde990346` |

## Local evidence

- [Final history and immutable hashes](../.tmp-bin/approved-abc-final-evidence.json)
- [A apply log](../.tmp-bin/approved-abc-apply-A.log)
- [A live verification](../.tmp-bin/approved-abc-verify-A.log)
- [B apply log](../.tmp-bin/approved-abc-apply-B.log)
- [B final live verification](../.tmp-bin/approved-abc-verify-B-final.log)
- [C apply log](../.tmp-bin/approved-abc-apply-C.log)
- [C live verification](../.tmp-bin/approved-abc-verify-C.log)
- [Final read-only checks](../.tmp-bin/approved-abc-postcheck.log)
- [Git status](../.tmp-bin/approved-abc-git-status.txt)
- [Tracked diff stat](../.tmp-bin/approved-abc-git-diff-stat.txt)

**STOP.** No deployment, commit, push or bulk live import follows this apply.
