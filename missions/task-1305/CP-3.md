# CP-3: Regression test

## Summary

Added a regression test to `test/review.test.js`: **`startReviewLoop preserves persisted round data when the reviewer identity changes on resume`** (inserted at `test/review.test.js:2653`).

It drives the real `startReviewLoop` (no isolated re-implementation) on the resume path:
- `readReviewStateFn` returns a persisted state with `round: 3, startedAt: '2026-01-01T00:00:00.000Z', phase: 'fixing', disposition: 'REQUEST_CHANGES', reviewer: 'codex', implementer: 'claude'`.
- The loop is launched with `reviewer: 'gemini'` (differs from persisted `'codex'`) and `implementer: 'claude'`.
- Provider is workflow-owned (`isForgejoReviewEnabledFn: () => false`), `isContinue: true`, `dryRun: false`. With these mocks the fixing-phase resume reaches the first `writeReviewStateFn` call (`review-loop.js:900`) before any `advanceRound`, then terminates cleanly via a mocked `PUSHBACK_ALL` disposition (`review-loop.js:1043-1047`).
- The test captures every persisted snapshot and asserts the **first** one preserves `round === 3`, `startedAt`, `phase === 'fixing'`, `disposition === 'REQUEST_CHANGES'` while adopting `reviewer === 'gemini'` and `implementer === 'claude'`.

Falsifiability confirmed: temporarily reverting `review-loop.js:602-608` to the original identity-mismatch ternary makes this test **fail** (`pass 0 / fail 1`); with the fix in place it **passes** (`pass 1 / fail 0`). The fix was restored after verification.

## Goal Check

| Item | Evidence |
| --- | --- |
| Regression test added | `test/review.test.js:2653` — `startReviewLoop preserves persisted round data when the reviewer identity changes on resume` |
| Persisted round > 1 with differing reviewer | test seeds `round: 3`, persisted `reviewer: 'codex'` vs launch `reviewer: 'gemini'` (`test/review.test.js:2664-2685`) |
| Preserves round/startedAt/phase/disposition | assertions `test/review.test.js:2707-2711` (`round===3`, `startedAt` unchanged, `phase==='fixing'`, `disposition==='REQUEST_CHANGES'`) |
| Updates reviewer identity | assertion `test/review.test.js:2712` (`reviewer==='gemini'`) |
| Test passes against the fix | `node --test --test-name-pattern=...` → `pass 1 / fail 0` |
| Test fails against the bug (falsifiable) | reverted construction to original ternary → `pass 0 / fail 1`; restored afterward |

Next action: In CP-4, run the full `npm test` suite and `./scripts/verify-local.sh docs` to confirm zero regressions across `review-state.test.js`, `review-state-class.test.js`, `review.test.js`, and all mission Gates.
