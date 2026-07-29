# CP-3: Complete round trips, stale writers, and transaction failures

> Historical checkpoint: the original expected-status implementation and
> duplicated CP test files recorded below were superseded by the exact-version
> adapter and consolidated integration coverage in `CP-4.md`.

## Summary

Added 13 red/green tests for complete round trips with complex domain data, stale writer edge cases, and injected transaction failures. Round-trip tests cover: complete Review with changes-requested decision and implementer resolution (including ReviewFinding with location), Review with approved decision and provider/local source, Review with human intervention, multiple CheckpointData with GoalCheck rows, ClosedMission with closedAt, and Mission with null assignee/NEL. Stale writer tests prove checkpoint and review updates are rejected when expected status is wrong, and that a correct save after stale rejection preserves state. Transaction failure tests prove that `saveWithTransition` rolls back both the mission state and the event when a stale write fails, leaving neither a new state nor a history-only event. A multi-transition test validates the full lifecycle (backlog → active → review → integration) with consistent state and event history.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SQLite round-trip preserves repositoryId, status, rawStatus, assignee, labels, closedAt, CheckpointData, Review | `test/sqlite-mission-store-cp3.test.ts` "round-trip preserves complete Review with changes-requested decision and resolution"; "round-trip preserves multiple CheckpointData with GoalCheck rows"; "round-trip preserves ClosedMission with closedAt"; "round-trip preserves Mission with null assignee and null NEL" | ✅ Pass |
| Stale writer rejected; rejection leaves aggregate/history unchanged | `test/sqlite-mission-store-cp3.test.ts` "stale writer on checkpoint update is rejected"; "stale writer on review update is rejected"; "successful save after stale rejection restores correct state" | ✅ Pass |
| Mission transition + LaneTransitionEvent commit atomically; failure leaves neither changed | `test/sqlite-mission-store-cp3.test.ts` "injected failure in saveWithTransition leaves mission state unchanged"; "injected failure prevents partial event-only persistence"; "successful saveWithTransition persists both state and event" | ✅ Pass |
| RepositoryId stable; KnownRepository replaceable | `test/sqlite-mission-store-cp1.test.ts` "RepositoryId remains stable across saves while KnownRepository can change"; `src/adapters/sqlite/authority-map.ts:163` `MISSIONS_AUTHORITY` | ✅ Pass |
| Clean install proven | `test/sqlite-mission-store-cp2.test.ts` "clean install creates missions table with correct schema" | ✅ Pass |
| Prior-schema upgrade proven | `test/sqlite-mission-store-cp2.test.ts` "upgrade from prior schema (0003) creates missions table" | ✅ Pass |
| Checksum mismatch detection proven | `test/sqlite-mission-store-cp2.test.ts` "detects checksum mismatch for mission migration 0004" | ✅ Pass |
| Interrupted migration recovery proven | `test/sqlite-mission-store-cp2.test.ts` "interrupted migration 0004 is rolled back and can be retried" | ✅ Pass |
| Backup proven | `test/sqlite-mission-store-cp2.test.ts` "backup before irreversible migration 0004 creates a .bak file"; "backup preserves missions data for recovery" | ✅ Pass |
| Restore proven | `test/sqlite-mission-store-cp2.test.ts` "recoverFromBackup restores missions table after corruption" | ✅ Pass |
| Concurrent access proven | `test/sqlite-mission-store-cp2.test.ts` "concurrent writes to missions table are serialized by SQLite WAL"; "concurrent stale writes are each rejected independently" | ✅ Pass |
| Import-boundary coverage | `test/domain-import-boundary.test.ts` "SC1: no src/domain file imports a forbidden infrastructure module"; `test/sqlite-adapter-cp1.test.ts` "no module under src/platform/runtime/lib imports node:sqlite (SC2 negative)" | ✅ Pass |
| No production cutover or unchecked-entity schema | `src/adapters/sqlite/migrations/0004-mission-aggregate.sql` contains only `missions` table; no Attempt/task catalog/worktree/process tables | ✅ Pass |

Next action: Add import-boundary coverage proving application and UI layers use repository ports rather than importing the SQLite adapter or issuing SQL; verify no production cutover or unchecked-entity schema was introduced; run the required gate; document final Goal Check evidence (CP-4).
