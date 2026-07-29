# CP-4: Project checked AgentBlock state and verify

## Summary

The board adapter, CLI board composition, and Ink TUI composition now obtain
AgentBlock availability from the checked repository through `AgentBlockService`.
The projection carries the same reason, expiry instant, limit diagnostic, and
eligibility alongside the existing countdown. ADR 0053 now records the
AgentBlock cutover and the one-time legacy-file role.

Focused mocked tests cover dry run, atomic/idempotent replay, conflicts,
repository failure, expiry, unblock, concurrent updates, restart persistence,
and missing configuration. `./scripts/verify-local.sh all` completed
successfully on this tree.

The synchronous legacy selector still reads `config.blocklist`, so this
checkpoint records the remaining cutover gap explicitly rather than claiming
that all production eligibility callers have moved.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every production block, unblock, expiry, limit, and eligibility decision uses the checked repository through an application service | `src/application/services/agent-block-service.ts:20`; `src/platform/runtime/lib/agents/launcher-selection.ts:127` | PARTIAL — runtime mutation and projections are checked; legacy synchronous selection still reads the local overlay |
| Legacy import supports dry run, atomic/idempotent import, conflicts, and immutable source configuration | `src/adapters/sqlite/importer.ts:83`; `"legacy AgentBlock import dry run reports rows without persistence or source mutation"`; `"legacy AgentBlock import is atomic and idempotent for a valid unchanged replay"`; `"legacy AgentBlock import reports canonical conflicts and leaves the database untouched"` | PASS |
| Production code has no local AgentBlock write or local-path lookup used as block authority | `src/platform/runtime/lib/agents/agent-config.ts:71`; `src/platform/runtime/lib/agents/agent-config.ts:159` | PARTIAL — compatibility implementation remains and must be removed from selection callers |
| CLI, TUI, and board projections consume one application query with reason, expiry, limit, and eligibility | `src/interfaces/tui/ui-command.ts:107`; `src/adapters/backlog/concrete-agent-read-adapter.ts:71`; `src/application/projections/agent-status.ts:12` | PASS for projection consumers |
| Checked mutation failure reports failure without file or stale fallback | `"AgentBlock service exposes repository failures without file fallback"`; `src/application/services/agent-block-service.ts:17` | PASS |
| Mocked tests cover import, expiry, unblock, concurrent updates, restart, missing configuration, and repository failure | `test/task-2322-agent-block-import.test.ts`; `test/task-2322-agent-block-service.test.ts`; `"AgentBlock service reads the same checked block after restart"`; `"legacy AgentBlock import fails clearly when configuration is missing"` | PASS |
| The declared verification gate passes | `./scripts/verify-local.sh all` | PASS |
| Authority documentation reflects the explicit cutover behavior | ADR 0053; `docs/adr/0053-operational-persistence-and-authority-boundaries.md:158` | PASS |

Next action: replace `eligibleAgentsForStep()` and the pinned-agent preflight with a materialized checked AgentBlock snapshot, then delete the local blocklist merge/write compatibility path before review.
