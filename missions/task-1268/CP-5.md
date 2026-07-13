# CP-5: Review-round hardening and final Goal Check

## Summary

The review findings are resolved in the mission implementation. A mixed-area
diff now selects `all`, so an alphabetical `docs` path cannot weaken a diff
that also changes `lib`. The auto-bounce behavior intentionally stops the
current invocation after sending work to the implementer; its prompt now
states that restarting review re-runs the gate. This checkpoint restores the
mission record and records the final evidence.

## Goal Check

| Criterion | Evidence |
|---|---|
| SC1: gate before every review round | `lib/review/review-loop.ts` runs `runPreReviewGateFn` outside the first-launch branch; `test/task-1268-pre-review-gate-per-round.test.js` asserts one gate call for each of two reviewer rounds. |
| SC2: strict diff-scoped area | `lib/core/verification.ts:detectMissionChangedArea` returns the sole detected area and returns `all` for more than one area; `test/task-1268-diff-scoped-area.test.js` covers `lib`, `docs` + `lib`, and the `runPreReviewGate` resolver-to-command path. |
| SC3: failed gate bounces without reviewer work | `lib/review/review-loop.ts` returns after a successful auto-bounce; `test/task-1268-pre-review-gate-per-round.test.js` asserts no reviewer launch for that loop-level path. |
| SC4: no checkpoint bypass | `lib/commands/checkpoint.ts` has no `--no-gate` path; `test/task-1268-checkpoint-no-gate.test.js` verifies a stray flag cannot skip a failing gate. |
| Static analysis | `./scripts/verify-local.sh static-analysis` is run for this handoff. |
| Fast verification | `./scripts/verify-local.sh all` is run for this handoff; any unchanged baseline failure is recorded in the resolution artifact. |

## Deferred follow-up

Other lifecycle gates still use the legacy mission-area fallback. Centralizing
the area mapping and applying diff scoping to reviewer verification,
checkpoint, handoff, and integrate are tracked in `TASK-2218` because the
mission explicitly excludes integration gate planning.
