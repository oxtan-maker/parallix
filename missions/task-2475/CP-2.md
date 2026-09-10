# CP-2: Operator SQLite admission leases

Replaced the process-local production counter with a SQLite lease repository.
Admission uses `BEGIN IMMEDIATE`, holds a conservative launcher lease until the spawn seam synchronously records the actual child identity, and releases on normal completion.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Multi-process finite capacity is enforced atomically | `test/custom-capacity-multiprocess-repro.test.ts`, "two processes contend for one custom slot: exactly one acquires"; `node --import tsx --test test/custom-capacity-multiprocess-repro.test.ts` | Passed |
| Capacity is durable operator-owned state, not a module counter | `src/adapters/sqlite/custom-agent-lease-repository.ts`; `src/adapters/sqlite/migrations/0019-custom-agent-leases.sql`; `ADR 0053` | Passed |
| Lease binds to the spawned process and releases normally | `src/adapters/process/spawn-tee.ts`; `src/adapters/agents/agents.ts`; `npx tsc --noEmit --pretty false` | Passed |
| PID reuse cannot preserve a stale lease | `src/adapters/process/process-liveness.ts`; `test/task-2373-liveness.test.ts`, "SC13: a reused pid whose process-start identity differs is treated as dead" | Passed |

Next action: add detached-child, stale-reap, cross-repository, and canonical-configuration regression coverage.
