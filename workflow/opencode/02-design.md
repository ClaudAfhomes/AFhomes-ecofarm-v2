# 02 — Design

## Recommended agent/mode

Use the available **Plan** agent/mode for investigation. Use **Build** only after the fix or refactor is understood and approved.

## Task

[Describe the feature, bug, or change.]

## Prompt

Before implementing this task, investigate the existing behavior and prepare a plan.

### Phase 1: Understand the task

1. Restate the requested outcome in your own words.
2. Identify the existing behavior and trace the relevant code flow from entry point to data changes or user-visible output.
3. Locate the files, components, services, APIs, models, schemas, middleware, and database structures involved.
4. Read applicable `AGENTS.md` instructions and follow existing project conventions.
5. Locate relevant tests and identify how similar behavior is tested.
6. Identify unclear requirements, assumptions, edge cases, failure states, and potential regressions.

### Bug investigation

If this is a bug, also:

- Restate the symptom and separate confirmed observations from assumptions.
- Identify the smallest reproducible scenario, if possible.
- Inspect related tests, error handling, logs, and recent relevant changes.
- Form plausible hypotheses and rank them by evidence.
- Test hypotheses using safe, read-only inspection or non-destructive tests.
- Identify the likely root cause only when supported by evidence.

### Refactoring

If this is a refactor, also:

- Trace current behavior and identify callers, dependencies, side effects, and public interfaces.
- Locate tests that characterize existing behavior.
- Identify the specific design problem: duplication, excessive coupling, complexity, unclear responsibility, or another evidenced issue.
- Propose the smallest refactor that addresses the problem.
- Define observable behavior that must remain unchanged.
- Identify files likely to change and regression risks.

Do not edit files until the plan is approved.

### Phase 2: Propose the plan

Provide:

- A short summary of the proposed solution.
- Ordered implementation steps.
- Expected files to change and why each change is needed.
- Files that may need to be added, if any.
- Acceptance criteria that can be verified.
- Relevant tests and verification commands, based on actual project scripts.
- Security, privacy, data integrity, performance, accessibility, and backward-compatibility risks where applicable.
- Any migration, configuration, API contract, or documentation impact.
- A list of assumptions and questions that need an answer.

### Rules

- Do not modify project files.
- Do not install dependencies.
- Do not run destructive commands or make changes to shared systems.
- Do not invent business rules or treat assumptions as confirmed requirements.
- Distinguish verified facts, assumptions, and recommendations.
- Support important claims with file paths and, when useful, function or symbol names.
- If an important business rule or requirement is unclear, ask before presenting the plan as final.
- Keep the plan limited to the requested scope; do not bundle unrelated cleanup.
- Do not claim that a test or command was run unless it actually was.

Stop after presenting the plan. Wait for explicit approval before modifying any files.