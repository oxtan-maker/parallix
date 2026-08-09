# Mission: Separate agent runtime from lifecycle cycle time (task-2347.05)

## Goal
Decouple agent execution duration (runtime) from mission lifecycle duration (cycle time) in the board's metrics so that agent efficiency and delivery-system efficiency can be measured independently.

## Why Now
After task-2347.04 made metrics time-truthful by introducing `createdAt` and `closedAt` on `MissionOutcome`, the board still reports agent runtime as "cycle time". `ConcreteMetricsReadAdapter.usageRecordsToOutcomes` sums `record.duration_minutes` into `cycleTimeMinutes` and discards per-run detail by setting `runs: []`. This conflates two distinct quantities: a mission with 37 minutes of agent work across a 26-hour lifecycle appears as 37 minutes of cycle time. Without separating these, the board cannot answer: how efficient are the agents (runtime vs output) or how efficient is the delivery system (wait time vs runtime)? This blocks data-driven decisions on both agent performance and process optimization.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: domain separation between AgentRunMeasurement and MissionOutcome, metrics-read-adapter refactor, board labeling changes, reproduction test suite

## Scope
- Refactor `usageRecordsToOutcomes` in `src/application/projections/metrics-read-adapter.ts` to compute `cycleTimeMinutes` from lifecycle event history (closedAt minus createdAt from board_lane_events) instead of summing `record.duration_minutes`
- Populate `runs: readonly AgentRunMeasurement[]` on `MissionOutcome` from the usage records, preserving duration, tokens, cost, tool calls, provider, model, stage, and role per run
- Update `medianStateTimes` in `src/application/projections/metrics.ts` to accept and use lifecycle-derived cycle time from `MissionOutcome.cycleTimeMinutes`
- Add separate metric or board surface for agent runtime distinct from cycle time, with labels that cannot be confused (e.g., "Agent Runtime" vs "Cycle Time")
- Ensure existing `CompletedMissionStatistics` continues to work correctly (it already sums from `outcome.runs`, not from `cycleTimeMinutes`)
- Update any board UI strings that present runtime as cycle time

## Out of Scope
- Cost model or pricing changes
- Cohort/experiment comparison (task-2347.09)
- Changing how usage rows are written at mission time

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A red-to-green test with a mission whose agent runtime (sum of usage record durations) and wall-clock lifetime (closedAt - createdAt from lane events) differ by at least 1 minute asserts that `MissionOutcome.cycleTimeMinutes` equals the wall-clock lifetime, not the summed run duration
- SC2: `usageRecordsToOutcomes` in `src/application/projections/metrics-read-adapter.ts` computes `cycleTimeMinutes` from lifecycle events and populates `runs` array with one `AgentRunMeasurement` per usage record for the mission
- SC3: `MissionOutcome.runs` is populated for every returned outcome; no outcome has `runs: []` in production data
- SC4: `medianStateTimes` in `src/application/projections/metrics.ts` derives the median from `outcome.cycleTimeMinutes` values that reflect lifecycle duration, not agent runtime
- SC5: The board renders two distinct quantities with non-overlapping labels: one for lifecycle cycle time and one for agent runtime; no UI string uses "cycle time" to refer to agent execution minutes
- SC6: `CompletedMissionStatistics` in `src/domain/usage.ts` continues to sum runtime from `outcome.runs` via `totalDurationMinutes` without change
- SC7: `./scripts/verify-local.sh all` passes on the final tree

Reproduction-Test: test/task-2347.05-cycle-time-vs-runtime.test.ts

## Risks and Assumptions
- Assumption: `BoardLaneEventRepository` provides `createdAt` (backlog entry timestamp) and `closedAt` events for every completed mission; if events are missing, cycle time falls back to usage record timestamps as a best-effort estimate
- Assumption: Usage records contain sufficient detail to reconstruct `AgentRunMeasurement` (duration, tokens, cost, tool calls, provider, model, stage, role)
- Risk: Existing consumers of `medianStateTimes` may expect it to represent agent runtime; these must be updated or new metrics introduced
- Risk: Board UI may have hardcoded expectations about the meaning of cycle time; all renderers must be audited
- Risk: `stats.ts` CLI or other consumers may depend on the current conflated behavior; these must be verified and updated if necessary

## Checkpoints
- CP 1: Reproduction test authored — failing test in `test/task-2347.05-cycle-time-vs-runtime.test.ts` asserts SC1 on the parent commit; test file exists and fails before any fix
- CP 2: Domain types aligned — `MissionOutcome` interface unchanged (already has `createdAt`, `closedAt`, `cycleTimeMinutes`, `runs` from task-2347.04), `AgentRunMeasurement` fields verified sufficient for usage record mapping
- CP 3: Adapter refactored — `usageRecordsToOutcomes` computes `cycleTimeMinutes` from lane event timestamps and populates `runs` from usage records; all SC2 assertions pass
- CP 4: Metrics updated — `medianStateTimes` uses lifecycle-derived cycle time; SC4 assertion passes
- CP 5: Board labels separated — UI strings audited and updated to distinguish agent runtime from cycle time; SC5 assertion passes
- CP 6: Integration verified — `./scripts/verify-local.sh all` passes; all SC1–SC7 assertions pass

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify how usage rows are written during mission execution (persistence layer out of scope)
- Do not change cost model, pricing, or billing logic
- Do not alter `CompletedMissionStatistics` computation logic (it already correctly sums from `runs`)

## Stop Rules
- Stop if `./scripts/verify-local.sh all` fails on the final tree
- Stop if any success criterion cannot be evidenced with a file:line reference, test name, test file path, ADR reference, or recognized repo command
- Stop if the reproduction test cannot be made to fail on the parent commit
