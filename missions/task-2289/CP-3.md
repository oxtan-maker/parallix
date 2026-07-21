# CP 3 — Adapters, composition root, and boundary guards

## Summary

Added explicit legacy wrappers for stats/configuration/task-Markdown/Git-backed
stats recovery and agent/subprocess/task-Markdown/handoff execution. The only
complete concrete graph is `createProductionApplicationServices`; handlers are
still not wired to it. Repository guards recursively reject prohibited
application dependencies and reject extra complete graphs or service-locator
access, with direct, transitive, composition, and locator violating fixtures.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Explicit stats wrapper keeps legacy stats/task-Markdown/Git behavior outside application | `lib/adapters/legacy-stats-backfill-adapter.ts:1`; `lib/adapters/legacy-stats-backfill-adapter.ts:14` | PASS |
| Explicit active wrapper contains agent, configuration, task-Markdown, and handoff effects | `lib/adapters/legacy-active-adapter.ts:1`; `lib/adapters/legacy-active-adapter.ts:22`; `lib/adapters/legacy-active-adapter.ts:27` | PASS |
| One named production root assembles the complete concrete graph | `lib/composition/application-services.ts:12`; `"composition guard accepts the sole production composition root"` | PASS |
| Import guard detects direct and transitive prohibited dependencies | `lib/architecture/boundary-guards.ts:16`; `"application import guard rejects direct prohibited dependency fixture"`; `"application import guard rejects transitive prohibited dependency fixture"` | PASS |
| Wiring guard rejects extra graphs and service locator access | `lib/architecture/boundary-guards.ts:34`; `"composition guard rejects complete adapter construction fixture"`; `"composition guard rejects service-locator access fixture"` | PASS |
| New boundary code remains independent of CLI handler delegation | `lib/commands/stats-backfill.ts:355`; `lib/commands/active.ts:24` | PASS |
| Focused boundary tests pass | `node test/run-default-tests.js test/application-boundaries.test.ts` | PASS |

Next action: run the focused contract, service, and boundary tests, then record final verification and rollback evidence.
