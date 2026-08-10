# CP-2 — SQLite-backed snapshot preparation

Implemented `SqliteAgentSelectionSnapshotAdapter`, the concrete `AgentSelectionSnapshotPort`. It reads active runtime block state through `AgentBlockService` and the SQLite blocklist repository, then captures launcher status and static step policy into one snapshot. The adapter does not read JSON blocklist data for runtime block decisions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: stale JSON regression is locked | `test/task-2351-agent-selection-snapshot-repro.test.ts:6`; `npx tsx --test test/task-2351-agent-selection-snapshot-repro.test.ts` | Red retained until CP-3 wiring |
| SC2: concrete adapter uses SQLite runtime blocks and captures selection inputs | `src/adapters/agents/agent-selection-snapshot.ts:34`; `src/adapters/agents/agent-selection-snapshot.ts:49`; "SQLite snapshot adapter materializes active blocks, launcher status, and step policy"; "SQLite snapshot adapter treats expired SQLite block as selectable without reading JSON blocklist" | Passed |
| SC3: review-loop excludes a blocked reviewer before launch | `src/adapters/review/review-loop.ts:735` | Pending CP-3 |
| SC4: CLI callers use prepared snapshots | `src/adapters/cli/commands/handoff.ts:748` | Pending CP-3 |
| SC5: outcome labels are observable | `src/adapters/agents/agents.ts:312` | Pending CP-4 |
| SC6: policy behavior for unblocked and exhausted pools remains covered | `test/domain-agent-selection.test.ts` | Pending CP-3 |
| SC7: repository verifier passes | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: Inject one prepared snapshot into the review-loop and each legacy CLI selection caller, then add mocked pre-launch and fallback coverage in CP-3.
