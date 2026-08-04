# CP-3: Mission gate verification

## Summary

Ran the mission-declared gate `./scripts/verify-local.sh all` on the committed tree. Result:
exit code 0, `tests 1705 / pass 1705 / fail 0 / skipped 0 / todo 0`. Both CP-1 reproduction tests
run inside that suite and pass.

One pre-existing failure had to be cleared first. The gate's first run reported
`"SC3: every consumer citation points at a line containing its anchor"` red with two stale
citations into `src/adapters/review/review-commands.ts` (recorded lines 1089 and 515). That failure
reproduced identically on the mission's parent commit `8b8ba3c84` and on current `main`
(`7aed837ba`), so it was not introduced here. It was repaired the only way that does not touch
behaviour: the two recorded line numbers in `src/application/consumer-domain-requirements.ts` were
moved to where the unchanged anchors now live (`state.reviewerRetryCount` at
`src/adapters/review/review-commands.ts:1093`, `findCheckpointsFn(missionDir)` at
`src/adapters/review/review-commands.ts:520`). No anchor text, requirement text, or production code
was altered. This is called out explicitly because a mission commit repairing baseline red deserves
reviewer attention.

Note on the gate log: two `[FAIL] [coverage-gate] ...` lines appear at `/tmp/verify-2339.log:298-299`.
They are the expected stdout of the coverage-gate's own error-path tests
(`"runTests returns 1 when spawn fails with error"`, `"runTests returns 1 when child process is
killed by signal"`), not gate failures — the surrounding assertions pass and the run exits 0.

Restricted areas were respected: `src/application/mission-lifecycle-service.ts`,
`src/adapters/sqlite/board-lane-event-repository.ts`, and
`src/application/ports/operation-history.ts` are all absent from the mission diff
(`git diff --name-only 8b8ba3c84..HEAD`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `submit-for-review` is an idempotent no-op when the mission is already `review` | `src/domain/mission-workflow.ts:75` (`requireStatus(mission, ['active', 'review'], command)`), `src/domain/mission-workflow.ts:82` (`return mission;`); `"retrying submit-for-review on a review mission is an idempotent no-op"` passes | PASS |
| SC2: handoff idempotency key is `handoff-${slug}` with no `Date.now()` | `src/adapters/cli/commands/handoff.ts:740` | PASS |
| SC3: integrate idempotency key is `integrate-${context.slug}` with no `Date.now()` | `src/adapters/cli/commands/integrate.ts:1301` | PASS |
| SC4: reproduction test red before the fix, green after | `test/task-2339-submit-for-review-idempotent.test.ts` — at commit `4b8e6feb5` `"retrying submit-for-review on a review mission is an idempotent no-op"` threw `Cannot submit-for-review while task-2339 is review; expected active`; on this tree both tests pass under `` `./scripts/verify-local.sh all` `` | PASS |
| SC5: verification gate passes clean on the final tree | `` `./scripts/verify-local.sh all` `` — exit 0, `tests 1705 / pass 1705 / fail 0` | PASS |
| SC6: no `.only` and no bare `.skip` introduced | `test/task-2339-submit-for-review-idempotent.test.ts` uses only bare `test(...)`; gate reports `skipped 0` / `todo 0` | PASS |
| No-op cannot rewrite an in-flight review round | `"submit-for-review retry does not advance the recorded review conversation"` in `test/task-2339-submit-for-review-idempotent.test.ts:84` | PASS |
| Stop rule "no duplicate lane event from the no-op" holds | `src/application/mission-lifecycle-service.ts:126` returns `null` when `decided.status === from`; file unmodified | PASS |
| DoD #2: lint and static analysis clean on changed files | `npx tsc --noEmit` and `npx eslint src/domain/mission-workflow.ts src/adapters/cli/commands/handoff.ts src/adapters/cli/commands/integrate.ts src/application/consumer-domain-requirements.ts test/task-2339-submit-for-review-idempotent.test.ts` — both silent; the gate's own lint stage is part of the exit-0 run | PASS |
| DoD #5: docs updated for the behaviour change | `src/domain/README.md:105` documents the idempotent replay in the mission-rules state machine | PASS |
| Baseline-red repair is disclosed, not silent | `src/application/consumer-domain-requirements.ts:199` and `src/application/consumer-domain-requirements.ts:321` (line numbers only); `"SC3: every consumer citation points at a line containing its anchor"` in `test/domain-consumer-requirements.test.ts` was red on `main` before this branch | PASS |

Next action: hand the mission off for review with the reproduction test
`test/task-2339-submit-for-review-idempotent.test.ts` and the disclosed
`consumer-domain-requirements.ts` citation refresh flagged for the reviewer, since that hunk repairs
pre-existing `main` red rather than mission scope.
