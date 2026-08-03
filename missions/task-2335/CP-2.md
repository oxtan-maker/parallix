# CP-2: Map the review-launch, configuration, and reviewer-family eligibility flow

## Summary

Mapped the complete review-launch and reviewer-selection path to identify the task-2322.12 regression boundary. The analysis traced three layers:

### Review-Launch Entry (`review-commands.ts`)
`px review <slug> --start` dispatches to `startReviewLoopFn(slug, { implementer, reviewer, ... })` (line ~1700). When `--reviewer` is not specified, `reviewer` is `undefined` and auto-selection kicks in.

### Reviewer Auto-Selection (`review-loop.ts`)
When `reviewer` is not explicitly provided and no persisted reviewer exists, the review-loop calls:
```
reviewer = selectAgentFn('review', { exclude: new Set([implementer]) });
```
(`review-loop.ts` line ~535). This passes the implementer family in the `exclude` set but does NOT pass a `config` parameter — `selectAgent` reads `config/agents.json` from disk.

### Agent Selection (`launcher-selection.ts`)
`selectAgent('review', { exclude: new Set([implementer]) })`:
1. Reads `config/agents.json` via `readAgentConfig()` (line ~132)
2. Gets eligible agents for `review` step: `['codex', 'claude', 'custom', 'vibe']` (from `eligibleAgentsForStep`, line ~127)
3. Filters by exclude set: `pool = eligible.filter(agent => !excluded.has(agent) && ...)` (line ~143)
4. Checks launcher availability for each candidate (line ~150)
5. Applies `random` selection policy over the available cross-family pool (line ~165)

### Fallback Path (`review-loop.ts` line ~874-920)
When `selectAgentFn` throws (e.g., all cross-family agents are launcher-unavailable), the review-loop evaluates:
- `anyDifferentFamilyRunnable`: checks if any non-implementer agent is supported
- `implementerRunnable`: checks if the implementer itself is supported
- If no different-family agent is runnable but implementer is: `reviewer = implementer` (single-family-fallback)

### task-2322.12 Change Boundary
The task-2322.12 commit (`c96628bea`) modified `review-commands.ts`, `review-loop.ts`, and `agents.ts`. The reviewer-selection path (`selectAgentFn('review', { exclude: new Set([implementer]) })`) was preserved in task-2322.12, meaning the regression was likely in a sibling path or the test needed to exercise this path more directly. The `selectAgent` function in `launcher-selection.ts` was NOT modified by task-2322.12 (its last change was task-2279).

### Documented No-Cross-Family Fallback
When no different-family reviewer is runnable, the documented fallback sets `reviewer = implementer` (single-family-fallback). This is a legitimate corner case, not a regression — the key requirement is that this fallback only triggers when no cross-family agent is actually runnable.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review-launch path mapped | `src/platform/runtime/lib/review/review-commands.ts:1700` (dispatch to startReviewLoop) | PASS |
| Reviewer auto-selection identified | `src/platform/runtime/lib/review/review-loop.ts:865` (`selectAgentFn('review', { exclude: new Set([implementer]) })`) | PASS |
| Configuration application traced | `src/platform/runtime/lib/agents/launcher-selection.ts:132-165` (readAgentConfig, eligibleAgentsForStep, pool filtering, random selection) | PASS |
| Fallback path documented | `src/platform/runtime/lib/review/review-loop.ts:874-920` (single-family-fallback when no different-family agent runnable) | PASS |
| task-2322.12 change boundary identified | Commit `c96628bea` modified review-commands.ts, review-loop.ts, agents.ts; launcher-selection.ts unchanged since task-2279 | PASS |

## Next action
CP-3: Rewrite the reproduction test to exercise the real launch path (real `selectAgent` without custom wrapper), verify cross-family exclusion and random selection, and confirm the review-loop passes the correct exclude set.
