# CP-3: Restore configuration application and cross-family candidate set

## Summary

Rewrote `test/task-2335-reviewer-family-repro.test.js` to exercise the actual review-launch path instead of validating `selectAgent` in isolation. The previous test used a custom `selectAgentFn` wrapper that explicitly passed both `config` and `exclude`, validating the `selectAgent` function's internal logic rather than the production launch path.

### Test Changes

The rewritten test suite (6 tests) now exercises the real launch path:

1. **`selectAgent` cross-family exclusion (real launch path)** — calls `selectAgent('review', { exclude: new Set([implementer]) })` WITHOUT a `config` parameter, matching the production review-loop call. Verifies the returned reviewer is never the implementer family.

2. **Stability across 50 iterations** — repeated calls confirm randomness does not accidentally return the implementer family.

3. **Controlled randomness** — stubbing `Math.random` confirms the candidate set passed to selection excludes the author family.

4. **No-cross-family fallback** — excluding all four eligible families throws "All eligible agents ... are exhausted", exercising the documented corner-case fallback.

5. **Review-loop path** — `startReviewLoop` with the real `selectAgent` (no custom wrapper) verifies the review-loop passes the implementer in the exclude set and the selected reviewer is a cross-family agent.

6. **Single-family fallback** — when no different-family reviewer is runnable, the review-loop correctly triggers the single-family-fallback path.

### Implementation Analysis

The production code (`review-loop.ts:865`) already correctly calls `selectAgentFn('review', { exclude: new Set([implementer]) })`. The `selectAgent` function in `launcher-selection.ts` correctly reads the repository's `config/agents.json`, builds the eligible cross-family candidate set, applies the `random` selection policy, and excludes the author family. No implementation change was required — the regression was in the test's coverage of the actual launch path, not in the selection logic itself.

The tests now cover:
- Normal cross-family selection (tests 1-3)
- Configuration application via disk-read (tests 1-3, no explicit config)
- Random selection over cross-family candidate set (test 3)
- No-cross-family fallback throwing (test 4)
- Review-loop exclude set propagation (test 5)
- Single-family fallback path (test 6)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Focused regression test exercises real launch path | `test/task-2335-reviewer-family-repro.test.js` — real `selectAgent` called without explicit `config` parameter | PASS |
| Review-launch path reads and applies configured reviewer-selection policy | `src/platform/runtime/lib/review/review-loop.ts:865` calls `selectAgentFn('review', { exclude: new Set([implementer]) })`; `launcher-selection.ts:132-165` reads config/agents.json and applies random selection | PASS |
| Random selection over eligible cross-family set | `test/task-2335-reviewer-family-repro.test.js` — `"selectAgent uses configured random selection over the eligible cross-family set"` controls Math.random and asserts candidate set | PASS |
| No-eligible-cross-family fallback covered | `test/task-2335-reviewer-family-repro.test.js` — `"selectAgent throws when all eligible agents are excluded"` and `"startReviewLoop single-family fallback"` tests | PASS |
| All 6 focused tests pass | `FORCE_COLOR=0 npx tsx test/run-default-tests.ts test/task-2335-reviewer-family-repro.test.js` — 6/6 pass | PASS |

## Next action
CP-4: Run the required verification gate (`./scripts/verify-local.sh all`), update workflow documentation if needed, and capture final goal-check evidence.
