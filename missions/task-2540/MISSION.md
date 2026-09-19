# Mission: Skip timing-budget tests on GitHub Actions (task-2540)

## Goal
Make the three unit tests that assert unit-test-budget reporter marker output skip when the suite runs on GitHub Actions, so GitHub-hosted CI is no longer red from timing-budget signals that GitHub Actions intentionally disables. The skip reuses the existing `onGitHubActions()` guard in `test/lib/unit-test-budget-reporter.js` — the single source of truth established by task-2531.

## Why Now
On GitHub Actions, `process.env.GITHUB_ACTIONS === 'true'`, so `onGitHubActions()` returns true and the budget reporter suppresses its `[unit-test-budget:exceeded]` / `[unit-test-budget:headroom]` markers (by design — runner speed is uncontrollable). Three tests assert those exact markers and therefore fail on every GitHub run:

- `test/task-2423-repro.test.ts` — `"TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap"`
- `test/unit-test-budget-reporter.test.ts` — `"unit-test budget reporter marks measured synchronous work over the bound"`
- `test/unit-test-budget-reporter.test.ts` — `"unit-test budget reporter reports opted-in headroom without changing the hard cap"`

The reporter already disables the budget on GitHub; the tests do not account for that. These tests measure reporter behavior that GitHub Actions deliberately turns off, so they must not run there.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: GitHub CI red on timing-budget tests; fix is a test-skip guard, not a product change.

## Scope
- `test/task-2423-repro.test.ts`: the test `"TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap"` must skip when `onGitHubActions()` is true. Its sibling test in the same file (`"TASK-2423: headroom mode requests a 500ms timeout without changing the default plan"`) tests `buildTestRunPlan`, asserts no budget marker, and keeps running everywhere.
- `test/unit-test-budget-reporter.test.ts`: the two tests that assert budget-marker output — `"unit-test budget reporter marks measured synchronous work over the bound"` and `"unit-test budget reporter reports opted-in headroom without changing the hard cap"` — must skip when `onGitHubActions()` is true.
- Reuse `onGitHubActions()` imported from `./lib/unit-test-budget-reporter.js` for the skip condition. Do not duplicate or reimplement the GitHub detection.
- Preserve the two GitHub-behavior tests in `test/unit-test-budget-reporter.test.ts` — `"unit-test budget reporter stays silent on GitHub Actions runners"` and `"GitHub Actions detection keys on the exact env value, not any GitHub-ish value"` — they stay running everywhere because they assert the gating mechanism itself. The suite-source test `"the suite-level budget check is gated on the shared GitHub Actions detection"` also stays.

## Out of Scope
- Any change to `test/lib/unit-test-budget-reporter.js` behavior, thresholds (`UNIT_TEST_BUDGET_MS`, `UNIT_TEST_HEADROOM_MS`), or the `onGitHubActions()` implementation.
- Any change to `test/run-default-tests.ts` or the suite-level budget block.
- Any product / source code change under `src/`.
- Other timing-sensitive tests not in the failing list above.
- Test-category reclassification in `test/lib/test-categories.ts` — the affected tests remain unit tests (implicit membership).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable via a named test, file, or command.

- The three named budget-marker tests skip (not fail) when `GITHUB_ACTIONS=true`. Falsified if any of them reports `✖` or `fail` under `GITHUB_ACTIONS=true`.
- The same three named tests still pass when `GITHUB_ACTIONS` is unset. Falsified if any reports `✖` or `fail` in a clean environment.
- The two GitHub-behavior tests and the suite-source test in `test/unit-test-budget-reporter.test.ts` still run and pass under both `GITHUB_ACTIONS=true` and unset. Falsified if any is skipped or fails.
- No second copy of the GitHub detection exists: `grep -rn "process.env.GITHUB_ACTIONS === 'true'" test/` returns exactly one match (the definition in `test/lib/unit-test-budget-reporter.js`). Falsified by a second match.
- No `.only` and no bare `.skip(` literal is introduced in either test file. Falsified by `rg -n "\.only\(|\.skip\(" test/task-2423-repro.test.ts test/unit-test-budget-reporter.test.ts`.
- `./scripts/verify-local.sh all` exits 0 on the final tree. Falsified by a non-zero exit.

## Risks and Assumptions
- The skip must be conditional, not unconditional — an unconditional `.skip` would hide regressions off GitHub. Assumption: implementer uses a condition on `onGitHubActions()`.
- The budget-marker tests set `PARALLIX_UNIT_TEST_HEADROOM='1'` but do not unset `GITHUB_ACTIONS`. On GitHub CI the variable is globally set, which is why they fail. Assumption: guarding on `onGitHubActions()` at the top of each test is sufficient; no need to manipulate `GITHUB_ACTIONS` inside the test.
- `test.skip` must be bound correctly (call `test.skip(name, fn)`, not a detached reference that loses `this`). Verified against node:test's `test.skip` method.
- The reporter generator must still forward events on GitHub; this mission does not touch that, but the skip must not alter reporter behavior.

## Checkpoints
- CP 1: Add a conditional skip to the three budget-marker tests, gated on the existing `onGitHubActions()`, reusing the import already present in both files.
- CP 2: Verify off-GitHub the three tests still pass and on-GitHub they skip; verify the two GitHub-behavior tests and the suite-source test still run.
- CP 3: Run the verification gate and confirm a clean pass.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `GITHUB_ACTIONS=true node --import tsx test/unit-test-budget-reporter.test.ts`, `./scripts/verify-local.sh all`, `` `node --import tsx test/task-2423-repro.test.ts` ``
  2. **Test names** — must match a test name in the repo, e.g. `"unit-test budget reporter marks measured synchronous work over the bound"`, `"TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap"`, `"unit-test budget reporter stays silent on GitHub Actions runners"`
  3. **Test file paths** — e.g., `test/unit-test-budget-reporter.test.ts`, `test/task-2423-repro.test.ts` (must be existing test files)
  4. **ADR references** — e.g., `ADR 0057` (verification tiers), `ADR 0041` (integration pipeline gates) — must correspond to an existing file under `docs/adr/`
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Weak-agent failure mode: raw `stat`/`ls` output or generic prose ("the tests now skip on GitHub") is NOT sufficient evidence. Pair any shell output with at least one accepted reference above — e.g. paste the `node --test` skipped/ok lines AND cite the test file path and exact test name, or cite the `GITHUB_ACTIONS=true node --import tsx ...` command. A claim with no test name, file path, ADR, or runnable command will be rejected.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Budget-marker tests skip on GitHub Actions | `test/unit-test-budget-reporter.test.ts`, `"unit-test budget reporter marks measured synchronous work over the bound"`, `GITHUB_ACTIONS=true node --import tsx test/unit-test-budget-reporter.test.ts` reports skipped | PASS |
| Budget-marker tests still pass off GitHub | `test/task-2423-repro.test.ts`, `"TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap"`, `node --import tsx test/task-2423-repro.test.ts` | PASS |
| GitHub-behavior tests still run | `test/unit-test-budget-reporter.test.ts`, `"unit-test budget reporter stays silent on GitHub Actions runners"` | PASS |
| No duplicated GitHub detection | `grep -rn "process.env.GITHUB_ACTIONS === 'true'" test/` → one match in `test/lib/unit-test-budget-reporter.js` | PASS |
| No .only / bare .skip | `rg -n "\.only\(|\.skip\(" test/task-2423-repro.test.ts test/unit-test-budget-reporter.test.ts` | PASS |
| Verification gate clean | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] GITHUB_ACTIONS=true node --import tsx test/unit-test-budget-reporter.test.ts
- [ ] node --import tsx test/task-2423-repro.test.ts

## Restricted Areas
- `src/` — no production code changes.
- `test/lib/unit-test-budget-reporter.js` — do not modify the reporter or `onGitHubActions()`.
- `test/run-default-tests.ts` — do not modify the suite runner or suite-level budget block.
- `test/lib/test-categories.ts` — do not reclassify the affected tests; they stay unit tests.
- Any test file other than `test/task-2423-repro.test.ts` and `test/unit-test-budget-reporter.test.ts`.

## Stop Rules
- Stop before changing any file outside the two in-scope test files.
- Stop before adding new budget thresholds, new tests, or new infrastructure.
- Stop if the skip needs to be unconditional — reconsider the approach rather than shipping an unconditional `.skip`.
- Stop and report if `onGitHubActions()` cannot be imported into `test/task-2423-repro.test.ts` (it is already exported from `test/lib/unit-test-budget-reporter.js`).
