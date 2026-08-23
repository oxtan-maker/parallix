# CP-3: TASK-2332.03 — Application ports in their owning layer

## Summary

TASK-2332.03 moved the application's dependency contracts into capability-organized
modules under `src/application/ports/`. This checkpoint verified that layout on the
integrated tree and made two of the child mission's acceptance criteria executable
instead of merely visually true.

Work done in this checkpoint:

- Added three guards to `test/dependency-graph.test.ts`:
  - `every application port module is a capability module that declares contracts`
    — every file under `src/application/ports/` must export at least one contract,
    so the directory cannot silently accumulate helper or implementation modules.
  - `application ports name no storage mechanism in their declarations` — scans
    non-comment lines for `sqlite`, `DatabaseSync`, `StatementSync`, and
    `legacy-storage`. Comments may name a mechanism in order to exclude it; a
    declaration may not.
  - `application ports import no adapter and no storage runtime` — no port module
    may import `node:sqlite` or anything under `src/adapters/`.
- Removed the one mechanism leak the new guard's prose rule tolerates but that had
  no business being there: `DraftWorkflowPort.intake` in
  `src/application/ports/cli-workflows.ts` documented itself as "Materialize mission
  in SQLite"; it now reads "Materialize mission in the operator store", which is what
  the port actually promises.

Verified capability layout of `src/application/ports/`:

| Capability module | Focused coverage |
|---|---|
| `agent-blocklist.ts` | `test/sqlite-ports-cp2.test.ts`, `test/launcher-availability.test.ts` |
| `cli-workflows.ts` | `test/status-command-use-case.test.ts` |
| `execute-mission.ts` | `test/execute-mission-service.test.ts`, `test/execute-mission-characterization.test.ts` |
| `handoff-workflow.ts` | `test/handoff-use-case.test.ts` |
| `mission-measurements.ts` | `test/sqlite-ports-cp2.test.ts`, `test/adapters/board-projection-builder-cp3.test.ts` |
| `mission-store.ts` | `test/session-marker-repository.test.ts`, `test/sqlite-ports-cp2.test.ts` |
| `operation-history.ts` | `test/board-event-recorder.test.ts`, `test/sqlite-ports-cp2.test.ts` |
| `operator-preferences.ts` | `test/sqlite-ports-cp2.test.ts` |
| `rebase-workflow.ts` | `test/rebase-use-case.test.ts` |
| `repository-catalog.ts` | `test/sqlite-ports-cp2.test.ts` |
| `review-workflow.ts` | `test/current-work-publication.test.ts` |

Noted and deliberately not changed: `StatsProjection` / `StatsRow` in
`src/application/ports.ts` and the `Row` type parameter of `StatsWorkflowPort`.
These are stats *view-data* vocabulary, asserted as such by
`stats projections preserve source and staleness labels as view data` in
`test/application-contracts.test.ts`, not persistence-row terminology; renaming them
would churn `src/adapters/cli/commands/stats.ts` and
`src/application/stats-command-use-case.ts` without removing any mechanism coupling.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Application ports are organized by capability in separate files under `application/ports/` | `every application port module is a capability module that declares contracts` in `test/dependency-graph.test.ts`; directory `src/application/ports/` per `ADR 0051` | PASS |
| Application services compile against technology-neutral contracts (no storage types in ports) | `application ports name no storage mechanism in their declarations` and `application ports import no adapter and no storage runtime` in `test/dependency-graph.test.ts` | PASS |
| SQLite adapters implement the application port contracts | `implements the six application-owned capability contracts` in `test/sqlite-ports-cp2.test.ts` | PASS |
| Migration/import contracts stay private to adapters | `application import guard rejects every direct prohibited dependency category` and `application import guard rejects transitive prohibited dependency fixture` in `test/application-boundaries.test.ts`; `boundary guard permits src/adapters/sqlite/ repository adapter path` | PASS |
| Callers bind to the capability ports, not a transitional contract location | Focused per-capability suites listed above, e.g. `test/handoff-use-case.test.ts`, `test/rebase-use-case.test.ts`, `test/execute-mission-service.test.ts`, `test/session-marker-repository.test.ts` | PASS |
| No behavioral change from the relocation | `test/sqlite-ports-cp2.test.ts` round-trip cases (`blocklist: save and findByAgent round-trip`, `known-repos: save and findById round-trip`, `ui-preferences: save upserts existing key`, `operational-history: append and findByType`) | PASS |
| Guard suite green on this tree | `npx tsx --test test/dependency-graph.test.ts` — 34 tests, 34 pass, 0 fail | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Proceed to CP-4 — verify TASK-2332.04's `ExecuteMission` application use
case and confirm `LegacyActiveAdapter` is gone with characterization evidence green,
using `test/execute-mission-characterization.test.ts` and `test/execute-mission-service.test.ts`.
