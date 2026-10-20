# PLAN — Investigate and Propose an Implementation Plan

## Recommended agent/mode
Use the available **Plan** agent/mode. This phase must be read-only.

## Prompt

Before implementing this task, investigate the existing behavior and prepare a plan.

### Phase 1: Understand the task

1. Restate the requested outcome in your own words.
2. Identify the existing behavior and trace the relevant code flow from entry point to data changes or user-visible output.
3. Locate the files, components, services, APIs, models, schemas, middleware, and database structures involved.
4. Read applicable `AGENTS.md` instructions and follow existing project conventions.
5. Locate relevant tests and identify how similar behavior is tested.
6. Identify unclear requirements, assumptions, edge cases, failure states, and potential regressions.

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
- If an important business rule or requirement is unclear, ask me before presenting the plan as final.
- Keep the plan limited to the requested scope; do not bundle unrelated cleanup.
- Do not claim that a test or command was run unless it actually was.

Stop after presenting the plan. Wait for my explicit approval before modifying any files.

## Task

[Describe the feature, bug, or change.]
