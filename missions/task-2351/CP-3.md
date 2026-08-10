# CP-3 — Prepared selection callers

Review-loop reviewer nomination now accepts a materialized `AgentSelectionSnapshotPort` at its async boundary and uses the resulting `PreparedAgentSelection` for initial and retry nominations. Handoff reviewer assignment likewise accepts that prepared selection. The regression test now passes by routing the stale-JSON scenario through the prepared selection.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: stale JSON regression selects the unblocked reviewer | `test/task-2351-agent-selection-snapshot-repro.test.ts:8`; "SQLite-blocked reviewer is not nominated when JSON blocklist is stale (TASK-2351 repro)" | Passed |
| SC2: concrete adapter uses SQLite runtime blocks | `src/adapters/agents/agent-selection-snapshot.ts:49`; "SQLite snapshot adapter materializes active blocks, launcher status, and step policy" | Passed |
| SC3: review-loop uses one prepared selection for nominations | `src/adapters/review/review-loop.ts:739`; `src/adapters/review/review-loop.ts:912` | Passed by injected snapshot path |
| SC4: handoff CLI assignment accepts prepared selection | `src/adapters/cli/commands/handoff.ts:48`; `test/task-2351-agent-selection-snapshot-repro.test.ts:25` | Passed |
| SC5: outcome labels are observable | `src/adapters/agents/agents.ts:312` | Pending CP-4 |
| SC6: unblocked selection and no-selectable behavior remains covered | `test/domain-agent-selection.test.ts:25`; `src/domain/agents.ts:91` | Passed |
| SC7: repository verifier passes | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: Add structured outcome telemetry for nomination, blocked skips, launch failures, and fallback paths, then run the required repository verifier.
