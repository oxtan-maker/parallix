# CP-2: Scoped squash payload commit

Replaced the stage-then-bare-commit sequence with a single `git commit --only -- <intended paths>` invocation. The intended paths are captured from the squash index and augmented with the closeout task paths, so unrelated checkout files are outside the landed commit. The CP-1 interleaving test is now green and also verifies that `notes/unrelated-dirty.md` is omitted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Intervening board commit cannot carry mission payload | `test/task-2349-integrate-stage-commit-race.test.ts`; `intervening bare board commit cannot contain the prepared mission payload`; `node --import tsx --experimental-test-module-mocks --test test/task-2349-integrate-stage-commit-race.test.ts` | Pass |
| Unrelated dirty file is excluded from landed squash commit | `test/task-2349-integrate-stage-commit-race.test.ts`; `intervening bare board commit cannot contain the prepared mission payload` | Pass |
| Already-landed payload is reported with carrying commit | `test/task-2349-integrate-stage-commit-race.test.ts` | Pending CP-3 |
| Absent payload still aborts with hook guidance | `test/task-2349-integrate-stage-commit-race.test.ts` | Pending CP-3 |
| Squash creation avoids unscoped staging plus bare commit | `src/adapters/cli/commands/integrate.ts`; `npx tsc --noEmit --pretty false` | Pass |
| Durable workflow documentation matches behavior when applicable | `docs/` | Pending CP-4 review |
| Final verifier passes | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: classify a failed squash commit by comparing HEAD to the complete intended payload, while retaining hook-failure abort guidance when the payload is absent.
