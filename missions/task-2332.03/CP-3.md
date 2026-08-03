# CP-3 — Adapter implementations and characterization coverage

Updated the SQLite repositories and supporting adapter code to import the
application-owned contracts. Added a characterization assertion that assigns
each SQLite implementation to its capability contract and exercises all seven
repository instances. Existing focused characterizations continue to cover the
six required capability flows without changing storage, migration, or import
behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SQLite implementations satisfy the relocated contracts | `src/adapters/sqlite/blocklist-repository.ts:13`, `src/adapters/sqlite/usage-repository.ts:13`, `src/adapters/sqlite/repository-repository.ts:18`, `src/adapters/sqlite/ui-preferences-repository.ts:13`, `src/adapters/sqlite/operational-history-repository.ts:13`, `src/adapters/sqlite/board-lane-event-repository.ts:15`, `src/adapters/sqlite/session-marker-repository.ts:60` | PASS |
| Contract ownership is characterized at the implementation boundary | `test/sqlite-ports-cp2.test.ts:61`, "implements the six application-owned capability contracts" | PASS |
| Mission-store behavior remains characterized | `test/session-marker-repository.test.ts`, "session identity round-trips without data loss" | PASS |
| Measurements, preferences, catalog, blocklist, and history flows remain characterized | `test/sqlite-ports-cp2.test.ts`, "usage: save and findAll round-trip", "known-repos: save and findById round-trip", "ui-preferences: save and findByKey round-trip", "blocklist: save and findByAgent round-trip", "operational-history: append and findByType" | PASS |
| Operation-history lane event behavior remains characterized | `test/board-event-recorder.test.ts`, "writes a lane-transition event through the BoardLaneEventRepository" | PASS |
| Focused behavior and boundary tests pass | `npm test -- test/sqlite-ports-cp2.test.ts test/task-2322.11-operator-state.test.ts test/session-marker-repository.test.ts test/board-event-recorder.test.ts test/application-boundaries.test.ts` | PASS |

Next action: run the mission static-analysis gate, repair any reported boundary issue, then run the full local verification gate.
