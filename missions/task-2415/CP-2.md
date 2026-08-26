# CP-2 — Minimal guarded branch fix in the review loop

## Summary

Applied the single-branch fix in `src/adapters/review/review-loop.ts` (the
`state.phase === 'reviewing'` pre-review rebase failure block): the catch-all
`else { exit(1); return; }` paired with `if (rebaseResult.hookFailure)` is now
`else if (!preReviewSetupVerified) { exit(1); return; }`.

- A verified gate-only repair (`failure.kind === 'gate'`, `hookFailure` falsy,
  kernel verify passed) sets `preReviewSetupVerified = true` in the gate branch,
  so the guarded exit is skipped and control falls through to
  `reviewBaseline = captureReviewBaseline()` → `state.phase = 'reviewing'` →
  reviewer launch in the same round.
- An unclassified failure (no gate branch, no hook failure) or any unrepaired
  failure still reaches `exit(1)`: the gate branch exits itself when
  `!bounceResult.bounced`, and the hook branch keeps its own stranded/human-only
  exits unchanged.
- Because `preReviewSetupVerified` is true for the repaired round, the
  `if (!dryRun && !preReviewSetupVerified)` declared-gate block is skipped —
  the already-verified pre-review setup is not re-run before the reviewer launch.
- The hook-failure branch, the stranded/unrepaired exits, the per-round
  relaunch cap (`DEFAULT_REBOUNDS_PER_ROUND`, `stopForRoundReboundCap`), and the
  `preReviewSetupVerified = false` reset before reviewer launch are untouched.

**Red→green proof:** the same command, same test:
- At parent `92092ce69`: `✖ ... Error: unexpected exit` from `src/adapters/review/review-loop.ts:630` (CP-1 evidence).
- With this fix committed: `✔ task-2415 repro: repaired pre-review gate continues the review round instead of exiting (8.736272ms)`, `pass 1, fail 0`
  via `` `npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` ``.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Verified gate-only repair no longer calls exit(1) and launches the reviewer exactly once | `` `npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` `` → `pass 1, fail 0`; test `"task-2415 repro: repaired pre-review gate continues the review round instead of exiting"` asserts `reviewerLaunches === 1` and the `continuing this review round.` log preceding the launch | PASS |
| Fix is a single guarded branch; hook-failure path, stranded exits, and rebound cap unchanged | `src/adapters/review/review-loop.ts` (fix commit on top of `eab9272d4`): only the catch-all `else` of the `if (!rebaseResult.ok)` block changed to `else if (!preReviewSetupVerified)`; the `if (rebaseResult.hookFailure)` branch body and both stranded `exit(1)` paths in the gate/hook branches are byte-identical | PASS |
| Repaired round does not re-run the declared pre-review gate | Test asserts `gateRuns === 2` (both runs belong to the rebound kernel verify) and `rebaseRuns === 3`; the `if (!dryRun && !preReviewSetupVerified)` block in `src/adapters/review/review-loop.ts` is skipped when `preReviewSetupVerified` is true | PASS |

## Next action

CP-3: run the focused regression pair — `test/task-2415-pre-review-gate-repair-continues.test.ts`
and `test/task-2353-rebounce-reproduction.test.ts` ("declared pre-review gate rebounces, replays,
and resumes the review loop") — and confirm both are green together.
