# CP 2 — Authoritative guard

`BoardCommandController` now reads the injected Mission authority before it
accepts an existing-card command. Status and checkpoint/handoff versions are
compared there; missing, unavailable, or failed reads fail closed. The TUI now
submits only the observed request and refreshes/reconfirms on conflict.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Dispatcher owns the authoritative precondition | `src/application/controller/board-controller.ts`, `src/application/domain-ports.ts` | PASS |
| Composition supplies the authoritative read port | `src/composition/production-capabilities.ts`, `src/composition/board-projection.ts` | PASS |
| Stale confirmation conflicts without an effect | `test/task-2425-repro.test.ts`, "authoritative status change rejects confirmation before the effect is called" | PASS |
| UI cannot provide a current mission status to dispatch | `src/application/controller/board-command.ts`, `src/interfaces/tui/shell.tsx` | PASS |
| Boundary follows application and persistence authority rules | ADR 0051, ADR 0053 | PASS |

Next action: run the mission gates and preserve fail-closed and exactly-once coverage in the final checkpoint.
