# CP-1: Map AgentBlock authority and consumers

## Summary

Mapped the current split authority before changing behavior. The legacy runtime
path merges `agents.local.json` into the static policy, resolves block state
there, and writes limit and transient-failure blocks back to that file. The
checked SQLite repository is already used by the board adapter, but its port
still documents the file as authority and its board projection drops reason
and expiry detail. The cutover boundary will be a new application service that
materializes static policy and launcher observations with checked AgentBlock
rows, and returns one family-level block view to runtime selection and all
projections.

Legacy authority paths to retire:

- `readAgentConfig()` merges and migrates local blocklists at
  `src/platform/runtime/lib/agents/agent-config.ts:71`.
- `isAgentBlocked()` derives eligibility from that merged configuration at
  `src/platform/runtime/lib/agents/agent-config.ts:134`, and
  `eligibleAgentsForStep()` consumes it at
  `src/platform/runtime/lib/agents/launcher-selection.ts:127`.
- `updateAgentBlock()` writes `agents.local.json` at
  `src/platform/runtime/lib/agents/agent-config.ts:159`; the limit and
  transient-failure callers are at
  `src/platform/runtime/lib/agents/agents.ts:399` and
  `src/platform/runtime/lib/agents/agents.ts:453`.

The retained static configuration responsibilities are step policy in
`config/agents.json` and custom-launcher discovery. They must remain external
inputs; no blocklist field from `agents.local.json` will be read after CP-3.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every production block operation will use the checked repository through an application service rather than the local file | `src/platform/runtime/lib/agents/agents.ts:399`; `src/platform/runtime/lib/agents/agents.ts:453`; `src/adapters/sqlite/ports.ts:38` | MAPPED — CP-3 routes both mutation callers through the new service |
| Legacy import will provide dry-run, atomic/idempotent execution, conflicts, and source immutability | `src/adapters/sqlite/importer.ts:72`; `test/sqlite-importer-cp4.test.ts` | MAPPED — CP-2 replaces the legacy importer contract |
| Production local-file AgentBlock reads and writes are identified for removal while static configuration stays external | `src/platform/runtime/lib/agents/agent-config.ts:71`; `src/platform/runtime/lib/agents/agent-config.ts:159`; `src/platform/runtime/lib/agents/launcher-selection.ts:127` | MAPPED |
| The application query will return reason, expiry, limit, and eligibility without domain SQLite/filesystem dependencies | `src/domain/agents.ts:10`; `src/application/projections/agent-status.ts:9`; `src/adapters/backlog/concrete-agent-read-adapter.ts:71` | MAPPED — CP-3/CP-4 expand this boundary |
| Repository mutation failure will fail closed without stale or file-backed fallback | `src/platform/runtime/lib/agents/agents.ts:401`; `docs/adr/0053-operational-persistence-and-authority-boundaries.md:145` | MAPPED — CP-3 removes the current warn-and-continue branch |
| Required import and lifecycle coverage will be mocked and avoid real agents or Forgejo | `test/sqlite-importer-cp4.test.ts`; `test/agents-limit-hit.test.ts`; `test/domain-agent-selection.test.ts` | MAPPED — CP-2 through CP-4 add focused mocked tests |
| Final mission tree must pass the declared verifier | `./scripts/verify-local.sh all` | PENDING — run in CP-4 |

Next action: implement the CP-2 legacy import service and its dry-run, conflict, transaction, idempotency, and immutable-source tests.
