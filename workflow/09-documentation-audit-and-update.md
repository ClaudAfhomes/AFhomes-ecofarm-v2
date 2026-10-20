# DOCUMENTATION AUDIT & UPDATE — README and Markdown Files

## Recommended agent/mode
Use **Plan** mode for the audit and proposal. Use **Build** mode for approved documentation changes.

## Scope

[Specify README, docs folder, setup guide, API docs, runbooks, or other Markdown files. If blank, audit key developer-facing documentation.]

## Prompt

Audit the relevant documentation against the actual repository, then propose targeted updates.

### Phase 1: Audit

- Locate relevant `README.md`, docs, setup guides, contribution instructions, API docs, runbooks, and Markdown files.
- Verify setup commands, package manager, scripts, environment variable names, architecture descriptions, folder paths, and links against actual files.
- Identify missing, stale, contradictory, duplicated, unclear, or misleading documentation.
- Identify important undocumented workflows, prerequisites, test commands, configuration steps, or known limitations.
- Never reveal secret values. Document only safe variable names and how to configure them using approved examples.

### Phase 2: Proposal

For each proposed update, explain:
- File and section.
- Verified issue or documentation gap.
- Proposed change.
- Evidence and intended audience.
- Whether the change is required or optional.

Do not edit files until I approve the proposal.

### Phase 3: Approved updates

After approval:
- Edit only the approved documentation scope.
- Keep instructions concise, reproducible, and consistent with the actual codebase.
- Do not claim features exist unless verified.
- Do not invent environment values, URLs, credentials, deployment processes, or team policies.
- Check links and commands when safe and practical.
- Review the diff for unrelated changes.

### Report

List files changed, key corrections, checks performed, unverified statements, and remaining documentation gaps.
