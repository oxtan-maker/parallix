# CP-1: Dirty commit failure reproduction

Added the task-2220 regression test with an injected Git runner that rejects the commit and reports `review-state.json` as modified. The test confirms the state file is written, but requires the persistence API to return `commit-failed-dirty` instead of the current boolean `true`. Running the repository test command produced the expected task-2220 assertion failure (`actual: true`) against the pre-fix implementation. The same run also exposed two unrelated baseline failures in `refresh-global-px-script.test.js` and `task-1039-integrate-v3.test.js`; neither overlaps this mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression injects a failed commit and dirty path-scoped status | `test/task-2220-repro.test.js:16`, `test/task-2220-repro.test.js:20` | PASS |
| Regression rejects the old success result and expects `commit-failed-dirty` | `test/task-2220-repro.test.js:34`, "writeReviewState does not report success when commit fails and state path remains dirty" | PASS |
| Regression verifies the dirty state file exists after the failed commit | `test/task-2220-repro.test.js:39` | PASS |
| Pre-fix behavior is captured as red | `npm test -- test/task-2220-repro.test.js`, "writeReviewState does not report success when commit fails and state path remains dirty" | PASS |

Next action: Implement the five-variant persistence result and atomic write in `lib/review/review-state.ts`, then rerun the task-2220 reproduction until it turns green before beginning caller migration.
