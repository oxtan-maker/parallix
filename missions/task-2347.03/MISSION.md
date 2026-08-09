# Mission: Derive lane intervals and fix inverted dwell attribution (task-2347.03)

## Goal
Fix `medianCycleTimeByStateSeries` so dwell time between two transitions is attributed to the state the mission occupied during that interval, not the state it entered. Introduce an explicit lane-interval derivation — a list of `{ state, enteredAt, exitedAt | null }` records per (repository, mission) — and compute all dwell metrics from those intervals.

## Why Now
Every lane row in the board's "Median cycle time" column (`src/interfaces/tui/flow-panel.tsx:60`) is shifted by one transition. For `08:00 backlog→active` then `09:00 active→review`, the 60 minutes in `active` are recorded against `review`. Experiment evaluation can reverse conclusions outright. Depends on task-2347.02 which guarantees complete event stream coverage.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 1 new LaneInterval type, rewrite `medianCycleTimeByStateSeries` to use intervals, correct expectations in 2 test files, add out-of-order/duplicate edge-case test, doc comment update

## Scope
- `src/application/projections/metrics.ts` — introduce `LaneInterval` type (or adjacent domain module), derive intervals from ordered `MissionTransition[]`, mark current-lane interval as open (`exitedAt: null`)
- `medianCycleTimeByStateSeries` — compute dwell from closed intervals only, attribute to interval's `state` (the state occupied, not the transition target)
- `test/board-metrics.test.ts` — correct the inverted expectations in the FLOW projection test (lines 252–281) and add red-to-green reproduction test
- `test/board-event-metrics-fixture.test.ts` — add assertions validating correct attribution semantics on the fixture data
- New test for out-of-order and duplicate transition rows producing deterministic interval sequence
- Doc comment on `medianCycleTimeByStateSeries` stating closed-interval-only semantics

## Out of Scope
- Throughput and completion semantics (task-2347.04)
- Lane age and bottleneck sentence (task-2347.06)
- Persisting derived intervals as a materialized table
- `medianAgeByLaneSeries` rewrite (uses last-transition timestamp, not interval-based)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A reproduction test at `test/task-2347.03-inverted-dwell-repro.test.ts` asserts that time between `backlog→active` and `active→review` is attributed to `active` (not `review`), and fails against current `medianCycleTimeByStateSeries` implementation
- SC2: A `LaneInterval` type exists with shape `{ state: BoardLane; enteredAt: string; exitedAt: string | null }`, keyed by (repository, mission), and the current-lane interval has `exitedAt: null`
- SC3: `medianCycleTimeByStateSeries` computes dwell from closed intervals (where `exitedAt !== null`) and attributes minutes to `interval.state`
- SC4: `test/board-metrics.test.ts` FLOW projection test (lines 252–281) asserts corrected values — `medianCycleTimeByState` for `active` reflects actual dwell in active, not shifted to `review`
- SC5: `test/board-event-metrics-fixture.test.ts` includes assertions validating correct attribution on fixture data
- SC6: A test asserts that out-of-order and duplicate `MissionTransition` rows produce a deterministic interval sequence (sorted by `occurredAt`, duplicates collapsed)
- SC7: Doc comment on `medianCycleTimeByStateSeries` states "closed intervals only" semantics explicitly
- SC8: `./scripts/verify-local.sh all` passes on the final tree

## Risks and Assumptions
- Risk: Rewriting `medianCycleTimeByStateSeries` may affect callers beyond the two test files. Assumption: only `buildMetrics` in `src/application/projections/metrics.ts:325` and the two test files consume this function
- Risk: Open interval (current lane) semantics could leak into dwell metrics if not guarded. Assumption: dwell counts closed intervals only; age uses last-transition timestamp
- Assumption: task-2347.02 is merged, so the event stream includes intake, integration→done, and closure transitions

## Checkpoints
- CP 1: Write failing reproduction test (`test/task-2347.03-inverted-dwell-repro.test.ts`) that asserts time between `backlog→active` and `active→review` is attributed to `active`. Test must fail (red) against current `medianCycleTimeByStateSeries` and pass (green) after fix.
- CP 2: Introduce `LaneInterval` type and interval-derivation function. Build `{ state, enteredAt, exitedAt | null }` records from ordered transitions. Mark current-lane interval as open.
- CP 3: Rewrite `medianCycleTimeByStateSeries` to consume lane intervals. Attribute dwell to interval's `state`. Count closed intervals only.
- CP 4: Correct expectations in `test/board-metrics.test.ts` (FLOW projection test, lines 252–281) and add assertions in `test/board-event-metrics-fixture.test.ts`. Add out-of-order/duplicate edge-case test.
- CP 5: Update doc comment on `medianCycleTimeByStateSeries`. Run verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/projections/metrics.ts:230` (must point to an existing file and line)
  2. **Test names** — e.g., `"FLOW projection derives lane rows, agent availability, and a deterministic bottleneck sentence"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2347.03-inverted-dwell-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `px checkpoint` ``, or `` `npm test -- test/board-metrics.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test fails against current code | `test/task-2347.03-inverted-dwell-repro.test.ts`, `"dwell time between backlog->active and active->review is attributed to active"` | PASS |
| LaneInterval type defined | `src/application/projections/metrics.ts:228` | PASS |
| medianCycleTimeByStateSeries uses intervals | `src/application/projections/metrics.ts:230` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/projections/mission-board.ts` — board lane structure and lane-counting logic unchanged
- `src/application/projections/board.ts` — `allLanes` constant and lane row rendering unchanged
- `src/interfaces/tui/flow-panel.tsx` — UI consumers of `medianCycleTimeByState` unchanged; only metric values shift
- `src/domain/mission-workflow.ts` — `MissionTransition` type and `decideMission` unchanged
- `test/board-event-guardrail.test.ts` — guardrail test from task-2347.02, unchanged

## Stop Rules
- Do not rewrite `medianAgeByLaneSeries` (uses last-transition timestamp, not interval-based) — defer to task-2347.06
- Do not persist `LaneInterval` as a materialized table — compute on demand
- Do not modify throughput/completion metrics — defer to task-2347.04
- If `buildMetrics` callers beyond `metrics.ts:325` and the two test files are found, note in mission evidence and scope accordingly
- No `.only` or bare `.skip` tests in final tree

Reproduction-Test: test/task-2347.03-inverted-dwell-repro.test.ts
