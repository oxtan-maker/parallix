# CP-2: Implement and wire status application use case and CLI boundary

## Summary

Implemented status application use case, CLI boundary, and mocked-port tests. Status and checkpoint use cases are wired through the composition root. Parsing, rendering, and exit mapping confirmed in `src/interfaces/cli/`.

### Artifacts
- `src/application/status-command-use-case.ts` — StatusCommandUseCase (delegates to StatusWorkflowPort)
- `src/application/checkpoint-command-use-case.ts` — CheckpointCommandUseCase (delegates to CheckpointWorkflowPort)
- `src/interfaces/cli/status.ts` — parseStatusCliRequest, renderStatus, createStatusCommand
- `src/interfaces/cli/checkpoint.ts` — parseCheckpointCliRequest, renderCheckpoint, createCheckpointCommand
- `src/adapters/cli/commands/status-adapter.ts` — createStatusWorkflowAdapter (concrete StatusWorkflowPort wiring git, backlog, forgejo, agents, board-projection)
- `src/adapters/cli/commands/checkpoint-adapter.ts` — createCheckpointWorkflowAdapter (concrete CheckpointWorkflowPort wiring verification, git, backlog, lifecycle)
- `src/composition/create-cli.ts` — status and checkpoint commands wired through use case → adapter chain
- `test/status-command-use-case.test.ts` — 28 mocked-port tests covering status projection, parsing, rendering, exit mapping, checkpoint success/verification failure/lifecycle rejection

### Tests
- 28 new mocked-port tests (all pass, 439ms)
- 14 existing status tests (all pass, no regression)
- Full verifier: 1924 tests, 1923 pass, 1 pre-existing fail

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: status and checkpoint each call one dedicated application use case | `src/application/status-command-use-case.ts:8` — StatusCommandUseCase; `src/application/checkpoint-command-use-case.ts:8` — CheckpointCommandUseCase; `src/composition/create-cli.ts:166-175` — status wired through use case; `src/composition/create-cli.ts:118-123` — checkpoint wired through use case | PASS |
| SC2: status use case obtains data through declared application ports | `src/application/ports/cli-workflows.ts:96` — StatusWorkflowPort.getStatus(); `src/adapters/cli/commands/status-adapter.ts:101` — concrete adapter; `test/status-command-use-case.test.ts:278` — "StatusCommandUseCase: returns board projection from mocked port" | PASS |
| SC2: checkpoint use case obtains lifecycle/verification through declared ports | `src/application/ports/cli-workflows.ts:168` — CheckpointWorkflowPort.executeCheckpoint(); `src/adapters/cli/commands/checkpoint-adapter.ts:41` — concrete adapter; `test/status-command-use-case.test.ts:442` — "CheckpointCommandUseCase: returns verification failure from mocked port" | PASS |
| SC3: parsing, rendering, exit mapping under src/interfaces/cli/ | `src/interfaces/cli/status.ts:12` — parseStatusCliRequest; `src/interfaces/cli/status.ts:29` — renderStatus; `src/interfaces/cli/status.ts:118` — createStatusCommand. `src/interfaces/cli/checkpoint.ts:10` — parseCheckpointCliRequest; `src/interfaces/cli/checkpoint.ts:30` — renderCheckpoint; `src/interfaces/cli/checkpoint.ts:67` — createCheckpointCommand | PASS |
| SC4: mocked-port tests — status produces board projection | `test/status-command-use-case.test.ts:278` — "StatusCommandUseCase: returns board projection from mocked port"; `test/status-command-use-case.test.ts:309` — "createStatusCommand: renders status and exits 0" | PASS |
| SC4: mocked-port tests — checkpoint success | `test/status-command-use-case.test.ts:428` — "CheckpointCommandUseCase: returns success from mocked port"; `test/status-command-use-case.test.ts:484` — "createCheckpointCommand: renders success and exits 0" | PASS |
| SC4: mocked-port tests — checkpoint verification failure | `test/status-command-use-case.test.ts:442` — "CheckpointCommandUseCase: returns verification failure from mocked port"; `test/status-command-use-case.test.ts:499` — "createCheckpointCommand: renders verification failure and exits 1" | PASS |
| SC4: mocked-port tests — checkpoint lifecycle rejection | `test/status-command-use-case.test.ts:457` — "CheckpointCommandUseCase: returns lifecycle rejection from mocked port" | PASS |
| SC5: existing CLI output and exit behavior retained | `test/status.test.ts` — 14 tests all pass; `test/status-command-use-case.test.ts` — renderStatus matches existing output structure (branch, worktree, rebase, mission, PR, stale worktrees, agent matrix, commits, uncommitted) | PASS |
| SC6: verify-local.sh all completes | `./scripts/verify-local.sh all` — 1924 tests, 1923 pass, 1 pre-existing fail (`test/task-2284-catalog-round-trip.test.ts:248`) | PASS |

Next action: Verify checkpoint adapter integration and full repository gate (CP-3).
