# CP-2: CLI interface module with DraftCliRequest, parsing, createDraftCommand

## Summary

Create `src/interfaces/cli/draft.ts` with `DraftCliRequest` interface, `parseDraftCliRequest()` for `--agent` flag and positional slug parsing, and `createDraftCommand()` factory. Update composition wiring to use factory pattern matching integrate.

## Changes

- `src/interfaces/cli/draft.ts`: New file with `DraftCliRequest`, `parseDraftCliRequest()`, `createDraftCommand()`
- `src/composition/create-cli.ts`: Updated draft wiring to use `createDraftCommand(new DraftCommandUseCase(...))` — use case created once at registry time

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| DraftCliRequest interface defined | `src/interfaces/cli/draft.ts:3` | PASS |
| Parsing function for --agent and slug | `src/interfaces/cli/draft.ts:10` | PASS |
| createDraftCommand factory | `src/interfaces/cli/draft.ts:35` | PASS |
| Composition uses factory pattern | `src/composition/create-cli.ts:87` | PASS |
| No draft behavior change | `./scripts/verify-local.sh all` — 1898 tests pass, 0 failures | PASS |

## Next action

CP-3: Refactor `src/adapters/cli/commands/draft.ts` to implement `DraftWorkflowPort`. Move orchestration from `runDraftCommand` into use case via port methods. Add mocked-port unit tests. Verify all existing tests still pass.
