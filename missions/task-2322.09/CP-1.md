# CP 1: SessionMarkerRepository interface, SQLite implementation, and migration

## Summary

Defined the `SessionMarkerRepository` port interface in `src/adapters/sqlite/ports.ts` with five methods (`findByMissionAndRole`, `save`, `deleteByMissionAndRole`, `findAll`, `clear`) and checked read/write data types. Implemented repository-scoped `SqliteSessionMarkerRepository` in `src/adapters/sqlite/session-marker-repository.ts` with parameterized SQL, `ON CONFLICT(repository_id, mission_id, role) DO UPDATE` for idempotent upsert, validated row decoding, and explicit column mapping. Kept the already-exercised `0004-session-markers.sql` immutable and added `0005-repository-scoped-session-markers.sql`, which upgrades it to a strict table with `UNIQUE(repository_id, mission_id, role)` and preserves legacy rows under an explicit unscoped identity. Exported the new types and class from `src/adapters/sqlite/index.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SessionMarkerRepository interface defined with 5 methods | `src/adapters/sqlite/ports.ts` — `findByMissionAndRole`, `save`, `deleteByMissionAndRole`, `findAll`, `clear` | PASS |
| SessionMarkerEntry type with all required fields | `src/adapters/sqlite/ports.ts` — `missionId`, `role`, `agent`, `lastLaunched`, `sessionId`, `updatedAt` | PASS |
| SqliteSessionMarkerRepository implements upsert with ON CONFLICT | `src/adapters/sqlite/session-marker-repository.ts` — `ON CONFLICT(repository_id, mission_id, role) DO UPDATE SET` | PASS |
| Migrations produce the repository-scoped session_markers schema | `src/adapters/sqlite/migrations/0004-session-markers.sql` plus `0005-repository-scoped-session-markers.sql` — strict table with `UNIQUE(repository_id, mission_id, role)` and `CHECK(role IN (...))` | PASS |
| Migration upgrade preserves applied 0004 databases | Test `"upgrades an applied 0004 table without changing 0004 or losing rows"` | PASS |
| No Attempt-shaped type introduced | `test/domain-attempt-guard.test.ts` — 11/11 tests pass | PASS |
| Types exported from sqlite index | `src/adapters/sqlite/index.ts` — `SessionMarkerEntry`, `SessionMarkerRepository`, `SqliteSessionMarkerRepository` | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |

Next action: Wire `SessionMarkerPort` application port in `src/application/domain-ports.ts` and connect it to `SqliteSessionMarkerRepository` through the adapter factory (CP 2).
