# CP-1: Baseline and classification

The initial `npm test` timing capture was run on 2026-07-17 in this worktree
on an otherwise idle local machine (Node v22.23.1; no credentials or live
services intentionally supplied). The command began after its `build:cjs`
pretest and was stopped after the default suite continued beyond the local
feedback budget. Its captured total elapsed time was at least 150 seconds
(about 60 seconds build plus more than 90 seconds test execution), so it is a
repeatable failing baseline rather than a completed total. The exact command
is `npm test`.

The captured over-one-second inventory is classified from the test source and
the run output. `test/active.test.js` includes a real worktree lookup whose
measured subtest duration was 6,861.555486 ms. `test/draft.test.js` contained
the two captured command-flow tests at 55,690.299667 ms and 55,930.833088 ms.
The latter group uses disposable workflow fixtures but crosses the draft
command boundary; both groups are integration coverage and are assigned to
`npm run test:integration`. The runner's dependency scan also assigns every
root test containing real process, Git/worktree, package, or local-network
markers to that command. The two existing E2E files remain assigned to their
named integration gates.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline records command, conditions, durations, and total | `npm test`; `missions/task-2275/CP-1.md` | PARTIAL — run exposed a >150s non-terminating default path |
| Every captured >1,000 ms test is inventoried and classified | `test/active.test.js`, `"resolveWorktree finds the expected path for the current mission"`, `test/draft.test.js`, `"runDraftCommand top-level flows are covered with injected dependencies"` | PASS |
| Boundary-dependent default coverage has a named later destination | `test/run-default-tests.js:43`, `npm run test:integration` | PASS |
| Moved groups will have exclusion/inclusion regression coverage | `test/default-test-suite.test.js` | IN PROGRESS |
| Retained default tests have no real process/repository/package/network/agent dependency | `test/run-default-tests.js:38` | IN PROGRESS |
| Final timing and remaining >1,000 ms justification are recorded | `npm test` | PENDING |
| General, static-analysis, and integration gates pass | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh integrate` | PENDING |

Next action: complete the selection regression test, run the default suite again, and classify any remaining over-one-second test by its exact test name and source dependency.
