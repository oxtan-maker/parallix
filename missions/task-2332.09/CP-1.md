# CP-1: Define handoff workflow ports and use case class

## Summary

Created the application-owned port boundary and use case class for the handoff
workflow, following the integrate pattern from TASK-2332.07.

- `src/application/ports/handoff-workflow.ts` — `HandoffWorkflowPort` interface
  with `execute(args, options)` method. Covers all adapter operations: verification,
  rebase, NEL capture, gatekeeper, Forgejo PR, review assignment, lifecycle
  transition, checkpoint recording, and backlog sync.
- `src/application/handoff-command-use-case.ts` — `HandoffCommandUseCase` class
  accepting `HandoffWorkflowPort` via constructor injection. Delegates all
  workflow sequencing to the port. Imports no concrete adapter modules.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff workflow port defined | `src/application/ports/handoff-workflow.ts:4` — `HandoffWorkflowPort` interface with `execute` method | PASS |
| Handoff use case class created | `src/application/handoff-command-use-case.ts:5` — `HandoffCommandUseCase` with constructor injection | PASS |
| Use case imports no adapter modules | `src/application/handoff-command-use-case.ts` — only imports from `./ports/handoff-workflow.js` | PASS |
| Port follows integrate pattern | `src/application/ports/cli-workflows.ts:3` — same `IntegrateWorkflowPort` shape with `execute(args, options)` | PASS |
| Use case follows integrate pattern | `src/application/integrate-command-use-case.ts:5` — same `IntegrateCommandUseCase` class shape | PASS |

Next action: Create `src/interfaces/cli/handoff.ts` with parsing and rendering, update `src/composition/create-cli.ts` wiring, and add mocked-port tests.
