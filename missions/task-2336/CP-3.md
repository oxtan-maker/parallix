# CP-3 — Surface block state in the strip

## Summary

`AgentAvailabilityMetric` gained an optional `reason` field
(`src/application/projections/board.ts:63`). The value already flowed at runtime —
`projectAgentAvailability` emits `reason` on every row
(`src/application/projections/agent-status.ts:24`) and `BoardProjectionBuilder` passes
those rows straight into `BoardMetrics.agentAvailability`
(`src/application/projections/board-readers.ts:130`) — the metric type was simply
narrower than the data, so the strip could not read it.

`AgentStrip` now renders the block reason after the countdown for blocked families
(`src/interfaces/tui/agent-strip.tsx:76` and `:83`). The green/red dot
(`src/interfaces/tui/agent-strip.tsx:73`), the `sessions:N` field, and the
`agents: unavailable` empty-state branch (`src/interfaces/tui/agent-strip.tsx:62`) are
unchanged.

Added `test/agent-strip.test.ts` with rendering coverage (blocked countdown, dot colors,
reason, empty state, launcher-unavailable) and direct `projectAgentAvailability` coverage
for `{kind:'none'}`, future `{kind:'until'}`, expired `{kind:'until'}`, and
`{kind:'indefinite'}`.

No existing board-projection test regressed from the longer availability list:
`./scripts/verify-local.sh all` exits 0 with `tests 1746 / pass 1746 / fail 0`
(baseline at the parent commit was 1713 tests, so the 33 added tests are the whole delta).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 — blocked family renders name, red dot and `formatCountdown` output, no `agents: unavailable` | `"AgentStrip renders a red dot and countdown for a family blocked until a future timestamp"` (asserts `claude`, `●`, `45m`, and absence of `agents: unavailable`) in `test/agent-strip.test.ts` | PASS |
| SC5 — the blocked entry's dot is red and the available entry's is green | `"AgentStrip gives the blocked family a red dot and the available family a green dot"` (asserts dot colors `['green','red']`), `src/interfaces/tui/agent-strip.tsx:73` | PASS |
| SC6 — empty availability still renders `agents: unavailable` | `"AgentStrip renders \"agents: unavailable\" when the availability list is empty"`, `src/interfaces/tui/agent-strip.tsx:62` | PASS |
| SC7 — `{kind:'none'}` → `available: true`, `blockedForMs: 0` | `"projectAgentAvailability reports an unblocked family as available with zero remaining time"`, `src/application/projections/agent-status.ts:17` | PASS |
| SC7 — future `{kind:'until'}` → `available: false`, `blockedForMs === untilMs - nowMs` | `"projectAgentAvailability reports a future until-block as unavailable with the remaining time"` in `test/agent-strip.test.ts` | PASS |
| SC7 — past `{kind:'until'}` → `available: true`, `blockedForMs: 0` | `"projectAgentAvailability reports an expired until-block as available"` in `test/agent-strip.test.ts` | PASS |
| SC7 — indefinite block → `available: false`, `blockedForMs: Infinity` | `"projectAgentAvailability reports an indefinite block as unavailable for Infinity"` in `test/agent-strip.test.ts` | PASS |
| SC8 — reason `"usage limit"` reaches the rendered strip | `"AgentStrip renders the block reason for a blocked family"`, `src/interfaces/tui/agent-strip.tsx:83`, `src/application/projections/board.ts:63` | PASS |
| SC9 — `launcherAvailable: false` with `{kind:'none'}` still renders unavailable | `"projectAgentAvailability keeps a launcher-unavailable family unavailable despite no block"` in `test/agent-strip.test.ts` | PASS |
| No board-projection test regressed from the longer availability list | `./scripts/verify-local.sh all` exit 0, `pass 1746 / fail 0`; `test/board-projections.test.ts` and `test/board-readers.test.ts` included in that run | PASS |
| DoD #2 — lint and typecheck clean on changed files | `npm run typecheck` exit 0; `npx eslint src/interfaces/tui/agent-strip.tsx src/application/projections/board.ts test/agent-strip.test.ts` clean | PASS |

Next action: document the `steps.*.eligible` family derivation in the TUI/board doc that owns the agent strip, file the `defaultIsAgentBlockedNow` config-vs-SQLite divergence as a follow-up backlog task, then run `./scripts/verify-local.sh all` for CP-4.
