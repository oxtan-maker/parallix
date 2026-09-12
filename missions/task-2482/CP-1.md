# CP-1: Map checkpoint command and surviving lifecycle paths

## Summary

Mapped the retired command's registration, help, suggestion, implementation, adapter, use case, and focused tests. Separately mapped the execution prompt and checkpoint context, committed checkpoint-document validation, and handoff evidence validation that must remain after the command is removed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: command exposure is fully traced | `src/composition/create-cli.ts`, `src/interfaces/cli/runtime.ts`, and `test/index.test.ts` | PASS |
| SC2: command-owned implementation and tests are identified | `src/application/checkpoint-command-use-case.ts`, `src/adapters/cli/commands/checkpoint-adapter.ts`, `src/adapters/cli/commands/checkpoint.ts`, `src/interfaces/cli/checkpoint.ts`, and `test/task-1268-checkpoint-no-gate.test.ts` | PASS |
| SC3: execution evidence, commits, and resume paths are identified | `src/adapters/cli/commands/active.ts`, `test/active.test.ts`, and `test/execute-mission-characterization.test.ts` | PASS |
| SC4: review and handoff evidence validation is identified | `src/application/handoff-command-use-case.ts`, `test/handoff.test.ts`, and `test/active.test.ts` | PASS |
| SC5: live guidance references are identified separately from mission history | `AGENTS.md`, `docs/tui-board.md`, `src/domain/README.md`, and `prompts/execute-core.md` | PASS |
| SC6: focused verification targets are identified | `test/index.test.ts`, `test/active.test.ts`, `test/handoff.test.ts`, and `./scripts/verify-local.sh static-analysis` | PASS |

Next action: remove only the command-owned surfaces and update live guidance while retaining the mapped execution and handoff lifecycle paths.
