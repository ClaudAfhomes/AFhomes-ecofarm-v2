# BUILD — Implement the Approved Plan

## Recommended agent/mode
Use the available **Build** agent/mode after the user explicitly approves the plan.

## Task

[Describe the feature or bug.]

## Approved plan

[Paste the approved plan or refer to the plan agreed in this conversation.]

## Prompt

Implement the approved plan for this task.

### Requirements

- Follow the existing project architecture, coding conventions, and applicable `AGENTS.md` instructions.
- Keep changes limited to the approved scope.
- Do not invent business rules, alter unrelated behavior, or make unapproved architecture changes.
- Inspect the relevant existing code before editing it.
- Reuse existing components, services, utilities, and patterns when appropriate instead of duplicating them.
- Add or update tests for changed behavior where appropriate.
- Consider validation, error handling, accessibility, security, data integrity, and backward compatibility where applicable.
- Do not install or update dependencies unless I explicitly approve it.
- Do not modify secrets or production configuration.
- If implementation requires a material change to the approved plan, a new dependency, a schema migration, a breaking API change, or an unclear business decision, stop and ask me first.
- Do not hide failing tests, weaken assertions merely to make tests pass, skip relevant checks without explaining why, or claim checks passed without evidence.

### Verification

- Run relevant tests, lint checks, type checks, and build checks using the project's existing scripts where practical.
- If a command is unsafe, unavailable, too expensive, or requires external credentials/services, explain that before skipping it.
- Investigate failures that may have been caused by your changes and fix them when within scope.
- Clearly separate failures caused by this change from pre-existing failures when evidence allows. Do not assume a failure is pre-existing without checking.

### Before finishing

Inspect the Git diff and report:

1. What changed and why.
2. Files created, modified, or deleted.
3. Which checks were run and their actual results.
4. Which checks could not be run and why.
5. Remaining risks, limitations, or unresolved issues.
6. Any deviations from the approved plan.
7. Any follow-up decisions or actions needed.

Do not commit, push, deploy, run destructive operations, or change shared/production systems without my explicit approval.
