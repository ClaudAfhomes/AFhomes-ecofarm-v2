@AGENTS.md

# CLAUDE.md — navigation for Claude Code

The import above loads the rulebook (`AGENTS.md`). It wins on any conflict; report
conflicts instead of resolving them silently. Do not copy its rules here.
Historical archives in `docs/agents/` are **not** imported — open one only when the
task needs its history.

Latest session handoff lives in the marker region of `workflow/claude/update-session.md`
(replace, never append). Start: `@workflow/claude/explore-session.md` · Save:
`@workflow/claude/update-session.md`.

## Where things are

- Knowledge index: `docs/ai/README.md` → repository map, architecture index,
  business-rules index, decision register (open items U1–U7), workflow, changelog.
- Authoritative business rules: `docs/AFHOMES-BUSINESS-RULES.md` (check each rule's
  status tag), `docs/business-rules/INDEX.md` + `CONFLICTS.md` + `OPEN_QUESTIONS.md`,
  then the dated `docs/mongodb/*` report. Summaries in skills are navigation, not policy.
- Native MongoDB code: `api/_lib/*.mongo.ts`; feature flags `packages/shared/src/features.ts`.
- Not this repo: `ClaudAfhomes/afhomes-mongodb` (never assume merged) and
  `orlando-afhomes/afhomes-platform` (Ant Design prototype; its UI choices do not apply here).

## Skills (load only the one the task needs)

| Task | Skill |
|---|---|
| First look / where is X | `afhomes-orientation` |
| Any rule-sensitive change | `afhomes-business-rules` → domain skill |
| IST/OST, accreditation, genealogy, transfer, renewal | `afhomes-ist-ost` |
| Customers, VIP numbers, membership, Stay Points | `afhomes-customer-vip` |
| Sales, payments, commissions | `afhomes-sales-finance` |
| React/Vite UI | `afhomes-frontend` |
| API handlers, auth, RBAC | `afhomes-backend` |
| MongoDB / legacy SQL | `afhomes-database` |
| Choosing/running tests | `afhomes-testing` |
| Droplet/Nginx/systemd procedures (manual only) | `/afhomes-deployment` |
| Context and token discipline | `afhomes-token-efficiency` |

Path-scoped rules in `.claude/rules/` load when matching files are touched.

## Standing user preferences (apply without asking)

- **@ponytail full** — smallest complete change; house components first; no new deps;
  finish callers + tests + fixtures in the same change.
- **UI rounds are UI-only** — no handler/contract/SQL/history edits; desktop + tablet +
  mobile; gate: focused vitest + `tsc` + `eslint` + admin build; one named surface at a time.
- **User-facing copy** — every sentence max 5–6 words. Added copy gets reviewed and stripped.
- **Prettier is NOT a gate** (CRLF artifact on Windows). Gate on `tsc` + `eslint` only.
- **Re-check state before assuming** — `git status` / `git log` before touching anything;
  re-read shared files before editing; leave foreign diffs alone; never restore what the
  user deliberately removed.
- The user may edit and commit mid-session — treat the working tree as unstable during
  long tasks.

## Known pre-existing failures (do not fix silently)

- **`pnpm test:db:harness`** (legacy Postgres) — blocked by DB suite section 77:
  `public.transfer_sale_team_member` sets `startsOn: null` on OST→IST conversion. Do not
  adjust the assertion; investigate the root cause first.
- **Sections 48, 58** — customer import referral hierarchy and purchase-terms reason
  refusal. Pre-exist current work.

## Token-efficient workflow

1. Identify the module → `docs/ai/` index → one skill.
2. Locate with `rg --files` / `rg -n` (exclude `node_modules`, `outputs/`, `graphify-out/`,
   `vercel-static/`, `dist/`, root `*.log`, `docs/mongodb/*.json`); read exact line ranges.
3. Structural questions: `graphify explain|path|query`. The graph may be stale — verify
   every result in current source.
4. Smallest correct change; reuse contracts, helpers and components.
5. Focused spec → workspace typecheck → scoped lint → broader suites only when warranted.
   Summarize long output; report exit codes; never hide failures.
6. Reply: **Result / Files / Verification / Blockers / Next** — short, no task recap.

Before `/compact`: note branch, goal, changed files, verified findings, tests run,
blockers, next step. Record decisions in `docs/ai/decision-register.md`.
