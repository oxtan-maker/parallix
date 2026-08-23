# CP-5: TASK-2332.05 — One canonical inbound command-dispatch path

## Summary

TASK-2332.05 consolidated CLI and TUI command entry onto `BoardCommandController`
(`src/application/controller/board-controller.ts`). This checkpoint verified the
convergence on the integrated tree. The TUI receives a progress-bound controller
while both surfaces retain the same canonical dispatch path.

Verified state:

- The canonical path is parse → controller → application capability. CLI parsing
  lives in `src/interfaces/cli/` (real parse/render modules such as
  `parseActiveCliRequest` / `renderActiveProgress`, not transitional re-export
  shims), the TUI issues commands through `src/application/controller/board-command.js`,
  and both reach the same `BoardCommandController` constructed once in
  `src/composition/production-capabilities.ts`.
- The TUI imports only `src/application/**`, `src/domain/**`, and its own
  `src/interfaces/tui/**` modules — no command implementation module, no adapter.
- Exit handling stays at the outer boundary: `src/composition/create-cli.ts`
  injects an `exitFn` that captures a code, then sets `process.exitCode`; the
  entrypoint `src/entry/px.ts` likewise sets `process.exitCode`. Neither the
  dispatch path nor the controller calls `process.exit`.
- Stale-command validation is part of dispatch, not of each caller:
  `BoardCommandController.dispatchWithStatus` compares the mission status captured
  at request time against current status and returns a conflict result.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Exactly one canonical command-dispatch path serves both surfaces | `CLI active command dispatches through BoardCommandController` and `TUI dispatches through same BoardCommandController type` in `test/command-dispatch-convergence.test.ts`; `production composition delivers a board controller that publishes to the wired recorder` in `test/task-2387-board-current-work.test.ts` verifies the TUI progress sink | PASS |
| CLI reaches the canonical dispatcher | `CLI active command dispatches through BoardCommandController` in `test/command-dispatch-convergence.test.ts`; `production composition gives CLI and TUI identical board and active capability instances` in `test/production-composition-capabilities.test.ts` | PASS |
| TUI reaches the canonical dispatcher with live progress | `TUI dispatches through same BoardCommandController type` in `test/command-dispatch-convergence.test.ts`; `production composition delivers a board controller that publishes to the wired recorder` in `test/task-2387-board-current-work.test.ts` | PASS |
| Dispatch targets application use cases, not raw ports | `BoardCommandController wraps ExecuteMissionService (not raw ports)` in `test/command-dispatch-convergence.test.ts`; `board controller uses ExecuteMissionService for active:execute dispatch` in `test/board-no-bypass.test.ts` | PASS |
| TUI does not depend on command implementation modules | `board controller does not import any legacy command handler` and `board controller and projections do not import forbidden dependencies` in `test/board-no-bypass.test.ts`; `controller does not import ink, react, or node:react` in `test/board-controller.test.ts`; `dependency graph validates interfaces layer imports without unallowlisted violations` in `test/dependency-graph.test.ts` per `ADR 0051` | PASS |
| No retired `platform` layer reaches `interfaces` | `repository has no retired src/platform paths` and `platform-path guard rejects a production legacy directory even without an import edge` in `test/dependency-graph.test.ts` | PASS |
| Normal dispatch always performs stale-command validation | `dispatchWithStatus rejects stale command with conflict kind` and `dispatchWithStatus proceeds when status matches` in `test/board-controller.test.ts` | PASS |
| Dispatch enforces capability boundaries rather than silently passing unknown commands | `controller rejects draft:create with capability kind`, `controller rejects review:submit with capability kind`, `controller rejects integrate:merge with capability kind`, `UNAVAILABLE_CAPABILITIES has reasons for all five unextracted commands` in `test/board-controller.test.ts` | PASS |
| Concurrency/cancellation semantics survive consolidation | `cancellation before launch returns cancelled outcome`, `controller passes cancellation to ExecuteMissionService for post-boundary cancellation`, `progress events have monotonically increasing sequence numbers` in `test/board-controller.test.ts` | PASS |
| Process exit handling stays at the outermost entry boundary | `src/entry/px.ts` and `src/composition/create-cli.ts` set `process.exitCode` and inject `exitFn`; `dependency graph validates entry layer imports without unallowlisted violations` in `test/dependency-graph.test.ts` | PASS |
| Transitional `interfaces/cli` re-exports are gone; each module owns a real contract | `CLI interface factories parse requests and delegate through injected workflow runners` and `CLI interface parsing and rendering exports preserve each command contract` in `test/cli-interface-migration.test.ts` | PASS |
| Dispatch suites green on this tree | `npx tsx --test test/command-dispatch-convergence.test.ts test/board-controller.test.ts test/board-no-bypass.test.ts test/cli-interface-migration.test.ts` — 28 tests, 28 pass, 0 fail | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Proceed to CP-6 — remove residual migration scaffolding, guard against
its reintroduction, reconcile `docs/adr/0051-ui-neutral-application-boundary.md` and
`docs/adr/0053-operational-persistence-and-authority-boundaries.md` with the executable
graph, then run the final certification gates `./scripts/verify-local.sh static-analysis`
and `./scripts/verify-local.sh all`.
