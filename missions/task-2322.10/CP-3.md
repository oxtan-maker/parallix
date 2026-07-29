# CP-3: Route checked AgentBlock mutations and availability

## Summary

Added `AgentBlockService` as the application boundary for family-keyed checked
state. It is deliberately fail-closed: repository errors propagate and no
configuration reader is consulted. Runtime limit-hit and transient launch
failure writes now default to `updateAgentBlockChecked()`, which dynamically
opens the checked operator-state adapter and invokes that service. The concrete
board agent adapter now receives its checked rows through the same service;
expired timed rows become eligible instead of becoming indefinite blocks.

The legacy `updateAgentBlock()` compatibility export remains only for existing
file-format callers and is no longer the runtime default mutation path. CP-4
will complete the remaining synchronous launcher-selection cutover.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Production block mutations invoke the checked AgentBlock repository through an application service | `src/platform/runtime/lib/agents/agent-config.ts:195`; `src/platform/runtime/lib/agents/agents.ts:402`; `src/application/services/agent-block-service.ts:32` | PASS |
| Legacy import supports dry-run, atomic/idempotent execution, conflicts, and immutable source configuration | `src/adapters/sqlite/importer.ts:83`; `"legacy AgentBlock import dry run reports rows without persistence or source mutation"`; `"legacy AgentBlock import reports canonical conflicts and leaves the database untouched"` | PASS |
| Production local-file block authority is retired while static configuration remains an external input | `src/platform/runtime/lib/agents/agent-config.ts:71`; `src/platform/runtime/lib/agents/agent-config.ts:159` | PARTIAL — compatibility readers remain for CP-4 selection cutover |
| The application boundary returns reason, expiry, limit, and eligibility without domain SQLite/filesystem dependencies | `src/application/services/agent-block-service.ts:20`; `src/application/projections/agent-status.ts:12`; `src/domain/agents.ts:48` | PASS |
| Checked mutation failure does not fall back to a file or stale eligibility | `"AgentBlock service exposes repository failures without file fallback"`; `src/application/services/agent-block-service.ts:17` | PASS |
| Import and lifecycle tests use mocks and do not launch agents or contact Forgejo | `test/task-2322-agent-block-import.test.ts`; `test/task-2322-agent-block-service.test.ts`; `"AgentBlock service accepts concurrent checked-repository updates for distinct families"` | PASS |
| Final mission tree passes the declared verifier | `./scripts/verify-local.sh all` | PENDING — CP-4 gate |

Next action: replace the remaining synchronous local eligibility path with the checked-state snapshot and run the full verifier.
