# CP-1 — Red regression test locking the repaired-gate exit bug

## Summary

Authored the in-process regression test at `test/task-2415-pre-review-gate-repair-continues.test.ts`
(test name: `"task-2415 repro: repaired pre-review gate continues the review round instead of exiting"`).
The scenario calls `startReviewLoop` with:

- `rebaseBeforeReviewRoundFn`: call 1 returns the typed gate-only failure
  `{ ok: false, failure: { kind: 'gate', gate: { area: 'static-analysis', ... }, operation: 'pre-push' } }`
  with `hookFailure: false`; call 2+ returns `{ ok: true, sharedFileConflicts: false, hookFailure: false }`.
- `runPreReviewGateFn`: call 1 returns `ok: false`, call 2+ returns `ok: true`.
- `exit: () => { throw new Error('unexpected exit'); }` and a reviewer-launch counter.

The real `reboundPreReviewFailure` kernel runs unmocked: it launches the implementer twice
(attempt 1's verify fails on the first gate run, attempt 2's verify passes), verifies the repair
via `verifyPreReviewSetup` (rebase + gate), and reports `fixed`. The green contract asserts
`reviewerLaunches === 1`, a `continuing this review round.` log line preceding the reviewer launch,
`gateRuns === 2` (both consumed by the kernel verify — the declared-gate block must be skipped),
and `rebaseRuns === 3`.

**Red proof at the parent commit (HEAD `92092ce69`, source untouched):**
`npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` fails with
`✖ task-2415 repro: ... (11.996394ms) — Error: unexpected exit`, thrown from
`src/adapters/review/review-loop.ts:630` (the `else { exit(1); return; }` paired with
`if (rebaseResult.hookFailure)`), after the `continuing this review round.` log line —
the round is abandoned before the reviewer launches (`reviewerLaunches` stays `0`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test exists at the mission-mandated path with injected deps only (no live forgejo) | `test/task-2415-pre-review-gate-repair-continues.test.ts`, test `"task-2415 repro: repaired pre-review gate continues the review round instead of exiting"` | PASS |
| Test is red at the parent commit: injected `exit` throws after the gate-repair continuation log | `` `npm test -- test/task-2415-pre-review-gate-repair-continues.test.ts` `` at parent `92092ce69`: `fail 1`, `Error: unexpected exit` from `src/adapters/review/review-loop.ts:630` | PASS |
| Red reproduces the exact bug: loop abandons the round before reviewer launch | `src/adapters/review/review-loop.ts` `if (!rebaseResult.ok)` block (lines 541–631 at parent `92092ce69`): gate branch verifies repair (line 582 logs the continuation, line 583 sets `preReviewSetupVerified`), then the `else` of `if (rebaseResult.hookFailure)` (line 585) calls `exit(1)` at line 630 | PASS |

## Next action

CP-2: change the final `else { exit(1); return; }` of the `if (!rebaseResult.ok)` block in
`src/adapters/review/review-loop.ts` to `else if (!preReviewSetupVerified)` so a verified
gate-only repair falls through to the reviewer launch while unclassified/unrepaired failures
still exit.
