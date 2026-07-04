# CP-3: Improve fallback block reason with stderr snippet

## Work Done

Modified the block reason construction in the launch-failure path of `startAgent` to include the first line of stderr when available. Changed from bare `exit 1` to `exit 1: <first-line-of-stderr>` format.

Applied changes to both:
- `lib/agents/agents.js` line ~852
- `lib/agents/agents.ts` line ~931

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | agents.js includes stderr snippet in block reason | `lib/agents/agents.js:852-854` — ternary checks `result?.stderr` and uses `result.stderr.trim().split('\n')[0]` |
| 2 | agents.ts includes stderr snippet in block reason | `lib/agents/agents.ts:931-934` — identical logic for stderr-first-line snippet |
| 3 | Reason format matches SC 5 requirement | Produces `exit 1: sandbox violation` instead of bare `exit 1` when stderr is non-empty |

## Next action

CP-4: Add `detectLimitHit` guard for `status === undefined` — return `null` instead of treating it as a failure.
