# CP-4 — Full-lifecycle history, docs, and the mission gate

## Summary

- **SC4 test added.** `test/task-2347.02-lifecycle-history.test.ts` drives one
  mission through intake → `active` → `review` → `integration` → `done` →
  closure using only the application use cases against a real migrated SQLite
  fixture, then replays `board_lane_events` and asserts the exact six-row
  history. Beyond the literal expectation it walks the rows and asserts the
  chain itself: each row's `from_status` equals the previous row's `to_status`
  (starting from `null`) and `occurred_at` strictly increases — a missing
  lifecycle step surfaces as a break in that chain rather than as a silently
  shorter list.
- **Docs updated (DoD #5).** `docs/tui-board.md:76` no longer claims cycle-time
  data appears only after "any lane transition"; it now names mission intake,
  every lane transition, `integration → done` and closure. `CHANGELOG.md`
  records the behaviour change under Unreleased → Fixed, including the retired
  wall-clock key and the explicit no-backfill note.
- **Gate green.** `./scripts/verify-local.sh all` exits 0 with
  `tests 1819 / pass 1819 / fail 0`; `./scripts/verify-local.sh static-analysis`
  passes all four stages (ESLint, tsc typecheck, test hygiene, test typecheck).
  Two type errors the test typecheck caught (an invalid `SourceFact` source and
  a `Mission` union widening) were fixed in the new tests before the gate ran.

Note on the gate log: lines such as `[FAIL] Verification gate failed for area:
lib` are assertions printed by integration-pipeline test fixtures exercising the
failure path, not gate failures; the run's exit status is 0 and the suite
reports `fail 0`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — intake writes `to_status='backlog'`, `from_status=null` | `src/application/mission-intake-service.ts:92`, `"intake produces a backlog-entry lane event"` | PASS |
| SC2 — `decideIntegration` writes `integration → done` | `src/application/mission-integration-service.ts:65`, `"decideIntegration produces an integration-to-done lane event"` | PASS |
| SC3 — `close` writes a closure event | `src/application/mission-integration-service.ts:97`, `"close produces a closure lane event"` | PASS |
| SC4 — full lifecycle yields a gap-free ordered lane history | `"records a gap-free ordered lane history from backlog entry to closure"`, `test/task-2347.02-lifecycle-history.test.ts` | PASS |
| SC5 — exactly one code path writes lane events | `src/adapters/sqlite/mission-store.ts:246`, `"SC5: only SqliteMissionStore appends lane events"`, `"SC5: the designated writer appends the event inside saveWithTransition"` | PASS |
| SC5 — guardrail fails on a second writer | `test/board-event-guardrail.test.ts` reported `pass 3 / fail 2` against a probe source file containing `board_lane_events` (CP-3) | PASS |
| SC5 — Markdown seam delegates instead of writing | `src/adapters/backlog/backlog.ts:848`, `"SC5: the Markdown transition seam delegates instead of writing its own event"` | PASS |
| SC6 — replay appends one row; distinct transitions never collide | `"replaying one transition appends one row while distinct transitions never collide"`, `src/application/lifecycle-lane-event.ts:48` | PASS |
| SC6 — no wall-clock idempotency key remains | `"SC6: no lane-event idempotency key is derived from the wall clock"` | PASS |
| SC7 / DoD #1 — verification gate ran and passed on the final tree | `./scripts/verify-local.sh all` exits 0, `tests 1819 / pass 1819 / fail 0` | PASS |
| DoD #2 — lint and static analysis clean | `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc typecheck clean, test-hygiene clean, test typecheck clean | PASS |
| DoD #3 — no `.only`, no bare `.skip` introduced | `./scripts/verify-local.sh static-analysis` test-hygiene stage reports no violations across `test/task-2347.02-repro.test.ts`, `test/task-2347.02-lifecycle-history.test.ts`, `test/board-event-guardrail.test.ts` | PASS |
| DoD #5 — docs reflect the behaviour change | `docs/tui-board.md:76`, `CHANGELOG.md` Unreleased → Fixed entry for TASK-2347.02 | PASS |
| DoD #6 — red-to-green reproduction | `test/task-2347.02-repro.test.ts` — `pass 0 / fail 3` at CP-1 on the parent tree, `pass 4 / fail 0` now | PASS |
| Restricted areas untouched | No change to `src/domain/mission-workflow.ts`, `src/domain/board-event.ts`, `src/adapters/sqlite/board-lane-event-repository.ts`, `src/domain/mission.ts` or `src/application/projections/`; the two extra triggers are widened once in `src/application/lifecycle-lane-event.ts:36` | PASS |

Next action: hand the mission to review with the four checkpoint documents and
the four commits (`ea3744a` reproduction, `d302551` service wiring, `f7b6173`
single-writer refactor, plus this checkpoint) committed on
`mission/task-2347.02`.
