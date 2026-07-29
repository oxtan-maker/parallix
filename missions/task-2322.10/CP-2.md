# CP-2: Add explicit legacy AgentBlock import

## Summary

Added `SqliteImporter.importLegacyBlocklist()` as the dedicated cutover path
for legacy `agents.local.json` block entries. It parses a complete plan before
writing, offers a no-write dry run, preserves matching checked rows on replay,
reports a structured conflict for a differing checked row, and commits inserts
plus the import ledger in one transaction. Invalid and conflicting plans return
a report and make no persistence changes; a database error rolls back. The
source configuration is read only and never backed up, rewritten, renamed, or
deleted by this cutover path.

The existing broad compatibility importer remains untouched for its prior
callers. CP-3 will make this explicit import the only migration path used by
runtime block state.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every production block operation will use the checked repository through an application service rather than the local file | `src/platform/runtime/lib/agents/agents.ts:399`; `src/adapters/sqlite/ports.ts:38` | PENDING — CP-3 mutation routing |
| Legacy import provides dry-run, atomic/idempotent execution, conflict reporting, and immutable source configuration | `src/adapters/sqlite/importer.ts:83`; `"legacy AgentBlock import dry run reports rows without persistence or source mutation"`; `"legacy AgentBlock import is atomic and idempotent for a valid unchanged replay"`; `"legacy AgentBlock import reports canonical conflicts and leaves the database untouched"` | PASS |
| Production local-file AgentBlock reads and writes are removed while static configuration stays external | `src/platform/runtime/lib/agents/agent-config.ts:71`; `src/platform/runtime/lib/agents/agent-config.ts:159` | PENDING — CP-3 retirement |
| The application query returns reason, expiry, limit, and eligibility without domain SQLite/filesystem dependencies | `src/domain/agents.ts:10`; `src/application/projections/agent-status.ts:9` | PENDING — CP-3/CP-4 shared query |
| Repository mutation failure fails closed without stale or file-backed fallback | `"legacy AgentBlock import rolls back a repository failure without a partial commit"`; `src/adapters/sqlite/importer.ts:162` | PASS for import; runtime routing pending CP-3 |
| Required import and lifecycle coverage is mocked and never launches agents or contacts Forgejo | `test/task-2322-agent-block-import.test.ts`; `"legacy AgentBlock import fails clearly when configuration is missing"` | PASS for CP-2 import coverage |
| Final mission tree passes the declared verifier | `npm run typecheck`; `./scripts/verify-local.sh all` | PENDING — final gate in CP-4 |

Next action: replace runtime `updateAgentBlock` and local eligibility reads with a fail-closed checked-repository application service.
