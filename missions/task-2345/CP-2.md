# CP-2: Unified runtime and local block authority

## Summary

Added `resolveAgentBlockAuthority`, which applies a runtime SQLite block unless
an explicit effective local blocklist entry overrides it. The launcher now
awaits this authority, and the board applies it to the SQLite state it reads
for each family. Explicit local unblocks therefore clear SQLite blocks in both
views.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SQLite runtime block blocks the launcher seam | `test/task-2345-repro.test.ts`, `"block persisted via updateAgentBlockChecked makes defaultIsAgentBlockedNow return true"` | PASS |
| Local-only and SQLite-only blocks have the same authority result | `test/task-2345-repro.test.ts`, `"local-only and SQLite-only blocks both resolve as blocked"` | PASS |
| Explicit local unblock clears a SQLite block | `test/task-2345-repro.test.ts`, `"explicit local unblock overrides a SQLite block"` | PASS |
| Board applies the shared authority to its SQLite snapshot | `src/adapters/backlog/concrete-agent-read-adapter.ts`, `test/task-2345-repro.test.ts` | PASS |
| Existing sync configuration seam remains synchronous | `test/sqlite-async-cascade-cp3.test.ts`, `"agent-config.ts consumer functions are not async"` | PASS |

Next action: Document the SQLite/local precedence contract and run the full mission verification gate.
