# CP-1 — Red reproduction of the mainline gate mutation

## Summary

Added `test/task-2507-mainline-gate-mutation-repro.test.ts`, a red-to-green reproduction that runs the real
`routeIntegrationGateFailure` against a throwaway Git repository standing in for the base worktree. Only the
base-branch reproduction probe is injected (it would otherwise execute a real gate command); every seam that could
write to or commit in the base worktree runs unmocked, so the current `createMainlineGateTask` behaviour is exercised
for real.

The first test asserts a byte-level snapshot (sha256 per file outside `.git`) is unchanged, `git status --porcelain`
is empty, `HEAD` is unchanged, no `TASK-MAINGATE-*` file exists, no implementer launch/transition/rebound budget is
spent, and that the reported evidence names the failing gate command without a fabricated identifier. The second test
asserts the handler source constructs no `TASK-MAINGATE` identifier and renders no backlog Markdown.

The test crosses a real Git boundary, so it is registered in the GitHub-safe integration tier in
`test/lib/test-categories.ts` (`INTEGRATION_CI_TESTS`) with the reason recorded inline.

Observed at the mission parent commit (red), via `npx tsx --test test/task-2507-mainline-gate-mutation-repro.test.ts`:

- `AssertionError [ERR_ASSERTION]: no file in the base worktree is created, changed, or removed`
- `AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /TASK-MAINGATE/`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists at the mission-named path | `test/task-2507-mainline-gate-mutation-repro.test.ts` | PASS |
| Test proves the primary checkout is unchanged and git-status clean | `"TASK-2507: a gate failure reproduced in the primary checkout leaves the base worktree byte-for-byte unchanged and uncommitted"` (snapshot + `git status --porcelain` + `git rev-parse HEAD` assertions) | PASS |
| Test forbids fabricated backlog identifiers and hand-rendered Markdown | `"TASK-2507: the integration-failure handler constructs no TASK-MAINGATE identifier and renders no backlog Markdown"` | PASS |
| Test is red before the fix | `npx tsx --test test/task-2507-mainline-gate-mutation-repro.test.ts` at the mission parent commit fails both tests with the assertions quoted above | PASS |
| New Git-boundary test is explicitly classified | `test/lib/test-categories.ts` `INTEGRATION_CI_TESTS`, enforced by `test/test-categories.test.ts` | PASS |

Next action: CP-2 — delete `createMainlineGateTask`/`mainlineGateTaskId` from `src/adapters/cli/commands/integrate-gate-rebound.ts`, make the mainline route report gate evidence and stop, and update `test/task-2492-integration-gate-rebound.test.ts` accordingly until both CP-1 tests are green.
