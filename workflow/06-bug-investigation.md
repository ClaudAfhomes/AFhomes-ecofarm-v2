# BUG INVESTIGATION — Find the Cause Before Fixing

## Recommended agent/mode
Use the available **Plan** agent/mode for investigation. Use **Build** only after the fix is understood and approved.

## Bug report

- Expected behavior: [What should happen?]
- Actual behavior: [What happens instead?]
- Reproduction steps: [Steps, if known]
- Error message/log excerpt: [Redact secrets and personal data]
- Environment: [Local, test, staging, production, browser/device/version, if relevant]

## Prompt

Investigate this bug before changing code.

### Investigation

1. Restate the symptom and separate confirmed observations from assumptions.
2. Trace the relevant execution path through UI, API, services, persistence, and external systems as applicable.
3. Identify the smallest reproducible scenario, if possible.
4. Inspect related tests, error handling, logs, and recent relevant changes available in the repository.
5. Form plausible hypotheses and rank them by evidence.
6. Test hypotheses using safe, read-only inspection or non-destructive tests.
7. Identify the likely root cause only when supported by evidence. If the cause is not established, say what evidence is missing.

### Output

- Confirmed symptoms.
- Relevant file paths and execution flow.
- Root cause or ranked hypotheses, with evidence.
- Proposed minimal fix.
- Regression risks and edge cases.
- Tests needed to reproduce the bug and verify the fix.
- Questions or additional evidence needed.

### Rules

- Do not edit files in this investigation phase.
- Do not install dependencies, expose secrets, or alter production/shared systems.
- Do not assume that correlation proves causation.
- Do not mask the symptom with a workaround unless the trade-off is explicitly discussed.
- Stop and wait for approval before implementing the fix.
