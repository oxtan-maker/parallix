# CP-3: Unit test written and passing, all existing tests still pass

## Summary

Added the mission-required unit test plus a WARN-fallback test, and updated the two existing tests
that encoded the old "start the review loop on findings" contract. All review test files pass; the
only remaining full-suite failure is a pre-existing, change-independent stats test.

### New / rewritten tests

1. `test/review-commands.test.js:194` — rewritten from
   `no-PR + static review findings DOES trigger review loop` to
   **`no-PR + static review findings re-launches the implementer (not the review loop)`**. Injects
   mocked `startReviewLoopFn` + `startAgentFn` and asserts: `startReviewLoopFn` call count `=== 0`;
   `startAgentFn` called once with `step === 'active'`; `opts.agent === 'claude'` (the injected
   implementer); each finding present as a `- <finding>` line in `opts.prompt`; `submitForReviewFn`
   and `postStaticReviewCommentFn` NOT called (covers SC1, SC2, SC3).
2. `test/review-commands.test.js` —
   **`no-PR + static review findings with unresolvable implementer logs WARN and does nothing`**
   (`getTaskImplementerFn: () => null`): asserts `startAgentFn` not called, `startReviewLoopFn` not
   called, and a `WARN` log matching `implementer could not be resolved` (covers SC3 fallback).
3. `test/review.test.js:2036` — rewritten from
   `review posts static findings before starting the autonomous loop` (which asserted the old
   `['submit', 'comment', 'start']` sequence) to
   **`review re-launches the implementer on static findings instead of starting the autonomous loop`**.
   Asserts the recorded call sequence is `['agent']` with `step === 'active'`, `opts.agent === 'claude'`,
   correct worktree, and the finding text in the prompt.

### Why the two existing tests were rewritten, not just appended to

Both directly encoded the inverse of this mission's goal (the findings branch starting the review
loop). The Stop Rule about existing-test failure guards against *collateral* breakage; these are
the two tests that mirror the exact branch being replaced, so updating them to the new contract is
the intended path — documented here per the CP-1 plan.

### Test results

- Review files (`review.test.js`, `review-commands.test.js`, `review-commands-supplemental.test.js`,
  `review-commands-additional.test.js`): **162 pass / 0 fail**.
- Full suite (`npm test`): **1489 pass / 1 fail**. The single failure
  (`task-1251 and task-1314: normalizeStatsRow migrates a legacy 5-column row...` in
  `test/stats.test.js`) is **pre-existing**: it asserts a repo basename of `parallix` but the
  worktree is `parallix-task-1311`. Reproduced on the stashed clean tree (1 fail in
  `stats.test.js` with no mission changes applied), so it is not introduced by this change and
  falls under the Stop Rule for pre-existing failures.

## Goal Check

| Item | Status | Evidence |
| --- | --- | --- |
| SC1: review loop not called, agent called once with `step==='active'` | ✅ | `test/review-commands.test.js:194` (test `no-PR + static review findings re-launches the implementer (not the review loop)`) |
| SC2: prompt contains each finding as a line item | ✅ | `test/review-commands.test.js` prompt `includes('- ' + f)` assertions |
| SC3: agent === implementer; null ⇒ WARN + no launch | ✅ | `test/review-commands.test.js` test `no-PR + static review findings with unresolvable implementer logs WARN and does nothing` |
| SC4: `ok: true` branch unchanged | ✅ | `test/review-commands.test.js:147` + `test/review.test.js:2060` still pass |
| SC5: review test files all pass | ✅ | 162 pass / 0 fail across 4 review test files |
| Cross-file old-contract test updated | ✅ | `test/review.test.js:2036` (test `review re-launches the implementer on static findings instead of starting the autonomous loop`) |
| Remaining full-suite failure is pre-existing | ✅ | `test/stats.test.js:1134` fails identically on stashed clean tree |

Next action: run `./scripts/verify-local.sh parallix` for CP-4, confirm exit 0 (or that any failure is the documented pre-existing stats issue), then commit mission + checkpoint docs and hand off.
