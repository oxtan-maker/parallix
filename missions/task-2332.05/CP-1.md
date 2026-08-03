# CP-1: Inbound command topology and compatibility inventory

The current inbound flow is `src/entry/px.ts` → `src/platform/runtime/px.ts`
→ `src/platform/runtime/index.ts`.  `px.ts` parses target/command arguments and
special-cases `shell-init`, `version`, `review-event`, and `verify-env`; all
other commands enter the static `COMMANDS` registry in `index.ts`.  That
registry directly imports platform command implementations, and its `ui` route
constructs application services before calling the TUI renderer.  The only
`src/interfaces/cli/` file is a transitional re-export of the runtime
dispatcher, explicitly listed in the dependency allowlist.

The supported command matrix is the `KNOWN_COMMANDS` inventory:
`mission-start`, `verify-env`, `verify`, `setup`, `setup-review`, `draft`,
`active`, `status`, `checkpoint`, `review`, `handoff`, `integrate`,
`resolve-conflict`, `rebase`, `stats`, `aliases`, `config`, `diff`, and `ui`.
The outer entry assigns `process.exitCode`, but ordinary runtime dispatch also
accepts an injected `process.exit`; command implementations contain additional
exit calls.  CP-2 must move the dispatch contract to a result-returning
application-facing dispatcher with mandatory stale validation before invoking
each registered route.  CP-3 must migrate the remaining command adapters and
remove the CLI re-export.  `src/platform/runtime/` cannot yet be removed:
its composition root and operational helpers remain concrete owners beyond the
dispatcher migration; its post-migration boundary will be retained only for
those platform responsibilities.

The existing `test/task-2322-05-cli-characterization.test.ts` is deliberately
listed only as prior, cross-mission characterization evidence: its header is
TASK-2322.05 and it covers `checkpoint` plus handoff NEL capture, not this
mission's complete command matrix. CP-4 must add this mission's coverage for
the remaining command/output combinations.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| One canonical parser → registry → dispatcher → application-capability path | `src/entry/px.ts:3`, `src/platform/runtime/px.ts:191`, `src/platform/runtime/index.ts:66` | INVENTORIED — CP-2 target identified; current path remains split |
| TUI has no command-implementation import and calls application capabilities | `src/interfaces/tui/ui-command.ts:4`, `src/platform/runtime/index.ts:71` | PARTIAL — renderer accepts capabilities; runtime dispatcher still owns invocation |
| No platform → interfaces dependency | `src/platform/runtime/index.ts:77`, `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:17` | FAILING BASELINE — dispatcher imports TUI interface and allowlist records CLI transition |
| Every canonical route validates stale/concurrent commands | `src/application/controller/board-controller.ts:78`, `src/application/controller/board-controller.ts:196`, `src/application/mission-command-support.ts:99` | INVENTORIED — existing application checks are limited to board dispatch and stale writes; no dispatcher-level mandatory validation contract exists |
| Process exit occurs only at the outer entry boundary | `src/entry/px.ts:7`, `src/platform/runtime/index.ts:156`, `src/platform/runtime/lib/commands/handoff.ts:1269` | FAILING BASELINE — inner dispatcher and command implementations retain exits |
| Transitional CLI re-exports are removed | `src/interfaces/cli/dispatcher.ts:7` | FAILING BASELINE — one transitional re-export remains |
| Text, JSON, and exit-code compatibility are covered for every supported command | `src/platform/runtime/index.ts:41`, `test/task-2322-05-cli-characterization.test.ts`, "SC5 characterization: checkpoint runs the gate, then stages, then commits, in that order" | INVENTORIED — the cited TASK-2322.05 test is prior evidence for checkpoint/handoff only; CP-4 will complete this mission's matrix |
| Required static-analysis and general verification pass | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` | PENDING — final-tree gates are reserved for CP-4 |

Next action: introduce the canonical result-returning registry and dispatcher contract, then add focused normal/stale dispatch tests.
