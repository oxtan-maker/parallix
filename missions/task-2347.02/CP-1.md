# CP-1 — Reproduction test locks the lifecycle event-stream gaps

## Summary

Authored `test/task-2347.02-repro.test.ts`, a red-to-green reproduction that
drives the three lifecycle steps named in the mission against a real, isolated
SQLite database (one temp database per test, migrations applied by
`SqliteMigrationRunner`) and asserts that each leaves a `board_lane_events` row:

1. `MissionIntakeService.execute()` must record one event with
   `from_status = null` and `to_status = 'backlog'`.
2. `MissionIntegrationService.decideIntegration()` must record one event with
   `from_status = 'integration'`, `to_status = 'done'`, `trigger = 'integrate'`.
3. `MissionIntegrationService.close()` must record one closure event carrying
   the supplied `closedAt` as `occurred_at`.

All three fail on the current tree because `MissionIntakeService` persists with
`this._store.save(mission, null)` (`src/application/mission-intake-service.ts:83`)
and both integration paths persist with `this._store.save(...)`
(`src/application/mission-integration-service.ts:52` and `:70`), so no lane event
is ever appended. Observed failures are the assertion `0 !== 1` on the lane-event
row count for each of the three tests — not a crash or a wiring error.

No production source file was modified in this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists at the mission-declared path | `test/task-2347.02-repro.test.ts` | PASS |
| Intake gap locked (SC1, AC #1) | `"intake produces a backlog-entry lane event"`, `src/application/mission-intake-service.ts:83` | RED (expected) |
| `integration → done` gap locked (SC2, AC #2) | `"decideIntegration produces an integration-to-done lane event"`, `src/application/mission-integration-service.ts:52` | RED (expected) |
| Closure gap locked (SC3, AC #2) | `"close produces a closure lane event"`, `src/application/mission-integration-service.ts:70` | RED (expected) |
| Test is red before the fix (DoD #6) | `npx tsx --test test/task-2347.02-repro.test.ts` reports `tests 3 / pass 0 / fail 3`, each failing on `0 !== 1` lane-event rows | PASS |
| Test is picked up by the default suite | `test/run-default-tests.ts:64` discovers every `test/*.test.ts` not on the excluded list | PASS |
| No focused or bare-skipped tests introduced (DoD #3) | `test/task-2347.02-repro.test.ts` uses `describe`/`it` only — no `.only`, no `.skip` | PASS |

Next action: CP-2 — widen `MissionTransitionStore.saveWithTransition` to accept a
null `expectedVersion` (insert contract) and route `MissionIntakeService.execute`,
`MissionIntegrationService.decideIntegration` and `MissionIntegrationService.close`
through it so all three repro tests turn green.
