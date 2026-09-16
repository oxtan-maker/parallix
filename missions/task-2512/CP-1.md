# CP-1: Retire the application-to-adapter exception

Moved Goal Check evidence helpers to the application layer, retained adapter re-exports for review callers, and removed the now-stale production dependency allowlist entry.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 exception list is empty and production scan is clean | `npm test -- test/dependency-graph.test.ts`, "production dependency exceptions are retired" | PASS |
| SC2 handoff use case has no adapter import | `src/application/handoff-command-use-case.ts`, `npm test -- test/dependency-graph.test.ts` | PASS |
| SC3 review static-evidence exports remain available | `test/review-static-evidence.test.ts`, "review static evidence preserves its goal-check helper exports" | PASS |

Next action: Define the application-owned integrate workflow port contract and adapter bindings for CP-2.
