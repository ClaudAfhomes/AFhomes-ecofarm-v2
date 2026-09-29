# AFHOMES Release Candidate Checklist

Candidate: `preview/afhomes-rebuild` @ `62c1a04` (pushed, clean, aligned with origin).
Proposed tag (NOT created): `v2.0.0-rc.1`.

Check only with evidence. Unchecked items are the remaining manual actions.

## Code and tests (evidence in hand)

- [x] Worktree clean (`git status` empty; only ignored build output remains)
- [x] Changes committed (4 reviewed commits: `2af3132`, `1bb2cff`, `59dd966`, `62c1a04`)
- [x] Branch pushed (`cbc61ed..62c1a04`, aligned with origin)
- [x] D-12 launch policy recorded + enforced (creation-time 409 guard, bypass tests green)
- [x] Business operating procedures accepted into tree (`docs/AFHOMES-LAUNCH-OPERATING-PROCEDURES.md`; formal management sign-off still pending per register)
- [x] All tests green (`pnpm test`: api 1084, admin 252, web 145, ui 59, shared 22, contracts 32, config 6)
- [x] All 19 migrations proven locally (`pnpm test:db:local` 887/887; `pnpm test:db:harness` 13/13)
- [x] Typechecks, lint (0 errors), env isolation (source + built), production build green
- [x] Secret hygiene green (scanner + git-aware checks; `.env.local` gitignored)

## Hosted and live (operator actions — all pending)

- [ ] Hosted migration state confirmed (assumed 18/18; verify in Supabase dashboard)
- [ ] Migration 19 approved and applied (additive/widening-only; down path documented)
- [ ] Supabase Auth URLs confirmed (Site URL + redirect allowlist)
- [ ] SMTP/Resend verified live (last known: 550 domain-unverified; re-prove or scope email out)
- [ ] Staff invite live test passed (designated test address only)
- [ ] Recovery live test passed (designated test address only)
- [ ] Service role rotated + confirmed (past exposure treated as compromise)
- [ ] Preview env confirmed (server + browser scopes, no secret leakage)
- [ ] Production env confirmed (same)
- [ ] Preview deployment healthy (post-push auto-deploy; inspect in Vercel dashboard)
- [ ] Browser UAT passed (14 screens × 390×844/768×1024/1440×900; no automation available here)
- [ ] Backup plan confirmed for the project plan (do not assume PITR)
- [ ] Rollback target confirmed (prior production deployment identified)
- [ ] Production smoke checklist executed (read-only + designated records; see release-readiness doc §18)

## Release-candidate checklist status

Engineering complete. Remaining items are operator/manual confirmations. No further code changes expected before `v2.0.0-rc.1` unless UAT finds a defect.
