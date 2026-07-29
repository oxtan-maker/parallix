# CP-2: Lock current migration-facing behavior

## Summary

Added 25 fast, dependency-mocked characterization tests that preserve the observable
CLI, TUI, and shared board-projection behavior the ADR 0053 migration must retain.
Tests cover BoardProjectionBuilder composition, projection staleness checks,
SessionMarker resume semantics, LaneTransitionEvent trigger derivation,
MissionOutcome statistics derivation, and the authority separation between
TaskIntake/GitObservations (external facts) and Mission lifecycle (database-owned
domain state). No test contacts real Forgejo, launches agents, or runs CLI subprocesses.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Characterization tests run without real Forgejo, real agents, or expensive CLI subprocesses | `test/persistence-characterization.test.ts` — all 25 tests use in-memory mock adapters; no real Forgejo, no agent launch, no `node:child_process`; real `node:fs` use is confined to `os.tmpdir()` and cleaned up in `finally` | PASS |
| Tests assert observable CLI, TUI, and shared board-projection behavior | `test/persistence-characterization.test.ts` "SC3: CLI stats-backfill distinguishes --apply (mutation) from read-only report", "SC3: TUI resolveKnownAgentFamilies reads config/agents.json and returns family list", "SC3: BoardProjectionBuilder composes mocked read adapters into a valid projection", "SC3: checkProjectionStaleness returns fresh when Git HEAD matches" | PASS |
| SessionMarker resume behavior preserved | `test/persistence-characterization.test.ts` "SC3: shouldResume returns true when same agent family and mission", "SC3: shouldResume returns false when different agent family" (5 tests) | PASS |
| LaneTransitionEvent trigger derivation preserved | `test/persistence-characterization.test.ts` "SC3: triggerFromTransition maps all known transitions correctly" (9 transitions) | PASS |
| MissionOutcome statistics derivation preserved | `test/persistence-characterization.test.ts` "SC3: completedMissionStatistics derives correct statistics from closed mission and outcome", "SC3: completedMissionStatistics rejects mismatched mission identity" | PASS |
| Task intake and Git observations remain external inputs/facts | `test/persistence-characterization.test.ts` "SC5: TaskIntake inventory entries are external-fact-or-intake", "SC5: GitObservations inventory entries are external-fact-or-intake", "SC5: Mission and TaskIntake classifications are distinct" | PASS |
| No production authority switch or dual-write introduced | `test/persistence-characterization.test.ts` "SC6: inventory preserves current file-backed default paths for Mission/CheckpointData/Review", "SC6: Configuration entries remain configuration-or-secret", "SC6: Secrets entries remain configuration-or-secret" | PASS |

## Next action

CP 3: Add the direct-SQL and unclassified-durable-file architecture checks, register only staged exceptions from CP 1, then document results and run the repository verification gate.
