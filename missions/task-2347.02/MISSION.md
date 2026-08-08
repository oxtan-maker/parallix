# Mission: Close the gaps in the lifecycle event stream (task-2347.02)

## Goal
Make every lifecycle state change — mission intake (entry into `backlog`), `integration → done`, and closure — produce a `board_lane_events` row through a single transition-aware persistence path, and replace the wall-clock idempotency key with a deterministic transition-identity key so replays never duplicate.

## Why Now
Backlog age is unknowable (no entry event), throughput and end-to-end cycle time are truncated (no `integration → done` or closure event), and the final lane dwell of every mission is cut short. Two competing write paths (`backlog.ts` ad-hoc recording vs `SqliteMissionStore.saveWithTransition`) can emit different agents, timestamps, and idempotency keys for the same transition. This mission is a prerequisite for tasks 2347.03–2347.10 which derive metrics from this event stream.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 3 services gain `saveWithTransition` call (intake, integration, closure), 1 idempotency key change in `backlog.ts`, guardrail test update, 4 new red-to-green tests, 1 full-lifecycle integration test

## Scope
- `MissionIntakeService.execute()` — emit lane event on mission creation (entry into `backlog`, `from: null`) via `saveWithTransition` or equivalent transition-aware path
- `MissionIntegrationService.decideIntegration()` — emit lane event for `integration → done` transition
- `MissionIntegrationService.close()` — emit lane event for closure
- Replace time-derived idempotency key in `src/adapters/backlog/backlog.ts` with deterministic key from transition identity (`missionId:trigger:occurredAt` pattern matching `MissionLifecycleService`)
- Retire or delegate the ad-hoc `board_lane_events` recording block in `src/adapters/backlog/backlog.ts` (`transitionTaskOnIntegrationBranch`) so a transition has exactly one recording path
- Update `test/board-event-guardrail.test.ts` to reflect new single-path contract (designated writer shifts from `backlog.ts` to `SqliteMissionStore.saveWithTransition`)
- Red-to-green tests for AC #1–#5

## Out of Scope
- Metric formulas that consume the events (task-2347.03, task-2347.04, task-2347.06)
- Backfilling historical lifecycle events for missions completed before this change
- The mission state machine's allowed transitions (`decideMission` in `mission-workflow.ts`)
- `triggerFromTransition` mapping logic in `src/domain/board-event.ts`
- `BoardLaneEventRepository` schema or SQL queries

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A test in `test/` asserts that `MissionIntakeService.execute()` produces a row in `board_lane_events` with `to_status = 'backlog'` and `from_status = null` for a new mission
- SC2: A test asserts that `MissionIntegrationService.decideIntegration()` produces a row in `board_lane_events` with `to_status = 'done'` and `from_status = 'integration'`
- SC3: A test asserts that `MissionIntegrationService.close()` produces a row in `board_lane_events` for the closure transition
- SC4: A test drives a mission through full lifecycle (backlog → active → review → integration → done → closed) and asserts an ordered lane history with no missing transitions — every state change has a corresponding `board_lane_events` row
- SC5: Exactly one code path writes lane events to `board_lane_events`; the guardrail test in `test/board-event-guardrail.test.ts` fails if any source file outside `SqliteMissionStore` writes lane events directly
- SC6: Replaying the same transition twice appends exactly one row; two distinct transitions with the same `missionId` and `trigger` but different `occurredAt` never collide — asserted by a test
- SC7: `./scripts/verify-local.sh all` passes on the final tree

## Risks and Assumptions
- `MissionIntakeService` uses `MissionStore` (not `MissionTransitionStore`), so the port must be widened or `saveWithTransition` must accept `expectedVersion = null` for inserts. Assumption: widening the port is the cheaper path.
- `backlog.ts` recording block uses dynamic imports and its own database handle; retiring it means the markdown transition path must delegate to `SqliteMissionStore.saveWithTransition` instead. Risk: `backlog.ts` is called from CLI commands that may not have the full application composition available.
- `MissionIntegrationService.close()` sets `closedAt` but may not change `status` (closure vs `integration → done` may be the same transition or a separate one). Assumption: closure is a distinct event from the `integrate` transition and both must appear in lane history.
- The guardrail test `test/board-event-guardrail.test.ts` currently whitelists many modules. Its designated-writer assertion must be rewritten to reflect `SqliteMissionStore` as the single writer.

## Checkpoints
- CP 1: Author reproduction test that locks the bug — `test/task-2347.02-repro.test.ts` asserts that a mission created via `MissionIntakeService` has zero `board_lane_events` rows (fails on parent commit), and that `decideIntegration` / `close` also produce no lane event rows. This test is red before any fix and green after CP 2.
- CP 2: Wire `MissionIntakeService`, `MissionIntegrationService.decideIntegration`, and `MissionIntegrationService.close` through `saveWithTransition` so all three emit lane events. Repro test turns green.
- CP 3: Replace time-derived idempotency key in `backlog.ts` with deterministic key. Retire ad-hoc recording block in `transitionTaskOnIntegrationBranch`. Update guardrail test. Verify SC5 and SC6.
- CP 4: Author full-lifecycle integration test (SC4). Run `./scripts/verify-local.sh all`. Final goal check.

Reproduction-Test: test/task-2347.02-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/application/mission-intake-service.ts:83` (must point to an existing file and line)
  2. **Test names** — e.g., `"intake produces backlog-entry lane event"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2347.02-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2347.02-repro.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `node --test test/board-event-recorder.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Intake emits backlog-entry event | `src/application/mission-intake-service.ts:83`, `test/task-2347.02-repro.test.ts`, `"intake produces backlog-entry lane event"` | PASS |
| Integration emits done event | `src/application/mission-integration-service.ts:52`, `test/task-2347.02-repro.test.ts` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/domain/mission-workflow.ts` — `decideMission` state machine and allowed transitions are not in scope
- `src/domain/board-event.ts` — `triggerFromTransition` mapping and `LaneTransitionEvent` interface are not in scope
- `src/adapters/sqlite/board-lane-event-repository.ts` — repository SQL and schema are not in scope
- `src/application/projections/` — metric derivation consumers (tasks 2347.03–2347.10) are not in scope
- `src/domain/mission.ts` — `intakeMission`, `closeMission`, and `Mission` aggregate shape are not in scope

## Stop Rules
- Do not modify `decideMission` or add new transitions to the state machine
- Do not change `LaneTransitionEvent` interface fields or `triggerFromTransition` mapping
- Do not add backfill logic for historical missions
- Do not modify metric consumers (`board-readers.ts`, `metrics-read-adapter.ts`)
- If `MissionIntakeService` port widening requires changes to `MissionTransitionStore` interface, keep the change minimal (add `saveWithTransition` with nullable `expectedVersion`); do not redesign the port hierarchy
- If `backlog.ts` cannot be fully retired (CLI composition constraint), delegate its recording to `SqliteMissionStore.saveWithTransition` rather than duplicating the insert logic
