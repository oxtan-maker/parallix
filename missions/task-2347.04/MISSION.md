# Mission: Make throughput and historical series time-truthful (task-2347.04)

## Goal
Make every board metric series compute its value from only the data available at each time bucket, and ensure "completion" means genuinely closed missions — not every mission with telemetry.

## Why Now
The board's throughput and all historical series are flat lines or lifetime counts. `weeklyThroughputSeries` returns `{ at: 'available-history', value: outcomes.length }` — a single point of all missions with telemetry, not weekly completions. `throughputSeries` uses `filter(() => true)` stub. `medianStateTimes`, `reviewLoopRateSeries`, and `cumulativeFlowSeries` compute from the full outcome set at every instant. `MissionOutcome` lacks `closedAt`, so time-scoped queries cannot be expressed. The bottleneck sentence says "N completed this week" when it means "N missions exist." This misleads any operator reading the board.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: domain contract change (`MissionOutcome` gains `createdAt` + `closedAt`), 5+ series functions rewritten, adapter updated, TUI label verified, regression test suite authored

## Scope
- Add `createdAt: string` and `closedAt: string` to `MissionOutcome` in `src/domain/usage.ts`
- Update `usageRecordsToOutcomes` in `src/application/projections/metrics-read-adapter.ts` to populate `createdAt`/`closedAt` and filter out non-closed missions
- Rewrite `weeklyThroughputSeries` in `src/application/projections/metrics.ts` to bucket by ISO week using `closedAt`
- Rewrite `throughputSeries` to count only outcomes with `closedAt <= instant` (remove `filter(() => true)` stub)
- Rewrite `medianStateTimes` to include only outcomes with `closedAt <= instant`
- Rewrite `reviewLoopRateSeries` to include only outcomes with `closedAt <= instant`
- Either implement `cumulativeFlowSeries` as a real cumulative measure or delete it; delete unused `wipAtTime`/`wipSeries` exports if no longer consumed
- Update `buildMetrics` to pass instants to `weeklyThroughputSeries` if signature changes
- Update `bottleneckNarrative` text if metric meaning changes
- Verify TUI `flow-panel.tsx` labels match new semantics
- Regression test suite in `test/` covering all AC

## Out of Scope
- Separating agent runtime from lifecycle cycle time (task-2347.05)
- Cohort/experiment comparison (task-2347.09)
- Chart rendering in the TUI beyond label corrections
- Changes to `CompletedMissionStatistics` or `completedMissionStatistics()` (already correct)
- CLI `stats.ts` changes (already filters correctly)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `MissionOutcome` interface in `src/domain/usage.ts` declares `createdAt: string` and `closedAt: string` fields
- SC2: `usageRecordsToOutcomes` in `src/application/projections/metrics-read-adapter.ts` populates `createdAt` and `closedAt` on every returned `MissionOutcome` and excludes records where the mission is not closed
- SC3: `weeklyThroughputSeries` returns one point per ISO week bucket, where each point's `value` equals the count of outcomes whose `closedAt` falls inside that week; series spans at least 3 weeks when test data covers 3+ weeks
- SC4: `throughputSeries` returns, for each instant, the count of outcomes with `closedAt <= instant`; the `filter(() => true)` stub is removed
- SC5: `medianStateTimes` computes median only from outcomes with `closedAt <= instant` at each instant
- SC6: `reviewLoopRateSeries` computes average only from outcomes with `closedAt <= instant` at each instant
- SC7: `cumulativeFlowSeries` either (a) returns a real cumulative measure that varies across instants or (b) is deleted along with any callers; unused `wipAtTime`/`wipSeries` exports are deleted if no longer imported
- SC8: `bottleneckNarrative` sentence text accurately reflects the meaning of the metrics it references
- SC9: TUI `flow-panel.tsx` label "Weekly throughput" matches the semantics of the new `weeklyThroughput` series
- SC10: `./scripts/verify-local.sh all` passes on the final tree
- SC11: A red-to-green reproduction test in `test/` fails on the parent commit (active/review missions counted as completions) and passes after the fix

## Risks and Assumptions
- `UsageRecord` (from CLI/forgejo) carries enough date fields (`date`, `closed` status) to derive `createdAt`/`closedAt`. If not, the adapter must infer from transition timestamps
- Existing tests in `test/board-metrics.test.ts` assert on `MissionOutcome` shape — adding required fields may break tests; they must be updated
- `buildMetrics` and `buildBoardMetrics` signatures may need updating if `weeklyThroughputSeries` accepts instants parameter
- `CompletedMissionStatistics` already has `closedAt` from `ClosedMission`; no change needed there
- Dependency TASK-2347.03 must be merged before this mission activates

## Checkpoints
- CP 1: Author regression reproduction test (`test/task-2347.04-throughput-truthful.test.ts`) that fails on parent commit — asserts active/review missions excluded from throughput and an outcome closed 8 weeks ago does not appear in this week's bucket. This test is red before any fix, green after.
- CP 2: Add `createdAt` and `closedAt` to `MissionOutcome` interface; update `usageRecordsToOutcomes` adapter. Verify `test/board-metrics.test.ts` still compiles.
- CP 3: Rewrite `weeklyThroughputSeries`, `throughputSeries`, `medianStateTimes`, `reviewLoopRateSeries` to be time-scoped. Run reproduction test — confirm green.
- CP 4: Resolve `cumulativeFlowSeries` (implement or delete), clean unused exports. Update `bottleneckNarrative` and TUI labels. Run full verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/domain/usage.ts:85` (must point to an existing file and line)
  2. **Test names** — e.g., `"throughputSeries excludes outcomes closed after instant"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2347.04-throughput-truthful.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `node --test test/board-metrics.test.ts` ``, or `` `npm test` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. **Weak-agent failure mode:** raw `stat`/`ls` output or generic prose alone is not sufficient evidence — always pair shell output with a file:line reference, test name, test file path, ADR reference, or recognized command.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1: MissionOutcome has createdAt/closedAt | `src/domain/usage.ts:85-86` | PASS |
| SC3: weeklyThroughputSeries buckets by week | `test/task-2347.04-throughput-truthful.test.ts`, `"weeklyThroughputSeries emits one point per week bucket"` | PASS |
| SC10: verification gate passes | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/domain/mission.ts` — `ClosedMission` and `closeMission()` already carry `closedAt`; do not modify
- `src/adapters/cli/commands/stats.ts` — already filters correctly; do not modify
- `src/domain/usage.ts` — `CompletedMissionStatistics` and `completedMissionStatistics()` already correct; modify only `MissionOutcome` interface
- `src/interfaces/tui/flow-panel.tsx` — modify labels only; do not change layout or chart rendering

## Stop Rules
- Do not add chart rendering or new TUI components (out of scope, task-2304 territory)
- Do not separate agent runtime from lifecycle cycle time (task-2347.05)
- Do not add cohort/experiment comparison (task-2347.09)
- Do not modify `CompletedMissionStatistics` or its constructor
- If `UsageRecord` lacks fields needed for `createdAt`/`closedAt`, stop and raise a dependency issue — do not fabricate timestamps

Reproduction-Test: test/task-2347.04-throughput-truthful.test.ts
