# CP 1 — Failing reproduction test for task-2419

## Summary
Authored `test/task-2419-status-pr-branch-repro.test.ts`, a hermetic mocked-port
test that builds a `StatusCommandUseCase` with `mockGit.getCurrentBranch()`
returning `mission/task-2402` (a different mission than the requested slug) and a
`mockPr` that records the branch passed to `getPrInfo` and returns
`{ exists: true, number: 339, state: 'open' }`. It calls
`execute('/tmp/repo', 'task-2419')` and asserts the recorded branch equals
`mission/task-2419` (the requested mission's branch via the default
`mission/` prefix).

The test is RED at the mission's parent commit: it records `mission/task-2402`
(the current branch) instead of `mission/task-2419`. This locks the bug before
any fix. The fix was not authored in this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists and is red pre-fix | `test/task-2419-status-pr-branch-repro.test.ts` — `node --test --import tsx test/task-2419-status-pr-branch-repro.test.ts` reports `fail 1`; assertion `'mission/task-2402' !== 'mission/task-2419'` | PASS (red, as required) |
| Test is hermetic (no network/git boundary) | Uses mocked `StatusGitPort`/`StatusPrPort`/`StatusBoardPort`; runs in fast default suite (excluded only the two E2E files per `test/lib/test-run-plan.ts`) | PASS |
| SC4 test shape present | Test named `"StatusCommandUseCase: PR lookup uses the requested mission branch, not the current branch"` asserts PR lookup uses requested mission branch | PASS |

## Next action
Apply the fix in `src/application/status-command-use-case.ts` so `prInfo` is
looked up via `missionBranchName(resolvedSlug, rootDir)`; then confirm the
reproduction test turns green (CP 2).
