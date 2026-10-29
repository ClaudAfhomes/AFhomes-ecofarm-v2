# Phase 5 customer activation continuation

User scope: continue OpenCode's Phase 5; preserve the already-bootstrapped admin.
No Atlas writes, source changes, migration, real messages, commits or deployment.

Repository evidence: catalog draft is unmounted and uses incompatible ObjectIds;
active customer routes still use Supabase; earlier local fixture is standalone,
despite its replica-set description. Phase 0/2/3/4 completion text is not proof.

Implementation sequence:

- [x] Add a fresh disposable replica-set test fixture without shared-path cleanup.
- [x] Prove hashed, expiring VIP code/link issuance and atomic redemption with
      native driver transactions, Better Auth password hashing and actual login.
- [x] Preserve orphan-identity linking without password overwrite, refuse staff
      and already-owned identities, and preserve the bootstrap administrator.
- [x] Add ownership-scoped profile/membership/legacy-points-summary/payment reads with
      existing contracts, sensitive-field projections and disabled-route denial.
- [x] Correct catalog UUID handling and test source economics/visibility rules.
- [x] Run relevant regression/type checks and document remaining Phase 5 gaps.

This bounded continuation is verified; the whole Phase 5 remains in progress.
See `docs/mongodb/PHASE5-REPORT.md` for remaining directory, advanced points,
staff/session and browser integration work. No phase completion is inferred.

The active browser/router cutover and broken earlier Mongo staff resolver must
not be concealed by injecting permissive authorization in production. New
factories remain explicit and unmounted until those integration gates pass.
