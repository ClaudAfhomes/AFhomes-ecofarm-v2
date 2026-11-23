# Architecture index

| Area | Active (this branch) | Authoritative docs |
|---|---|---|
| Frontend | React 19, Vite 8, TanStack Query 5, CSS Modules, `@afhomes/ui` | AGENTS.md § Conventions |
| API | Single router, `/api/v1/*`, handlers `api/_handlers`, native `api/_lib/*.mongo.ts` | `docs/mongodb/CORE-WORKFLOWS-REPORT.md`, `PHASE5-INTEGRATION-REPORT.md` |
| Auth | Better Auth 1.7, password-only (MFA removed), forced temp-password change, Turnstile | `docs/mongodb/PHASE2-AUTH-DESIGN.md`, `ACCOUNT-CREATION-SEARCH-REPORT.md`, `PASSWORD-COMPATIBILITY-VERIFICATION.md` |
| AuthZ | Staff RBAC (role − deny restrictions, per request); customer ownership; separate systems | AGENTS.md § Authorization architecture |
| Database | MongoDB Atlas, driver 7.7, `afhomes_dev` default; six core validators | `docs/mongodb/PRODUCTION-DATABASE-SCOPE.md`, `CORE-VALIDATORS-REVIEW.md`, `NATIVE-READINESS-2026-11-03.md` |
| Private files | Local filesystem (`~/.afhomes/private-storage/afhomes_dev` dev; `/var/lib/afhomes` hosted), signed downloads; S3 optional | `docs/mongodb/PRIVATE-STORAGE-SETUP.md`, `NETWORK-STORAGE-REPORT.md` |
| Hosting | DigitalOcean Droplet, Node + systemd + Nginx, no Docker; deployed per owner (5 Nov), production implementation on fetched `develop`/`release/v2.0`; running revision not inspected | `docs/ai/decision-register.md` D20; `docs/mongodb/PHASE-10-RELEASE-READINESS-2026-11-05.md` deployment correction |
| Backups | Local AES-GCM daily task, DPAPI key, no off-device copy | `docs/mongodb/LOCAL-BACKUP-AND-VALIDATOR-SETUP-2026-10-31.md`, `RECOVERY-REHEARSAL.md` |
| Env | Browser `VITE_*` only; server `process.env`; `pnpm check:env` | AGENTS.md § Environment, `.env.example` (names) |
| Module flags | redemption/services/reports/cms = false | `packages/shared/src/features.ts` |
| Legacy | Supabase Postgres + RLS + Vercel | `docs/agents/supabase-legacy-reference.md` (Phases 1–5, Vercel deployment), `supabase/`, `vercel.json`, `docs/supabase/` |
| Current acceptance | Local production-mode proof; browser acceptance partial | `docs/mongodb/LOCAL-RELEASE-ACCEPTANCE-2026-11-03.md` |
