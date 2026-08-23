# CP-2: TASK-2332.02 — One production composition boundary

## Summary

TASK-2332.02 established `src/composition/` as the single production composition
root. This checkpoint verified that boundary on the integrated tree and added the
one missing executable proof the mission names explicitly: a negative fixture
showing that an adapter importing a composition module is a graph violation.

Work done in this checkpoint:

- Added `dependency graph rejects an adapter import of a canonical composition module`
  to `test/dependency-graph.test.ts`. The permitted-target table in
  `src/adapters/architecture/boundary-guards.ts` (`allowedDependencyGraph`) already
  omits `composition` from the `adapters` row, but until now only the
  `interfaces → composition` direction had a negative fixture; the adapter
  direction was covered only indirectly by the whole-tree production scan, which
  cannot fail on a rule that was accidentally loosened.

Verified state of the composition boundary:

- `src/composition/` holds `application-services.ts`, `board-projection.ts`,
  `create-cli.ts`, `operator-state-lifecycle.ts`, `production-capabilities.ts`,
  `review-persistence.ts` — object wiring and lifecycle only, as documented in
  `src/composition/README.md`.
- `entry` may reach `composition` and `interfaces`; no other layer may reach
  `composition` at all.
- The operator database has one process-lifetime open/close path, owned by
  composition (`registerOperatorStateShutdown` in
  `src/composition/operator-state-lifecycle.ts`), idempotent per process.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Exactly one production composition root exists and is recognized as such | `composition guard accepts the sole production composition root` in `test/application-boundaries.test.ts`; `src/composition/README.md` per `ADR 0051` | PASS |
| No adapter module imports `composition/**` | `dependency graph rejects an adapter import of a canonical composition module` and `dependency graph production scan has no violation outside the owned allowlist`, both in `test/dependency-graph.test.ts` (`allowedDependencyGraph.adapters` omits `composition`) | PASS |
| No interface module reaches into composition | `dependency graph rejects an interface import of a canonical composition module` in `test/dependency-graph.test.ts` | PASS |
| No application module imports a concrete adapter implementation | `application import guard rejects every direct prohibited dependency category`, `application import guard rejects transitive prohibited dependency fixture`, and `application import guard detects a newly added violating file without modifying the test` in `test/application-boundaries.test.ts` | PASS |
| Only composition constructs the complete adapter graph | `composition guard rejects complete adapter construction fixture` and `composition guard rejects service-locator access fixture` in `test/application-boundaries.test.ts`; `responsibility guard fails complete-graph construction outside the composition root` in `test/dependency-graph.test.ts` | PASS |
| No interface module opens or migrates SQLite | `boundary guard rejects node:sqlite builtin import` and `boundary guard permits src/adapters/sqlite/ repository adapter path` in `test/application-boundaries.test.ts` | PASS |
| One operator-database lifecycle per CLI process | `composition-owned operator-state shutdown registers only one hook pair per process`, `composition-owned operator-state shutdown uses the asynchronous close path before normal exit`, and `composition-owned operator-state shutdown calls the synchronous close path on forced process exit` in `test/operator-state-lifecycle.test.ts` | PASS |
| CLI and TUI share the same constructed capability instances | `production composition gives CLI and TUI identical board and active capability instances` in `test/production-composition-capabilities.test.ts` | PASS |
| Boundary suites green on this tree | `npx tsx --test test/dependency-graph.test.ts` (31 pass, 0 fail) and `npx tsx --test test/production-composition-capabilities.test.ts test/application-boundaries.test.ts test/operator-state-lifecycle.test.ts` (14 pass, 0 fail) | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Proceed to CP-3 — verify TASK-2332.03's capability-organized
application ports under `src/application/ports/` and confirm callers bind to those
ports rather than transitional contract locations, using `test/application-contracts.test.ts`.
