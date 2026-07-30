# CP 2: SessionMarkerPort application port and adapter wiring

## Summary

Added `SessionMarkerPort` interface to `src/application/domain-ports.ts` with four methods: `find`, `save`, `delete`, and `shouldResume`. The port operates on domain types (`SessionMarker`, `MissionId`, `SessionRole`, `AgentFamily`) from `src/domain/session.ts` and `src/domain/agents.ts`. Implemented `SqliteSessionMarkerAdapter` in `src/adapters/sqlite/session-marker-adapter.ts` that bridges domain types to `SqliteSessionMarkerRepository` storage types. All five repository operations (`findByMissionAndRole`, `save` upsert, `deleteByMissionAndRole`, `findAll`, `clear`) round-trip correctly with domain `SessionMarker` types. The `shouldResume` method delegates to the canonical `shouldResume` function from `src/domain/session.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SessionMarkerPort interface with find, save, delete, shouldResume | `src/application/domain-ports.ts` — `SessionMarkerPort` interface with 4 methods using domain types | PASS |
| SqliteSessionMarkerAdapter implements SessionMarkerPort | `src/adapters/sqlite/session-marker-adapter.ts` — `SqliteSessionMarkerAdapter implements SessionMarkerPort` | PASS |
| findByMissionAndRole round-trips domain SessionMarker | Verified via round-trip test: save → find returns correct `SessionMarker` with all fields | PASS |
| save (upsert) replaces existing marker | Verified via round-trip test: second save with different agent replaces first | PASS |
| deleteByMissionAndRole removes marker | Verified via round-trip test: find returns null after delete | PASS |
| findAll returns all markers | Verified via round-trip test: 3 markers inserted, findAll returns 3 | PASS |
| clear removes all markers | Verified via round-trip test: findAll returns empty after clear | PASS |
| shouldResume true for same family, false for different | Verified via round-trip test: `shouldResume(task-0003, execute, claude) === true`, `shouldResume(task-0003, execute, pi) === false` | PASS |
| role CHECK constraint enforced | Verified via round-trip test: save with `role: 'unknown'` throws | PASS |
| No Attempt-shaped type introduced | `test/domain-attempt-guard.test.ts` — 11/11 tests pass | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |

Next action: Implement dry-run and atomic idempotent import from `.workflow/sessions/` files with conflict detection (CP 3).
