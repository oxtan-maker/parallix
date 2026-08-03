# CP-1: Lock the regression before any fix

## Summary
Created `test/task-2335-reviewer-family-repro.test.js` with four focused tests that verify the reviewer-selection `selectAgent` function correctly excludes the implementer's family and selects a cross-family reviewer:

1. **`selectAgent` excludes author family** — with `exclude: new Set(['codex'])`, the returned reviewer is never `'codex'`
2. **Stability across 50 iterations** — repeated calls with the same exclude set never return the implementer family
3. **Review-loop path** — `startReviewLoop` with mocked dependencies calls `selectAgentFn` with the implementer in the exclude set, and the selected reviewer is a cross-family agent
4. **Controlled randomness** — stubbing `Math.random` confirms the candidate set passed to selection excludes the author family

The `selectAgent` function in `launcher-selection.ts` correctly respects the `exclude` Set parameter and applies the configured `random` selection policy over the filtered cross-family pool. The regression is therefore NOT in the `selectAgent` function itself.

The regression must be in the review-loop's fallback path: when `selectAgentFn` throws (e.g., launcher check fails), the fallback at `review-loop.ts:874-904` evaluates `anyDifferentFamilyRunnable` and `implementerRunnable` and can set `reviewer = implementer` (single-family-fallback). The investigation of when this fallback is triggered "all the time" continues in CP-2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test created at `test/task-2335-reviewer-family-repro.test.js` | `test/task-2335-reviewer-family-repro.test.js` (4 tests, all green) | PASS |
| `selectAgent` excludes the author family from the candidate pool | `src/platform/runtime/lib/agents/launcher-selection.ts:143` (`pool = eligible.filter(agent => !excluded.has(agent) && ...)`) | PASS |
| Review-loop passes implementer in exclude set to `selectAgentFn` | `src/platform/runtime/lib/review/review-loop.ts:865` (`selectAgentFn('review', { exclude: new Set([implementer]) })`) | PASS |
| Focused test runs via `npm test -- test/task-2335-reviewer-family-repro.test.js` | `FORCE_COLOR=0 npx tsx test/run-default-tests.ts test/task-2335-reviewer-family-repro.test.js` — 4/4 pass | PASS |

## Next action
CP-2: Map the review-launch, configuration, and reviewer-family eligibility flow; identify the task-2322.12 change that bypasses configuration or collapses the candidate set to self-review. Trace the fallback path at `review-loop.ts:874-904` and the `selectAgent` launcher-availability check to determine why `selectAgentFn` throws in production and triggers the single-family-fallback.
