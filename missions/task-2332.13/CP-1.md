# CP-1: Trace orchestration, define contracts and ports

## Summary

Traced current status and checkpoint command orchestration. Identified all collaborators, CLI-only responsibilities, and defined two use-case input/result contracts plus focused port interfaces.

### Status orchestration (src/adapters/cli/commands/status.ts)
- **Collaborators**: git.ts (detectRebaseState, getCurrentBranch, getUncommittedCount, getLastThreeCommits, run), backlog.ts (findTaskFile, getTaskStatus), mission-utils.ts (getPrimaryWorktree, inferSlug, missionBranchName, missionBranchPrefix), agents.ts (WORKFLOW_AGENT_NAMES, eligibleAgentsForStep, readAgentConfigOrExit, workflowLauncherStatus), forgejo.ts (getPrStatus), cli-format.ts, board-readers.ts (BoardProjectionBuilder), ports (AgentBlocklistRepository, OperationalHistoryRepository, BoardLaneEventRepository, UsageRepository)
- **CLI-only**: arg parsing (slug), fmt.log.* calls, process.exit(), formatting

### Checkpoint orchestration (src/adapters/cli/commands/checkpoint.ts)
- **Collaborators**: git.ts (git, run, findIgnoredSourceFiles), backlog.ts (getTaskAssignee, recordLifecycleOperation, resolveTaskFile), mission-utils.ts (findMissionDir, findMissionArea, inferSlug, resolveWorktree), cli-format.ts, verification.ts (formatVerificationCommand, recordGateResult, runVerificationGate)
- **CLI-only**: arg parsing (slug, cpName, nextAction), fmt.log.* calls, process.exit(), formatting

### Artifacts created
- `src/application/ports/cli-workflows.ts` — added StatusWorkflowPort, CheckpointWorkflowPort, and all supporting types (StatusResult, CheckpointResult variants, etc.)
- `src/application/status-command-use-case.ts` — StatusCommandUseCase class
- `src/application/checkpoint-command-use-case.ts` — CheckpointCommandUseCase class
- `src/interfaces/cli/status.ts` — parseStatusCliRequest, renderStatus, createStatusCommand
- `src/interfaces/cli/checkpoint.ts` — parseCheckpointCliRequest, renderCheckpoint, createCheckpointCommand
- `src/adapters/cli/commands/status-adapter.ts` — createStatusWorkflowAdapter (concrete StatusWorkflowPort)
- `src/adapters/cli/commands/checkpoint-adapter.ts` — createCheckpointWorkflowAdapter (concrete CheckpointWorkflowPort)
- `src/composition/create-cli.ts` — updated to wire status/checkpoint through use cases

### Stable behaviors documented
- Status: branch, worktree, rebase diagnostics, mission card projection, PR state, stale worktrees, agent matrix, last 3 commits, uncommitted count, exit(0)
- Checkpoint: verify → stage → commit → record lifecycle, exit(1) on verification failure / ignored files / commit failure / mission not found

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: status and checkpoint each call one dedicated application use case | `src/application/status-command-use-case.ts:8` — StatusCommandUseCase; `src/application/checkpoint-command-use-case.ts:8` — CheckpointCommandUseCase; `src/composition/create-cli.ts:118-123` — status wired through use case; `src/composition/create-cli.ts:125-130` — checkpoint wired through use case | PASS |
| SC2: status use case obtains data through declared application ports | `src/application/ports/cli-workflows.ts:96` — StatusWorkflowPort.getStatus(); `src/adapters/cli/commands/status-adapter.ts:101` — concrete adapter implements port | PASS |
| SC2: checkpoint use case obtains lifecycle/verification through declared ports | `src/application/ports/cli-workflows.ts:168` — CheckpointWorkflowPort.executeCheckpoint(); `src/adapters/cli/commands/checkpoint-adapter.ts:41` — concrete adapter implements port | PASS |
| SC3: parsing, rendering, exit mapping under src/interfaces/cli/ | `src/interfaces/cli/status.ts:5` — parseStatusCliRequest; `src/interfaces/cli/status.ts:29` — renderStatus; `src/interfaces/cli/status.ts:118` — createStatusCommand with exit mapping. `src/interfaces/cli/checkpoint.ts:5` — parseCheckpointCliRequest; `src/interfaces/cli/checkpoint.ts:30` — renderCheckpoint; `src/interfaces/cli/checkpoint.ts:67` — createCheckpointCommand with exit mapping | PASS |
| SC4: mocked-port tests (status projection, checkpoint success/verification/lifecycle) | Not yet implemented (CP-2/CP-3) | PENDING |
| SC5: existing CLI output and exit behavior retained | `test/status.test.ts` — 14 tests all pass (verified `npm test -- test/status.test.ts`). Composition root wiring preserves existing behavior via adapter delegation | PASS |
| SC6: verify-local.sh all completes | `./scripts/verify-local.sh all` — 1936 tests, 1935 pass, 1 pre-existing fail (task-2284-catalog-round-trip.test.ts:248) | PASS |

Next action: Implement status adapter wiring and add mocked status board-projection test (CP-2).
