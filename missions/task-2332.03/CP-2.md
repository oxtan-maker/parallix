# CP-2 — Application capability contracts

Created the six capability-owned application contract modules and relocated the
classified interfaces from the SQLite adapter. Application services,
projections, composition, and runtime composition now import the owned
contracts; the adapter port module retains only migration and import mechanics.
The removed dependency allowlist entries make the architecture boundary
enforceable.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Exactly the six scoped capability files own the relocated contracts | `src/application/ports/mission-store.ts:18`, `src/application/ports/mission-measurements.ts:27`, `src/application/ports/operator-preferences.ts:7`, `src/application/ports/repository-catalog.ts:7`, `src/application/ports/agent-blocklist.ts:8`, `src/application/ports/operation-history.ts:8` | PASS |
| SQLite adapter port file retains only adapter-private mechanics | `src/adapters/sqlite/ports.ts:4`, `src/adapters/sqlite/ports.ts:16` | PASS |
| Application services use technology-neutral contracts | `src/application/services/agent-block-service.ts:1`, `src/application/services/known-repository-service.ts:2`, `src/application/projections/metrics-read-adapter.ts:1` | PASS |
| Capability definitions contain no prohibited persistence terminology | `src/application/ports/agent-blocklist.ts`, `src/application/ports/mission-measurements.ts`, `src/application/ports/operator-preferences.ts`, `src/application/ports/repository-catalog.ts`, `src/application/ports/operation-history.ts`, `src/application/ports/mission-store.ts` | PASS |
| Application sources compile after relocation | `npx tsc --noEmit` | PASS |

Next action: update remaining adapter-facing tests and verify characterization coverage for every relocated capability flow.
