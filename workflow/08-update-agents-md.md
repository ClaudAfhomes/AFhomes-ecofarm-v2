# UPDATE AGENTS.md — Audit Instructions Before Editing

## Recommended agent/mode
Use **Plan** mode to audit and propose changes. Use **Build** only after approval to edit the file.

## Scope

[Repository root, subdirectory, or specific instructions file.]

## Prompt

Audit the existing `AGENTS.md` instructions and determine whether they accurately help future coding agents work safely and consistently in this repository.

### Audit

1. Find all applicable `AGENTS.md` files and explain their scope. Do not assume a root file is the only one.
2. Compare instructions against the actual codebase, package scripts, architecture, tests, and current conventions.
3. Identify instructions that are:
   - inaccurate or stale
   - contradictory or duplicated
   - too vague to be actionable
   - missing for important workflows
   - overly broad or likely to cause unsafe behavior
4. Separate verified facts from recommendations.
5. Identify any instructions that could conflict with nested instructions or existing tooling.

### Proposal

For each proposed change, provide:
- Current instruction or problem.
- Evidence from the repository.
- Recommended wording or removal.
- Reason and expected benefit.
- Scope of impact.

### Rules

- Do not edit any files during the audit.
- Do not invent project conventions or commands.
- Do not copy secrets or sensitive configuration into documentation.
- Do not replace the entire file merely to make it shorter or more polished.
- Preserve useful existing guidance.
- Ask about unclear business or team-specific rules rather than inventing them.

Stop and wait for approval before modifying `AGENTS.md`.

### After approval

Make only the approved changes. Verify every command and factual statement against the repository. Inspect the diff and report exactly what changed.
