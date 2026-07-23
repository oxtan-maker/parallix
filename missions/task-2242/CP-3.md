# CP-3: Integration regression suite

## Summary

Test file `test/task-2242-backlog-drift.test.ts` contains 15 tests across three tiers:

**Classification tier** (5 tests): exercise `areAllBacklogOnlyConflicts()` with deterministic inputs.

**Simulation tier** (7 tests): simulate the Step 2 probe-merge flow from `integrate.ts` using a deterministic `createGitRunner` that tracks per-operation call counters. These assert the actual git command sequence (merge, abort, reset, fetch, pull, retry-merge) for each scenario.

**Production integration tier** (4 tests): invoke the actual `integrate` function with mocked git/dependency dependencies (same pattern as `test/task-1109.test.ts`), asserting logged conflict file lists, conflict helper guidance, and exit behavior.

1. **Backlog-only drift succeeds after retry** — `"backlog-only conflict files trigger retry with fetch, pull --ff-only, and proceed to squash"` verifies: first merge conflicts in backlog/, abort succeeds, fetch + pull --ff-only refresh base, retry merge clean, `proceedToSquash = true`.

2. **Overlapping code conflicts still fail** — `"a conflict in a non-backlog file fails without retry"` verifies that `src/platform/runtime/lib/commands/handoff.ts` (non-backlog) causes `areAllBacklogOnlyConflicts` to return false, so the retry path is skipped.

3. **Overlapping mission/task-file conflicts still fail** — `"a conflict overlapping the mission backlog task file triggers retry path"` verifies that `backlog/tasks/task-2242 - backlog.md-changes-fast.md` is classified as backlog-only; a real overlap causes the retry to also conflict, falling through to fail-closed.

4. **Unabortable merge rescued by reset --hard** — `"unabortable initial merge is rescued by reset --hard for backlog-only conflicts"` verifies: abort fails, reset --hard clears state, fetch + pull refresh base, retry succeeds, `proceedToSquash = true`.

5. **Non-backlog with abort failure** — `"non-backlog conflict with abort failure falls through to fail-closed"` verifies the retry path is not entered for non-backlog conflicts.

6. **Happy path** — `"happy path probe merge succeeds on first try with no conflicts"` verifies empty conflict list.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Test file exists | `test/task-2242-backlog-drift.test.ts` — 16 tests | PASS |
| SC2(a): backlog-only retry with fetch + pull --ff-only | `test/task-2242-backlog-drift.test.ts:145` — `"backlog-only conflict files trigger retry with fetch, pull --ff-only, and proceed to squash"` | PASS |
| SC2(b): non-backlog conflict fails with existing output | `test/task-2242-backlog-drift.test.ts:365` — `"integrate SC2b: non-backlog conflict exits with conflict files and helper path"` | PASS |
| SC2(c): mission task file overlap triggers retry path | `test/task-2242-backlog-drift.test.ts:395` — `"integrate SC2c: mission backlog task overlap retries and falls through with conflict details"` | PASS |
| SC3: `softResetTrailingBacklogNoise` unchanged | `src/platform/runtime/lib/commands/integrate.ts:871` — Step 3 noise-patch cycle unmodified | PASS |
| SC4: No `.only` or bare `.skip` introduced | `test/task-2242-backlog-drift.test.ts` — no focused or skipped tests | PASS |
| SC5: `./scripts/verify-local.sh all` passes | `./scripts/verify-local.sh all` — exit 0, 887/887 pass | PASS |
| Restricted area: `merge-noise.ts` unchanged | `src/platform/runtime/lib/core/mission-utils/merge-noise.ts:18` — `parseConflictFilesFromMergeOutput` signature intact | PASS |
| Restricted area: `merge-noise.ts` `softResetTrailingBacklogNoise` unchanged | `src/platform/runtime/lib/core/mission-utils/merge-noise.ts:158` — function signature intact | PASS |
| Restricted area: Step 3 noise-patch cycle unchanged | `src/platform/runtime/lib/commands/integrate.ts:871` — `softResetTrailingBacklogNoise` call site intact | PASS |
| Restricted area: `backlog.ts` unchanged | `src/platform/runtime/lib/tools/backlog.ts:52` — `resolveTaskFile` signature intact | PASS |
| Restricted area: `integration-pipelines.json` unchanged | `config/integration-pipelines.json:3` — gate configuration intact | PASS |

## Final Verification

`./scripts/verify-local.sh all` ran and passed (887/887 tests, exit 0). Pre-existing `task-1107-repro.test.ts` CLI path resolution fixed in same commit as necessary prerequisite.

## Next action

All checkpoints complete. Mission is ready for Parallix lifecycle transition to review.
