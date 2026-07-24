# CP-1: Concrete MissionReadAdapter

## Summary

Implemented `ConcreteMissionReadAdapter` (`src/adapters/backlog/concrete-mission-read-adapter.ts`) as the single board materialization path for domain `Mission` objects. The adapter:

- Scans `backlog/tasks|completed|archive/*.md` and deduplicates by frontmatter `id` (preferring tasks > completed > archive)
- Builds `BacklogMissionSnapshot` with integration-base (committed task file) and mission worktree reads
- Delegates to `materializeBacklogMission()` as the single function producing domain `Mission` objects
- Returns `SourceFact[]` for rebuildability tracking
- Supports injectable parse primitives for testability

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `MissionReadAdapter` returns domain `Mission` objects for all tasks in `backlog/tasks|completed|archive/*.md` | `src/adapters/backlog/concrete-mission-read-adapter.ts:127` (`loadAllMissions`), `test/adapters/mission-read-adapter.test.ts`, `"loadAllMissions reads from tasks, completed, and archive stores"` | PASS |
| `loadAllMissions()` implemented | `src/adapters/backlog/concrete-mission-read-adapter.ts:127`, `"loadAllMissions returns missions from tasks store"`, `"loadAllMissions returns missions from completed store"` | PASS |
| `loadMission(id)` implemented | `src/adapters/backlog/concrete-mission-read-adapter.ts:172`, `"loadMission returns mission by id"`, `"loadMission returns null for missing id"` | PASS |
| `getSourceFacts()` returns non-empty source facts | `src/adapters/backlog/concrete-mission-read-adapter.ts:190`, `"getSourceFacts returns non-empty source facts after load"` | PASS |
| `materializeBacklogMission()` is the single materialization function | `src/adapters/backlog/concrete-mission-read-adapter.ts:322`, `src/adapters/backlog/mission-materialization.ts:70` | PASS |
| Integration-base vs worktree reconciliation (ADR 0051) | `src/adapters/backlog/concrete-mission-read-adapter.ts:289-310` (`buildWorktreeRead`, `buildIntegrationBaseRead`), `"uses worktree content when worktree is present"` | PASS |
| All `BacklogMissionMaterializationResult` outcomes covered | `"records unavailable source fact for materialization failures"` (closure-time-missing), `"completed task with closedAt becomes ClosedMission"`, `"found with integration-base content and absent worktree"` | PASS |
| Status mapping from backlog vocabulary | `"status mapping from backlog vocabulary"` (ready->refined, approved->integration) | PASS |
| Deduplication across stores | `"deduplicates task ids across stores preferring lower-priority directory"` | PASS |

**Tests:** `npm test -- test/adapters/mission-read-adapter.test.ts` (13 tests, 0 failures)

Next action: Implement concrete ReviewReadAdapter, GateReadAdapter, AgentReadAdapter, OperationLogReadAdapter, and GitReadAdapter (CP-2).
