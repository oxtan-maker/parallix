# Mission: Exclude timing enforcement from GitHub test runs (task-2542)

## Goal
Stop GitHub CI from running timing-based unit-test enforcement while retaining the normal non-timing test suite and local timing diagnostics.

## Why Now
GitHub CI currently reaches the unit-test timeout guard and budget reporter, where a fixture fails for an unrelated module-resolution reason instead of reporting the expected budget result. This repeatedly blocks workflow verification without demonstrating a product regression.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: GitHub-only execution of `test/unit-test-timeout-guard.test.ts`, the `test/lib/unit-test-budget-reporter.ts` timing reporter, and the CI test-run selection that includes them

## Scope
- Identify every timing-based test or runtime check selected by the GitHub CI test command, including `test/unit-test-timeout-guard.test.ts` and use of `test/lib/unit-test-budget-reporter.ts`.
- Change GitHub CI test selection so those timing-based checks are not executed there.
- Preserve a supported local path for timing-budget enforcement and its tests.
- Add a regression test proving the GitHub run plan excludes the timing checks while the local/headroom path still selects them.

## Out of Scope
- Changing production agent-launcher module resolution or repairing the missing `src/adapters/agents/launcher-selection.js` fixture dependency.
- Removing timing enforcement from local development or from commands explicitly intended to diagnose unit-test headroom.
- Changing unrelated CI jobs, release workflows, test time limits, or GitHub runner configuration.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The regression test at `test/task-2542-repro.test.ts` fails on the mission parent commit because the GitHub test run plan includes timing enforcement, then passes after the change because that plan excludes `test/unit-test-timeout-guard.test.ts` and the unit-test budget reporter.
- The GitHub CI test command continues to select the ordinary unit-test suite but does not execute a timing-based test or runtime timing reporter.
- `npm test -- --unit-test-headroom` continues to select and enforce the timing-budget path locally.
- `./scripts/verify-local.sh all` exits zero on the final tree.

## Risks and Assumptions
- Assumption: GitHub-specific selection can be changed without weakening the default local `npm test` timeout cap or the explicit `--unit-test-headroom` authoring check.
- Risk: a broad exclusion could silently omit non-timing tests; mitigate with an assertion over the resolved GitHub and headroom test-run plans.
- Risk: GitHub environment detection may be shared by other workflows; inspect all callers before changing its behavior.

## Checkpoints
- CP 1: Add `test/task-2542-repro.test.ts` before any fix. Reproduce the GitHub run-plan scenario and assert that it currently includes `test/unit-test-timeout-guard.test.ts` or its budget reporter; the assertion must fail at the mission parent commit (red) and pass when GitHub selection excludes timing enforcement (green).
- CP 2: Trace all callers of the GitHub/test-run-plan selection, then make the smallest selection change that excludes only timing checks from GitHub while retaining the explicit local headroom path.
- CP 3: Verify the regression test covers GitHub exclusion and local headroom inclusion, then record final goal-check evidence.

Reproduction-Test: test/task-2542-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Every checkpoint document MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |` with one evidence row per success criterion.
- Evidence for the red/green regression in `test/task-2542-repro.test.ts`, the preserved headroom path via `npm test -- --unit-test-headroom`, and final verification via `./scripts/verify-local.sh all`.
- A non-generic `Next action:` line at the bottom.

Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted command, test name, test path, or ADR reference above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| GitHub plan excludes timing enforcement | `test/task-2542-repro.test.ts` | PASS |
| Local headroom enforcement remains selected | `npm test -- --unit-test-headroom` | PASS |
| Final verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify GitHub runner images, workflow permissions, release jobs, or production agent-launcher behavior to address this test-selection failure.
- Do not remove the local unit-test headroom capability or weaken non-timing unit-test coverage.
- Keep changes limited to CI/test-run selection, its focused tests, and required mission evidence.

## Stop Rules
- Stop and request direction if excluding timing checks from GitHub requires removing the local `npm test -- --unit-test-headroom` enforcement path.
- Stop and request direction if the only feasible fix changes GitHub workflow permissions, runner images, or production launcher resolution.
- Stop and request direction if tracing callers shows timing enforcement is required by a documented GitHub release or security gate.
