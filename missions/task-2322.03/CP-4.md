# CP-4: Review correction, effective persistence tests, and final Goal Check

## Summary

Reworked the reviewed implementation after the custom-agent handoff. The
previous database model stored domain collections as unchecked JSON strings,
duplicated KnownRepository cache columns on `missions`, cast query results into
domain types, and used lifecycle status as a concurrency token. It also added
2,510 lines across four CP-numbered database test files and accidentally placed
all of those real-SQLite tests in the default unit category.

The corrected adapter now:

- stores Mission labels, checkpoints, goal-check rows, Review rounds, findings,
  and resolutions in aggregate-owned relational tables with foreign keys and
  checked discriminator columns;
- reconstructs `Mission`, `RepositoryId`, `MissionLabel`, `AgentFamily`,
  `ChangeRevision`, and `ReviewFindingId` through their checked domain
  factories;
- uses the exact loaded Mission version for compare-and-swap, including writes
  that retain the same lifecycle status;
- keeps replaceable repository path/display observations in
  `known_repositories`, while `missions.repository_id` remains the stable
  identity reference;
- commits aggregate child rows and the optional `LaneTransitionEvent` on the
  same connection and transaction.

The four duplicated suites were replaced with one 492-line
`sqlite-mission-store.integration.test.ts` suite. Its nine scenarios cover
schema/domain alignment, complete and nullable round trips, same-status stale
writers, atomic event persistence, repository-cache replacement, prior-schema
upgrade/checksum/interruption behavior, backup/restore, and import/cutover
boundaries. The explicit `.integration.test.ts` convention keeps this
filesystem/SQLite coverage out of `npm test`; the default-suite classifier test
proves the separation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SQLite round trips preserve every checked Mission, CheckpointData, and Review value | `test/sqlite-mission-store.integration.test.ts:219` test "round trips every checked Mission, CheckpointData, and Review value through real rows"; `test/sqlite-mission-store.integration.test.ts:251` test "round trips null optionals, pre-closure done, and closed Mission variants"; `src/adapters/sqlite/mission-serialization.ts:321` `hydrateMission()` | PASS |
| Persistence uses real domain types rather than unchecked JSON/string casts | `src/adapters/sqlite/migrations/0004-mission-aggregate.sql:9`; `src/adapters/sqlite/migrations/0004-mission-aggregate.sql:31`; `src/adapters/sqlite/migrations/0004-mission-aggregate.sql:39`; `src/adapters/sqlite/migrations/0004-mission-aggregate.sql:80`; `src/adapters/sqlite/mission-serialization.ts:321`; `test/sqlite-mission-store.integration.test.ts:165` test "uses normalized domain-shaped tables and keeps repository observations separate" | PASS |
| Stale writers fail through exact optimistic concurrency without partial aggregate changes | `src/adapters/sqlite/mission-store.ts:218` `persistAggregate()`; `src/adapters/sqlite/mission-store.ts:255` `WHERE id = ? AND version = ?`; `test/sqlite-mission-store.integration.test.ts:286` test "uses exact version compare-and-swap and rejects stale transitions without appending events" | PASS |
| Mission transition and LaneTransitionEvent commit or roll back together | `src/adapters/sqlite/mission-store.ts:146` `saveWithTransition()` begins the shared transaction and appends the event at `src/adapters/sqlite/mission-store.ts:157`; `src/adapters/sqlite/mission-store.ts:171` rolls it back on failure; `test/sqlite-mission-store.integration.test.ts:355` test "commits a Mission transition and LaneTransitionEvent atomically" | PASS |
| RepositoryId remains Mission identity while KnownRepository path/display are replaceable cache data | `src/adapters/sqlite/migrations/0004-mission-aggregate.sql:9` declares `missions.repository_id`; `src/adapters/sqlite/migrations/0004-mission-aggregate.sql:7` adds replaceable `known_repositories.display_name`; `src/adapters/sqlite/authority-map.ts:154` documents the boundary and `src/adapters/sqlite/authority-map.ts:159` maps the stable reference; `src/adapters/sqlite/mission-store.ts:177` `saveKnownRepository()` replaces cache fields at `src/adapters/sqlite/mission-store.ts:181`; `test/sqlite-mission-store.integration.test.ts:402` test "replaces KnownRepository cache data without changing Mission identity or version" | PASS |
| Clean initialization, prior-schema upgrade, checksum mismatch, interrupted migration, backup, restore, and concurrent access are proven with isolated fixtures | `test/sqlite-mission-store.integration.test.ts:165`; `test/sqlite-mission-store.integration.test.ts:286`; `test/sqlite-mission-store.integration.test.ts:432`; `test/sqlite-mission-store.integration.test.ts:475`; `node --import tsx --test test/sqlite-mission-store.integration.test.ts` | PASS |
| Application/UI layers remain behind ports and production authority is unchanged | `test/sqlite-mission-store.integration.test.ts:498` test "keeps application and UI code behind ports and leaves production authority unchanged"; `src/application/domain-ports.ts`; ADR 0051; ADR 0053 | PASS |
| Non-unit Mission persistence tests cannot activate in the default unit category | `test/run-default-tests.ts:134`; `test/run-default-tests.ts:140`; `test/default-test-suite.test.ts` test "default test runner routes every moved group to integration and excludes it from default"; `node --import tsx --test test/default-test-suite.test.ts` | PASS |
| No production cutover, legacy repair/shadow write, or unchecked entity was introduced | `src/adapters/sqlite/migrations/0004-mission-aggregate.sql`; `test/sqlite-mission-store.integration.test.ts:498`; ADR 0053 | PASS |
| Final verification is captured on the reviewed tree | `node --import tsx --test test/sqlite-mission-store.integration.test.ts`; `node --import tsx --test test/default-test-suite.test.ts`; `npm run typecheck`; `npx tsc --noEmit --project tsconfig.test.json`; `./scripts/verify-local.sh all` — 1,487 tests passed | PASS |

Next action: hand the mission back to review with the round-resolution
artifacts.
