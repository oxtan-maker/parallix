# CP-1: Mapping Complete — Two Concrete Failure Modes Identified

## Failure Mode 1: Weekly Classification Count Mismatch

**File:** `lib/commands/stats.js`, `summarizeMissionWindow` function (lines 544-564)

**Root cause:** `summarizeMissionWindow` computes `total` as the count of ALL unique missions (by `repo+mission` key), then counts `userValue` and `aiSdlc` separately. Missions with empty/null/unrecognized classification values are included in `total` but excluded from both subtotals.

```js
const userValue = uniqueMissions.filter(row => row.classification === 'user_value').length;
const aiSdlc = uniqueMissions.filter(row => row.classification === 'ai_sdlc').length;
return { total: uniqueMissions.length, userValue, aiSdlc };
```

**Evidence:** In the backlog task output, `# missions = 35` but `# user value missions = 3` + `# AI SDLC missions = 12`, meaning 20 missions have no valid classification.

**Fix:** Filter the `total` count to only include missions with a recognized classification, so `total === userValue + aiSdlc`.

## Failure Mode 2: Mixed-Agent Phase Telemetry Corruption

**File:** `lib/review/review-loop.js`, lines 644 and 859

**Root cause:** Both `recordStageStatsSafe('review', ...)` and `recordStageStatsSafe('active', ...)` pass `sinceMs: state.startedAt` — the review loop's overall start time. This causes:

1. **Execute-to-review bleed:** The reviewer's `sinceMs` window includes the execute phase's telemetry (if the execute phase wrote telemetry after the review loop started).
2. **Reviewer-to-implementer bleed:** The implementer's `sinceMs` window includes the reviewer's telemetry (since the reviewer launched before the implementer within the same round).
3. **Per-round overwriting:** Each round's `upsertStatsRow` overwrites the previous row (same key), so the final row contains cumulative telemetry from the entire review loop — not just that round.

```js
// Line 644 (reviewer stats)
sinceMs: state.startedAt ? Date.parse(state.startedAt) : 0,

// Line 859 (implementer stats)  
sinceMs: state.startedAt ? Date.parse(state.startedAt) : 0,
```

**Evidence:** In task-1339 output, both execute and review phases show identical telemetry (4526019 input, 21427 output) — the execute phase's Codex rollout is bleeding into the review phase.

**Fix:** Pass phase-specific `sinceMs` values — use `reviewerLaunchResult.result.startedAt` for the reviewer and `implementerLaunchResult.result.startedAt` for the implementer.

## Next action for CP-2

Write automated regression tests for both failure modes. The weekly classification test will construct CSV rows with a mix of classified and unclassified missions and assert that `total == userValue + aiSdlc`. The mixed-agent test will construct CSV rows simulating the task-1339 scenario (Claude execute, OpenAI telemetry, Claude implementer) and assert that non-OpenAI providers show `—` for Usage %.
