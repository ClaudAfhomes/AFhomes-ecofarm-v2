---
name: afhomes-orientation
description: Orient in the AF Homes Ecofarm V2 monorepo — locate modules, entry points, docs and the right domain skill without scanning the repo. Use at the start of an unfamiliar AF Homes task or when asked "where is X / how is X structured".
---

# AF Homes orientation

## Applies when
Starting a task in an unfamiliar area, or answering "where/how" questions.

## Procedure
1. `git branch --show-current` and `git status --short | head` — confirm branch; note user's uncommitted work.
2. Open `docs/ai/repository-map.md` (layout, entry points) and `docs/ai/architecture-index.md`.
3. Locate code: `rg -n "<symbol>" api/_lib api/_handlers` or `rg --files apps/admin/src/features | rg <area>`.
4. For dependencies/impact: `graphify explain "<file or symbol>"`, `graphify path "A" "B"`.
   Graph is dated (see `docs/ai/README.md`); verify every edge in source.
5. Read only the exact line ranges you need.
6. Hand off to the domain skill (`afhomes-ist-ost`, `afhomes-customer-vip`, `afhomes-sales-finance`,
   `afhomes-backend`, `afhomes-frontend`, `afhomes-database`).

## Source of truth
Code on the current branch > `AGENTS.md` (already loaded via CLAUDE.md) > `docs/mongodb/<latest dated report>` > older docs.
History lives in `docs/agents/` (MongoDB conversion log, Supabase/Vercel legacy reference,
knowledge vault) — open only the one the task needs; past approvals there are not standing authorization.
Label findings VERIFIED / INFERRED / UNVERIFIED / CONFLICTING.

## Do not
Read root `*.log`, `outputs/`, `graphify-out/` contents or `vercel-static/`.
The Obsidian vault path in `docs/agents/knowledge-vault.md` (`C:\Users\SSD-ORLANDO\...`) does not exist on this machine.

## Done when
You can name the files to change and the governing rule document.
