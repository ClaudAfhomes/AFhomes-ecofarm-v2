# REFACTOR — Improve Structure Without Changing Behavior

## Recommended agent/mode
Use **Plan** mode to scope the refactor, then **Build** after approval.

## Target

[Describe the code area and the maintainability problem.]

## Prompt

Plan and perform a behavior-preserving refactor for the approved target.

### Before implementation

- Trace current behavior and identify callers, dependencies, side effects, and public interfaces.
- Locate tests that characterize existing behavior.
- Identify the specific design problem: duplication, excessive coupling, complexity, unclear responsibility, or another evidenced issue.
- Propose the smallest refactor that addresses the problem.
- Define observable behavior that must remain unchanged.
- Identify files likely to change and regression risks.

Do not edit files until I approve the refactoring plan.

### After approval

- Preserve behavior, public APIs, data formats, and business rules unless the approved plan explicitly says otherwise.
- Follow existing project conventions.
- Avoid mixing feature changes with structural cleanup.
- Avoid adding dependencies unless approved.
- Add characterization tests if important existing behavior is not covered and tests can be added safely.
- Run relevant tests and checks.
- Inspect the final diff for accidental behavior changes and unrelated edits.

### Final report

- Refactoring goal and resulting structure.
- Files changed and why.
- Evidence that behavior was preserved.
- Checks run and actual results.
- Any remaining duplication, risk, or follow-up work.

Stop and ask if a behavior change appears necessary.
