# CP-4: Legacy Status Command Re-implemented Over Projection

## Summary

Re-implemented the legacy `status` command (`src/platform/runtime/lib/commands/status.ts`) to route mission-specific output (backlog status, last checkpoint) through the `BoardProjectionBuilder` over the six concrete read adapters. The operational output (branch, worktree, stale worktrees, agent matrix, commits) remains as-is because it is not part of the board projection model.

The projection is built via dynamic imports (`await import()`) for CJS rollback bundle compatibility — the `application/` and `adapters/` modules are not in the `dist/` CJS bundle, so they are loaded lazily at runtime. When unavailable, the command falls back to parse primitives.

The dead `status-projection.ts` file has been removed (it was never dispatched and was a duplicate of the legacy status logic). The single-path guardrail test confirms it no longer exists.

## Output Contract (SC9)

The projection preserves the legacy `px status` output contract via new domain fields:
- **Backlog status**: `Mission.rawStatus` carries the raw backlog value (e.g. "ready", "approved") and `status.ts` prints `card.rawStatus || card.status` — matching the legacy `getTaskStatus()` output.
- **Checkpoint filename**: `CheckpointData.rawFilename` carries the original filename with `.md` extension (e.g. "CP-2.md") — matching the legacy `path.basename(lastCP)` output.
- **Checkpoint description**: `CheckpointData.firstLine` carries the first line of the checkpoint file, extracted via the `getFirstLine` primitive (`src/platform/runtime/lib/core/mission-utils/paths.ts:251-254`), which strips markdown heading markers (`^#+\s*`) — exactly matching the legacy `getFirstLine(lastCP)` output.

These fields are populated by `ConcreteMissionReadAdapter.buildRecord()` and carried through `projectMissionCard()` into `MissionCard.rawStatus`, `MissionCard.checkpoint`, and `MissionCard.checkpointDescription`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC8: BoardProjectionBuilder wired at real composition root | `src/platform/runtime/lib/commands/status.ts:10`, `src/platform/runtime/lib/commands/status.ts:117`, `test/adapters/single-path-guardrail.test.ts` | PASS |
| SC9: Legacy status command routes mission output through projection | `src/platform/runtime/lib/commands/status.ts:186-208`, `test/adapters/single-path-guardrail.test.ts`, `"SC10: status.ts routes mission output through BoardProjectionBuilder (single-path guardrail)"` | PASS |
| SC9: status-projection.ts removed (dead code eliminated) | `test/adapters/single-path-guardrail.test.ts`, `"SC10: status-projection.ts removed (dead code eliminated)"` | PASS |
| SC9: Output contract preserved (rawStatus, rawFilename, firstLine) | `src/domain/mission.ts:53-55`, `src/domain/checkpoint.ts:12-16`, `src/adapters/backlog/concrete-mission-read-adapter.ts:248-273`, `src/application/projections/mission-board.ts:112-120` | PASS |
| SC12: Parse primitives remain synchronous and unchanged | `src/platform/runtime/lib/tools/backlog.ts`, `src/platform/runtime/lib/core/mission-utils.ts` | PASS |
| Characterization test validates output contract | `test/adapters/status-characterization-cp4.test.ts`, `"status output contract: includes all required sections (with slug)"`, `"status output: raw backlog status preserved via rawStatus (SC9)"`, `"status output: checkpoint format preserved (rawFilename + firstLine) (SC9)"` | PASS |
| Dynamic imports for CJS rollback compatibility | `src/platform/runtime/lib/commands/status.ts:111`, `src/platform/runtime/lib/commands/status.ts:130` | PASS |

**Tests:** `npm test -- test/adapters/single-path-guardrail.test.ts` (3 tests, 0 failures), `npm test -- test/adapters/status-characterization-cp4.test.ts` (11 tests, 0 failures)

Next action: Add single-path guardrail test and repository-wins test; run final verification gates (CP-5).
