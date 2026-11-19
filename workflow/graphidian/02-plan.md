## 4. Stage 4 — Investigation and planning

Establish, in writing, before editing:

1. **Current behaviour** — what actually happens now, with the evidence.
2. **Expected behaviour** — what the user asked for.
3. **Root cause / requirement** — especially for bugs: reproduce, do not guess.
4. **Affected modules and files** — Graphify `affected` / `path` plus the real
   file list.
5. **Applicable business rules and security constraints** — quote the
   `AGENTS.md` section or contract field that binds this change.
6. **Regressions and edge cases** — who else calls this, what breaks.
7. **Proposed solution** — minimal, matching existing patterns.
8. **Tests and checks** that will prove it.

### Mandatory approval gate — present a plan and wait

Stop and get explicit approval **before** implementing when the task:

- touches **security, permissions, roles, RLS, or PII**;
- changes a **business rule, status, transition or invariant**;
- adds or changes a **migration** (production apply always);
- changes **API contracts** in a breaking way;
- adds a **dependency**, or a new architectural pattern;
- is **cross-cutting** (many features/modules) or otherwise ambiguous;
- involves **deploy, cron, production data, or git state**.

Routine, low-risk, single-surface work: state the plan briefly in your reply
and proceed. **Never treat silence as approval.** Approval for one stage is not
approval for the next.

---

