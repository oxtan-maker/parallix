# CP-4 — Mission gate green, handoff evidence

## Summary

Ran the mission-declared gate `` `./scripts/verify-local.sh all` `` on the final tree
(fix commit `d0c6a9dc0` + regression `eab9272d4`): **exit 0 — `tests 2160, pass 2160, fail 0`,
suite elapsed 17.2 s (budget 180 s)**, verify-docs included. Both regressions are green inside
the full suite (`task-2353 repro: ...` at suite log line 2526, `task-2415 repro: ...` at line 2842).

Note on evidence: a first gate attempt under heavy machine contention (load average 12+)
reported per-test budget overruns in unrelated suites (TUI layout, integrate preflight);
the rerun on the settled machine passed cleanly with zero `[unit-test-budget:exceeded]`
lines, confirming the overruns were environmental, not caused by this mission's one-line
branch fix plus one hermetic test.

The fix is the single guarded branch in the `state.phase === 'reviewing'` pre-review rebase
failure block of `src/adapters/review/review-loop.ts`: the catch-all
`else { exit(1); return; }` paired with `if (rebaseResult.hookFailure)` is now
`else if (!preReviewSetupVerified) { exit(1); return; }`. Hook-failure recovery, the
stranded/unrepaired exits, the per-round relaunch cap, and the declared-gate short-circuit
are all preserved (SC table below). Backlog task file untouched; no restricted file modified.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: regression at `test/task-2415-pre-review-gate-repair-continues.test.ts` is red at the parent and green after the fix | Red at parent `92092ce69` via `` `npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` ``: `fail 1`, `Error: unexpected exit` from `src/adapters/review/review-loop.ts:630`; green after fix commit `d0c6a9dc0`: `pass 1, fail 0` | PASS |
| SC2: repaired gate-only path never calls exit(1) and launches the reviewer exactly once in the same round with the continuation log | Test `"task-2415 repro: repaired pre-review gate continues the review round instead of exiting"` asserts `reviewerLaunches === 1`, `continuing this review round.` logged before `launching reviewer`; green in focused run and in `./scripts/verify-local.sh all` (suite log line 2842) | PASS |
| SC3: verified repair does not re-run the declared pre-review gate before reviewer launch | `test/task-2415-pre-review-gate-repair-continues.test.ts`, test `"task-2415 repro: repaired pre-review gate continues the review round instead of exiting"` asserts `gateRuns === 2` and `rebaseRuns === 3`; the `if (!dryRun && !preReviewSetupVerified)` block in `src/adapters/review/review-loop.ts` is skipped because the gate branch sets `preReviewSetupVerified = true` | PASS |
| SC4: hook-failure recovery path unchanged (bounce, re-verify, continue; unrepaired hook still exits) | Fix commit `d0c6a9dc0` leaves the `if (rebaseResult.hookFailure)` branch byte-identical; runtime proof in the green full suite: `"startReviewLoop rebounces a pre-review safety-commit hook failure before gate or reviewer launch"`, `"SC2 S1: hook failure bounces through the kernel and lands when the re-run commit passes"`, `"genuine hook failure during the pre-review rebase reports hook identity and output"` (`test/task-2377-02-pre-review-rebase-inprocess.test.ts`, `test/review.test.ts`) | PASS |
| SC5: unrepaired gate failures keep the stranded stop behavior | `"review loop rebounces a pre-review rebase gate failure as a gate failure, not a hook bounce"` (`test/task-2377-02-pre-review-rebase-inprocess.test.ts`, asserts `exits` `[1]` for a stranded gate bounce) and `"task-2377.04: a round reaching the per-round relaunch cap stops with the cap diagnostic and exactly the capped number of bounce launches (SC4)"` — both green in `./scripts/verify-local.sh all` | PASS |
| SC6: task-2353 gate-bounce regression stays green incl. `reviewerLaunches === 1` | `test/task-2353-rebounce-reproduction.test.ts`, `"task-2353 repro: declared pre-review gate rebounces, replays, and resumes the review loop"`: green focused (`pass 2, fail 0`) and in the full suite (suite log line 2526) | PASS |
| SC7: `./scripts/verify-local.sh all` passes on the final execution tree | Exit 0; `tests 2160 / pass 2160 / fail 0 / skipped 0`, suite elapsed 17 218 ms < 180 000 ms budget, zero `[unit-test-budget:exceeded]` lines; verify-docs (`node scripts/verify-docs.mjs`) included in the same gate | PASS |

## Gates

- [x] `./scripts/verify-local.sh all` — exit 0 on the final tree (2160/2160 pass).

## Next action

Handoff-ready for the Parallix lifecycle: all four checkpoints committed on
`mission/task-2415` (`eab9272d4` red test → `d0c6a9dc0` fix → `8cfa3efe8` CP-3 → this commit),
the mission gate is green, and the backlog task file is preserved for Parallix to transition.
