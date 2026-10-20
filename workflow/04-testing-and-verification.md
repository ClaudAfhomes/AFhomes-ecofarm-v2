# TEST & VERIFY — Verify a Change

## Recommended agent/mode
Use the available **Build** agent/mode to run and fix in-scope checks, or a separate verification agent if configured.

## Change under verification

[Describe the change and/or identify the relevant diff or commit.]

## Prompt

Verify the implementation using the repository's actual test and tooling setup.

### Steps

1. Inspect the current Git status and diff before running checks.
2. Read applicable `AGENTS.md` instructions and identify the project's existing scripts and test conventions.
3. Map the changed behavior to relevant unit, integration, end-to-end, API, or regression tests, as applicable.
4. Run the narrowest relevant tests first, then broader checks when practical:
   - targeted tests
   - related test suite
   - lint and formatting checks
   - type checks
   - build checks
5. Review test output and investigate failures rather than assuming their cause.
6. If a test is missing, recommend a test that would meaningfully verify the behavior.
7. Inspect the diff for accidental changes, debug code, leaked secrets, weakened assertions, and unrelated edits.

### Rules

- Do not install dependencies or change project configuration just to get a green result without approval.
- Do not alter production data or run destructive commands.
- Do not remove, skip, or weaken tests to conceal a failure.
- Do not claim a check passed unless it actually completed successfully.
- Clearly distinguish passed, failed, blocked, and not-run checks.
- Do not make unrelated fixes. Ask before expanding scope materially.

### Report

Provide a table with the check, exact command, result, and notes. Include:
- What was verified.
- What failed and the evidence.
- What was not verified and why.
- Any test gaps or residual risks.
- Whether the evidence supports considering the change ready for review.
