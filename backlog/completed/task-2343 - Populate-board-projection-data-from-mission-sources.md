---
id: TASK-2343
title: Populate board projection data from mission sources
status: done
assignee:
  - claude
created_date: '2026-07-30 21:18'
updated_date: '2026-08-07 19:10'
labels:
  - bug
  - user_value
dependencies: []
priority: high
ordinal: 82900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `px ui` board renders "unavailable" on nearly every data point because the `BoardProjectionBuilder` and its concrete read adapters do not populate the fields the TUI depends on. The adapters exist as scaffolding — they read from sources that are empty, look for files that don't exist, or have structural mismatches between what they produce and what the projection expects.

This mission populates the missing projection fields by fixing the concrete adapters and ensuring the data sources they read are created by the existing lifecycle commands.

### Current gaps

| Field | Adapter | Root Cause |
|---|---|---|
| `pullRequest` | `ConcreteReviewReadAdapter` | `loadReviewApproval()` builds `kind: 'local-branch'` but `projectMissionCard` only sets `pullRequest` when `kind === 'pull-request'` — structural mismatch, always null |
| `gate` | `ConcreteGateReadAdapter` | Looks for `.workflow/gate-result.json`, `gate-status.txt`, `.gate-status` in mission dirs — none of these files are created by `px checkpoint` or `px integrate` |
| `checkpoint.nextActionText` | `ConcreteMissionReadAdapter` | `getFirstLine()` reads the first line of CP files but `nextActionText` requires parsing the `Next action:` line from the checkpoint body — parser missing |
| `checkpoint.goalCheck` | `ConcreteMissionReadAdapter` | Checkpoint `goalCheck` array is always `[]` — the `## Goal Check` table is not parsed |
| `agentAvailability` | `ConcreteAgentReadAdapter` → SQLite `blocklistRepo` | SQLite agent blocklist table is empty — `px active` limit-hit events are not persisted to it |
| `medianCycleTimeByState` | `ConcreteMetricsReadAdapter` → `laneEventRepo` | `board_lane_events` SQLite table is empty — lifecycle transitions are not recorded to it |
| `operationLog` | `ConcreteOperationLogReadAdapter` → `historyRepo` | `operational_history` SQLite table is empty — operation events are not persisted |

### Required fixes

1. **`pullRequest` structural fix**: Change `ConcreteReviewReadAdapter.loadReviewApproval()` to emit `kind: 'pull-request'` with PR number when the review has a Forgejo PR reference, or change `projectMissionCard` to accept `local-branch` changes as pull requests when they have a PR number.

2. **Gate file creation**: Either (a) have `px checkpoint` write a gate-status file to the mission directory, or (b) change `ConcreteGateReadAdapter` to derive gate status from the checkpoint document's Goal Check table (which already records gate pass/fail).

3. **Checkpoint parsing**: Extend `ConcreteMissionReadAdapter` to parse `Next action:` lines and `## Goal Check` tables from checkpoint markdown files.

4. **SQLite persistence**: Ensure `px active`, `px checkpoint`, `px review`, and `px integrate` persist their events to `board_lane_events`, `operational_history`, and `agent_blocklist` tables so the metrics and agent availability adapters have data.

Target: every card on the board shows real checkpoint, gate, PR, and agent data instead of "unavailable" when the mission has gone through at least one lifecycle step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `pullRequest` is non-null on cards whose mission has a review with a Forgejo PR reference; the card renders `PR #N` instead of `PR unavailable`
- [ ] #2 `gate` is `'passed'`, `'failed'`, or `'unknown'` (not always `'unknown'`) for missions that have checkpoint documents with gate evidence
- [ ] #3 `checkpoint.nextActionText` contains the text from the `Next action:` line of the latest checkpoint file; the card renders it instead of `next: unavailable`
- [ ] #4 `checkpoint.goalCheck` is a non-empty array when the checkpoint document contains a `## Goal Check` table
- [ ] #5 `agentAvailability` contains at least one entry with correct `available` and `blockedForMs` values when any agent has a recorded usage-limit block
- [ ] #6 `medianCycleTimeByState.series` contains entries with non-null values for lanes that have recorded lane-transition events
- [ ] #7 `operationLog` contains recent entries when lifecycle commands have been executed
- [ ] #8 No new read adapter interfaces are introduced; fixes are within existing adapter implementations and the lifecycle commands that populate their data sources
- [ ] #9 Existing tests pass; new or extended tests cover the adapter fixes with red-to-green evidence
- [ ] #10 `./scripts/verify-local.sh all` completes successfully
<!-- AC:END -->

## Out of Scope

- Changing the `BoardProjection` type shape or `MissionCard` fields
- Adding new SQLite tables (use existing `board_lane_events`, `operational_history`, `agent_blocklist`)
- TUI rendering changes (that is task-2329)
- Forgejo PR number extraction when no Forgejo instance is configured

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
