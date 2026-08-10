# CP-1: DraftWorkflowPort, DraftCommandUseCase, composition wiring

## Summary

Define `DraftWorkflowPort` interface and `DraftCommandUseCase` class following the integrate pattern (TASK-2332.07). Wire draft command through use case in composition root. No behavioral change — adapter delegates to `runDraftCommand` as before.

## Changes

- `src/application/ports/cli-workflows.ts`: Added `DraftWorkflowPort` interface with `execute(args, options)` method
- `src/application/draft-command-use-case.ts`: New file — `DraftCommandUseCase` class accepting `DraftWorkflowPort` and delegating to `execute()`
- `src/composition/create-cli.ts`: Wired draft through `DraftCommandUseCase` with `withMissionFactories` wrapper (same pattern as integrate)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| DraftWorkflowPort defined | `src/application/ports/cli-workflows.ts:6` | PASS |
| DraftCommandUseCase owns workflow delegation | `src/application/draft-command-use-case.ts:5` | PASS |
| Composition wires draft through use case | `src/composition/create-cli.ts:86` | PASS |
| No draft behavior change | `./scripts/verify-local.sh all` — 1931 tests pass, 0 failures | PASS |
| Static analysis clean on changed files | `./scripts/verify-local.sh all` — no new errors | PASS |

## Next action

CP-2: Create `src/interfaces/cli/draft.ts` with `DraftCliRequest`, parsing for `--agent` flag and positional slug, and `createDraftCommand()` factory. Move flag parsing from adapter into interface layer.
