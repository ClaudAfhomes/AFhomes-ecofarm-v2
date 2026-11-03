# MongoDB branch checkpoint — 29 October 2026

Repository: `ClaudAfhomes/AFhomes-ecofarm-v2`.
Branch: `claud/mongodb-conversion`. The user explicitly requested commit/push.

This saves the accumulated native MongoDB application, authentication, RBAC,
purchase/Finance/member/points/search/import work, local private storage,
disposable recovery rehearsal and unmounted migration mapping preparation.
Existing CMS/editor/shared website-content changes are retained as a workspace
checkpoint; CMS, Reports, Services and Redemption remain feature-disabled. This
is not release acceptance, live data migration or a production cutover.

## Verification at commit preparation

- Root `pnpm typecheck`: passed.
- `pnpm check:env`: passed (742 browser / 454 server source files).
- Root `pnpm build`: passed; Turbo reused the matching app build cache.
- Root `pnpm lint`: passed with warnings, no errors.
- Full API run: 3,115 passed; three checks hit test/hook deadlines during the
  concurrent API/admin runs. The two affected API files were rerun alone with
  one worker: all 20 tests passed. The full run itself was not green.
- Admin run: 982 tests / 108 files passed, but two workers failed to start
  (`cms.spec.tsx`, `filterbar-adoption.spec.tsx`). Those files were not verified
  by that run; the complete admin suite is not green.
- Earlier focused native mapping/recovery/import results remain documented in
  their reports. Browser acceptance, complete password/data/file migration and
  durable real-data backup/key recovery remain open.

## Publication boundary

Staged text was scanned for credential-bearing Atlas URIs, private keys, provider
keys, JWT literals and known secrets found in local diagnostic scripts. No matches
were present in the staged application snapshot. Secret values were not included
in this report.

Environment files, local credential/diagnostic scripts, generated outputs,
browser artifacts and Supabase CLI cache changes remain local. Older unverified
MongoDB test launchers/suite copies lacking remote-target guards are also excluded;
their package commands are omitted from this commit while the working copies
remain intact. The tested Vitest disposable fixtures and recovery command are
included. No administrator, business database or private storage data was changed
while preparing this Git checkpoint. No deployment command was run.
