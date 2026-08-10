# CP-1 — Red SQLite-block selection regression

Added the isolated reproduction test. Its mocked SQLite availability marks `codex` blocked while the supplied JSON configuration remains unblocked; the legacy selector nominates `codex`, producing the required red assertion. No production selection code changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: stale JSON can nominate a SQLite-blocked agent before the fix | `test/task-2351-agent-selection-snapshot-repro.test.ts:6`; `npx tsx --test test/task-2351-agent-selection-snapshot-repro.test.ts` fails with `'codex' !== 'claude'` | Red recorded |
| SC2: SQLite-backed snapshot adapter supplies runtime blocks | `src/application/domain-ports.ts:103`; `test/task-2351-agent-selection-snapshot-repro.test.ts:7` | Pending CP-2 |
| SC3: review-loop excludes a blocked reviewer before launch | `src/adapters/review/review-loop.ts:735` | Pending CP-3 |
| SC4: CLI callers use prepared snapshots | `src/adapters/cli/commands/handoff.ts:748` | Pending CP-3 |
| SC5: outcome labels are observable | `src/adapters/agents/agents.ts:312` | Pending CP-4 |
| SC6: policy behavior for unblocked and exhausted pools remains covered | `test/domain-agent-selection.test.ts` | Pending CP-3 |
| SC7: repository verifier passes | `./scripts/verify-local.sh all` | Pending CP-4 |

Next action: Implement the SQLite-backed `AgentSelectionSnapshotPort` and isolated active/expired-block, launcher, and policy tests in CP-2.
