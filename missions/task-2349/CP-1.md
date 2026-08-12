# CP-1: Deterministic race reproduction

Added a focused integration regression that stages the mission payload, interposes the board's bare `Reorder tasks in review` commit, and verifies that the board commit has no mission payload. Against the pre-fix implementation, the assertion is red because `git add -A` exposes `src/mission-payload.ts` to that interloper.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Intervening board commit cannot carry mission payload | `test/task-2349-integrate-stage-commit-race.test.ts`; `intervening bare board commit cannot contain the prepared mission payload`; `node --import tsx --experimental-test-module-mocks --test test/task-2349-integrate-stage-commit-race.test.ts` is red before the fix | Red reproduced |
| Unrelated dirty file is excluded from landed squash commit | `test/task-2349-integrate-stage-commit-race.test.ts` | Pending CP-2 |
| Already-landed payload is reported with carrying commit | `test/task-2349-integrate-stage-commit-race.test.ts` | Pending CP-3 |
| Absent payload still aborts with hook guidance | `test/task-2349-integrate-stage-commit-race.test.ts` | Pending CP-3 |
| Squash creation avoids unscoped staging plus bare commit | `src/adapters/cli/commands/integrate.ts` | Pending CP-2 |
| Durable workflow documentation matches behavior when applicable | `docs/` | Pending CP-4 review |
| Final verifier passes | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: replace the unscoped stage-and-bare-commit sequence with an explicit mission payload pathspec, then make the reproduction green.
