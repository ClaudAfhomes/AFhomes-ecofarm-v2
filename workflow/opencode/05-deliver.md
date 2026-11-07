# 05 — Deliver

## Recommended agent/mode

Use **Plan** mode for audit and proposal. Use **Build** mode for approved documentation changes.

## Scope

[Specify README, docs folder, setup guide, API docs, runbooks, or other Markdown files. If blank, audit key developer-facing documentation. For release readiness, describe the version, feature, branch, or release candidate.]

## Documentation audit and update

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

Do not edit files until approval is given.

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

## Update AGENTS.md

### Audit

1. Find all applicable `AGENTS.md` files and explain their scope. Do not assume a root file is the only one.
2. Compare instructions against the actual codebase, package scripts, architecture, tests, and current conventions.
3. Identify instructions that are inaccurate or stale, contradictory or duplicated, too vague to be actionable, missing for important workflows, overly broad, or likely to cause unsafe behavior.
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

## Release readiness

### Review

- Confirm the intended scope and inspect the Git status and diff.
- Identify relevant tests and verification commands from the actual project setup.
- Review test results available in the current context; run safe checks only when appropriate and authorized.
- Check configuration and environment-variable changes without revealing secret values.
- Consider database migration safety, rollback options, data integrity, API compatibility, and background jobs where applicable.
- Check logging, monitoring, error handling, and operational documentation where applicable.
- Identify required manual checks, external dependencies, credentials, approvals, or environment-specific validation.
- Look for accidental files, debug code, secrets, unrelated changes, and missing documentation.
- Identify unresolved high-impact risks.

### Rules

- Do not commit, push, deploy, migrate production data, or change shared systems.
- Do not infer release procedures that are not documented.
- Do not claim tests passed unless they actually ran.
- Separate verified facts, assumptions, and checks that remain blocked.
- If rollback or migration safety cannot be established, clearly state that limitation.

### Report

Provide:

1. Readiness recommendation: ready for human release decision, not ready, or unable to determine.
2. Evidence supporting the recommendation.
3. Verification checklist with passed, failed, blocked, and not-run statuses.
4. Blocking issues and non-blocking follow-ups.
5. Migration, compatibility, security, and rollback risks.
6. Manual steps and approvals still required.

This assessment is not authorization to release or deploy.

## Task handoff

### Task

[Describe the task or refer to the current conversation.]

### Handoff report

Include:

1. **Outcome:** What was requested and what is now complete.
2. **Files changed:** Each created, modified, or deleted file and the reason.
3. **Behavior:** What changed from the user's perspective or in system behavior.
4. **Verification:** Exact checks or commands run and actual results.
5. **Not verified:** Checks not run, blocked dependencies, unavailable environments, or untested scenarios.
6. **Plan deviations:** Any differences from the approved plan and why they occurred.
7. **Risks and follow-ups:** Known limitations, unresolved questions, and recommended next steps.
8. **Repository state:** Report relevant Git status facts if actually inspected.

### Rules

- Do not claim completion beyond the available evidence.
- Do not describe a command as successful if it failed or was not run.
- Do not include secret values, credentials, tokens, or sensitive user data.
- Do not commit, push, deploy, or perform additional changes as part of writing this report.