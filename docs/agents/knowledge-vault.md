# Knowledge vault & graph workflow (archived from AGENTS.md)

> **Historical reference, not standing instructions.** Archived verbatim from
> `AGENTS.md` lines 1206–1244 at commit `d89023d` (original SHA-256
> `9df3435bbe2e701af741218212ef2d9562421a4cb34ff8a2799ac6d54d1fc9fa`) on 2026-11-04.
> The vault path below does not exist on this machine (checked 2026-11-04). Graphify output may be stale; verify against source.
> Approvals recorded below were scoped to their date and action; they are **not**
> authorization for any future change. Current rules: root `AGENTS.md`.

<!-- archive-body-start -->
## Knowledge vault & graph workflow

A curated Obsidian vault lives **outside this repo** at
`C:\Users\SSD-ORLANDO\Documents\DevVault` (never git-managed from here).
Layout: `00-Home/` (entry: `Home.md`, `Knowledge-Map.md`, `Agent-Workflow.md`),
`01-Projects/AF-Homes-Ecofarm/` (curated project notes), `02-Engineering-Standards/`,
`03-Learning-Log/`, `99-Templates/`, and `01-Projects/AF-Homes-Ecofarm/Graphify-Export/`
(the generated graph export). Rules:

- **Read only the relevant curated note before starting a task** — match by area:
  `Security-Notes`, `Business-Rules`, `System-Flows`, `Data-Model`, `API-Reference`,
  `Architecture`, `Testing-Guide`, `Known-Issues`, `Decisions`, `Lessons-Learned`,
  `Debugging-Patterns`. Never load the whole vault.
- **Structure and dependency questions go through Graphify first** —
  `graphify query/path/explain/affected` against `graphify-out/graph.json` — then
  read the source files it points to.
- **Verify every important finding against the actual source code.** The vault is
  a navigator, never truth: if a note contradicts this repository, the repository
  wins — and the note should be corrected.
- **Label findings** VERIFIED / INFERRED / UNVERIFIED / CONFLICTING (the vault's
  confidence vocabulary), exactly as the vault notes do.
- **The 7,881 generated notes under `Graphify-Export/` are read on demand only** —
  open a single note by symbol/file name; never iterate, copy or bulk-summarize
  them, and never hand-edit them (re-run `graphify export obsidian --graph
  graphify-out/graph.json --labels graphify-out/.graphify_labels.json --dir …`
  to refresh).
- **After a significant completed task, propose curated-note updates** (new
  lesson in `Lessons-Learned`, new invariant in `Business-Rules`, new issue in
  `Known-Issues`, dated entry in `Development-Log`). Apply curated-note updates
  only with the user's approval, except for appending a dated Development-Log
  entry that factually summarizes work already explicitly accepted by the user.
  This exception does not authorize changes to business rules, architecture
  decisions, security controls, or other approval-gated content.
- **Approval first for high-impact decisions**: business rules, architecture,
  security controls, permissions/RLS, migrations/deploy/crons — the same gate as
  the Deployment section above, whether or not the vault documents them.
- **Never store secrets, credentials, tokens, keys, connection strings or
  customer PII in the vault.** The vault mirrors repository knowledge, never
  environment values.
