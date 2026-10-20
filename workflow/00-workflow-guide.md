# Workflow Guide — Reusable Development Process

## Goal

Use a predictable, approval-based workflow that works across different programming languages, frameworks, and repository types.

## Workflow

1. **Explore:** Understand the codebase before making changes.
2. **Plan:** Trace the task and propose a testable implementation plan.
3. **Approve:** The user reviews and approves the plan.
4. **Build:** Implement only the approved scope.
5. **Verify:** Run appropriate tests and checks.
6. **Review:** Inspect the diff for defects, regressions, security concerns, and scope creep.
7. **Document and hand off:** Update relevant documentation only when appropriate, then report what happened.

## Agent/mode guidance

- Use the available **Plan** agent/mode for read-only investigation and planning.
- Use the available **Build** agent/mode for approved changes.
- A separately configured, read-only reviewer can provide an independent review.
- Confirm the actual agents, modes, and permission configuration in your OpenCode installation. Prompt text is guidance, not a substitute for tool permissions.

## Approval gates

- Exploration ends with a report; do not start implementation.
- Planning ends with a proposed plan; do not edit files.
- Building starts only after the user has approved the plan.
- Stop and ask when a material requirement, business rule, data migration, security decision, or scope change is unclear.
- Do not commit, push, deploy, or run destructive operations without explicit approval.

## Universal rules

- Read and follow applicable `AGENTS.md` files and repository documentation.
- Base findings on actual files, code, and command output.
- Do not invent architecture, requirements, test results, or business rules.
- Prefer the smallest safe change that satisfies the approved acceptance criteria.
- Preserve backward compatibility unless the approved task explicitly changes it.
- Protect secrets and personal data.
