# Mission: Bisect and fix test-suite speed regression over the last two weeks (task-1432)

## Goal
Identify and fix the root cause(s) of the npm test suite speed regression that occurred between approximately 2026-06-21 and 2026-07-05, reducing a solo uncontended `npm test` run from 10+ minutes to a duration commensurate with the actual test computational cost (~60-90 seconds as evidenced by summed individual file timings).

## Why Now
A solo `npm test` run currently takes 20-30+ minutes on an idle system with zero contention, which is a 20-30x slowdown compared to the ~59 seconds total when running 130 test files individually. This compounding slowdown (later files in the single shared process take much longer than earlier ones) strongly suggests a resource leak (uncleared intervals, unbounded listener growth, or retained mock state) that accumulates across files loaded into one process via `test/run-default-tests.js`. Two known fixes (flock serialization in `scripts/verify-local.sh` and removal of per-call `npm run build:cjs` from `test/e2e-mission-lifecycle.test.js`) have already been applied to main but the regression persists, indicating additional unknown causes must be identified and fixed.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Test infrastructure reliability, developer productivity

## Scope
- Git-bisect or systematic commit-by-commit walk of the history between 2026-06-21 and 2026-07-05
- Timing measurements at each candidate commit using `time npm test` or per-file subset timing
- Investigation of `test/run-default-tests.js`, `test/bootstrap-parallix-home.js`, `package.json` test scripts, and any shared test bootstrap/helper files
- Identification of compounding-per-file behavior (time first 10 files vs last 10 files in single process)
- Fixes for identified regressions without removing legitimate test coverage

## Out of Scope
- Re-implementing the already-fixed flock serialization in `scripts/verify-local.sh` (commit 56904105)
- Re-removing the per-call `npm run build:cjs` from `test/e2e-mission-lifecycle.test.js` (commit 1f228850)
- Removing test coverage to artificially improve speed
- Addressing environmental/CPU-contention issues unrelated to code changes
- Investigating commits outside the 2026-06-21 to 2026-07-05 window

## Success Criteria
- A systematic commit-by-commit bisect is performed over test-affecting commits from 2026-06-21 to 2026-07-05, with timing measurements recorded at each candidate commit using wall-clock time
- Every commit found to measurably increase `npm test` wall-clock time beyond what is explained by legitimately added test coverage is identified by SHA with before/after timing comparison evidence in seconds
- Each identified regression is fixed without removing legitimate test coverage, with the fix verified by timing measurements
- A solo uncontended `npm test` run completes in <= 120 seconds on the final tree, with before-and-after total suite time documented
- The two already-applied fixes (flock serialization and build:cjs removal) are explicitly ruled out as causes before investigating other commits
- Per-file timing evidence is captured showing first 10 files vs last 10 files timing within a single `node --test test/run-default-tests.js` process to confirm compounding leak behavior is resolved

## Risks and Assumptions
- Risk: Resource leak may be in `test/bootstrap-parallix-home.js` temp directory cleanup or event listener registration
- Risk: Bisect may be noisy due to system load; will use solo uncontended runs with load average < 3.0
- Risk: Some commits may be merge commits requiring careful cherry-pick or checkout
- Assumption: The regression is reproducible on a standard development workstation
- Assumption: The compounding-per-file behavior indicates a leak in shared process state, not test content growth
- Assumption: Node.js process event loop or GC pressure is the primary mechanism for the slowdown

## Checkpoints
- CP 1: Author a failing reproduction test that locks the bug by running `test/run-default-tests.js` in a single process and asserting that the total wall-clock time exceeds 120 seconds, with per-file timing showing compounding behavior (later files take >= 2x longer than earlier ones of similar size). Test file: `test/task-1432-repro.test.js`
- CP 2: Perform git bisect over 2026-06-21 to 2026-07-05, recording timing at each candidate commit and identifying all commits that added >= 5 seconds to total suite time unexplained by added test count
- CP 3: For each identified regression commit, isolate the specific change that caused the slowdown with targeted timing tests
- CP 4: Implement fixes for all identified regressions and verify each fix reduces timing by the expected amount
- CP 5: Run final verification showing complete suite executes in <= 120 seconds solo uncontended

Reproduction-Test: test/task-1432-repro.test.js

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `scripts/verify-local.sh` flock serialization logic (already fixed in commit 56904105)
- Do not modify `test/e2e-mission-lifecycle.test.js` to remove `npm run build:cjs` (already fixed in commit 1f228850)
- Do not delete or skip legitimate test files to reduce suite time
- Do not change the test runner from `node --test` to another framework

## Stop Rules
- Stop if any checkpoint cannot produce timing measurements within 10% variance across 3 consecutive runs at the same commit
- Stop if the bisect identifies > 5 regression commits in the window, escalate to re-prioritize
- Stop if a fix requires changes to > 10 files, escalate for design review
- Stop if per-file timing shows no compounding behavior (later files not slower than earlier ones), re-evaluate the leak hypothesis
