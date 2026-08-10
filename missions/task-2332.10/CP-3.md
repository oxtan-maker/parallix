# CP-3: Refactor adapter to implement DraftWorkflowPort, add mocked-port tests

## Summary

Expand `DraftWorkflowPort` with step-level methods (preflight, setup, scaffold, intake, transition, launchAgent, postProcess, commitSafety). Add `createDraftWorkflowAdapter` factory to adapter module. Create mocked-port unit test suite covering normal draft, missing slug, intake conflict, and classification restart paths — all using injected function doubles without real git/agent/CLI calls.

## Changes

- `src/application/ports/cli-workflows.ts`: Expanded `DraftWorkflowPort` from 1 method (`execute`) to 9 methods covering full workflow sequence
- `src/application/draft-command-use-case.ts`: Updated use case with documentation noting workflow sequence ownership through port methods
- `src/adapters/cli/commands/draft.ts`: Added `createDraftWorkflowAdapter()` factory returning `DraftWorkflowPort` implementation; added `DraftWorkflowPort` import; preserved all existing named exports and `runDraftCommand` behavior
- `test/draft-command-use-case.test.ts`: New file — 6 mocked-port tests covering normal flow, missing slug exit, intake conflict, classification restart, and options passthrough

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| DraftWorkflowPort defined with workflow methods | `src/application/ports/cli-workflows.ts:7` | PASS |
| DraftCommandUseCase owns workflow sequence | `src/application/draft-command-use-case.ts:4` | PASS |
| DraftCliRequest, parsing, createDraftCommand | `src/interfaces/cli/draft.ts:3`, `src/interfaces/cli/draft.ts:10`, `src/interfaces/cli/draft.ts:35` | PASS |
| Composition wires draft through use case | `src/composition/create-cli.ts:87` | PASS |
| Adapter exports DraftWorkflowPort implementation | `src/adapters/cli/commands/draft.ts:1117` (`createDraftWorkflowAdapter`) | PASS |
| Mocked-port tests: normal draft | `test/draft-command-use-case.test.ts`, `"DraftCommandUseCase.execute handles normal draft flow"` | PASS |
| Mocked-port tests: missing slug exit | `test/draft-command-use-case.test.ts`, `"DraftCommandUseCase.execute handles missing slug exit"` | PASS |
| Mocked-port tests: intake conflict | `test/draft-command-use-case.test.ts`, `"DraftCommandUseCase.execute handles intake conflict path"` | PASS |
| Mocked-port tests: classification restart | `test/draft-command-use-case.test.ts`, `"DraftCommandUseCase.execute handles classification normalization restart"` | PASS |
| Existing draft tests pass | `test/draft-command.test.ts` (76 tests), `test/draft.test.ts`, `test/draft_preflight_modern.test.ts` — all pass | PASS |
| Static analysis clean | `./scripts/verify-local.sh all` — 1915 tests pass, 0 failures, eslint clean | PASS |
| No new focused/skipped tests | `./scripts/verify-local.sh all` — 0 skipped, 0 todo | PASS |

## Next action

Run final mission gate (`./scripts/verify-local.sh all`) and verify all SC criteria met. Write final checkpoint with complete Goal Check.
