# CP 4: Migrate launcher callers from `sessions.ts` to `SessionMarkerPort`

## Summary

Migrated all five launcher files (`agents.ts`, `claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) to accept and use the checked `SessionMarkerPort` application port for session marker operations. Each file now accepts an optional `sessionMarkerPort` parameter and uses the port's async methods (`shouldResume`, `find`, `save`, `delete`) when available. The legacy `sessionsModule` parameter is retained for backward-compatible test injection (sync interface). The `ADR0053_PERSISTENCE_INVENTORY` entries `session-read-sessions` and `session-write-sessions` are updated to reflect the cutover: file location now points to `session-marker-repository.ts` and `cutoverTask` is `null`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| agents.ts uses SessionMarkerPort for shouldResume, find, save | `src/platform/runtime/lib/agents/agents.ts` — `sessionMarkerPort` parameter, port methods at call sites | PASS |
| claude.ts uses SessionMarkerPort for clearSession | `src/platform/runtime/lib/agents/claude.ts` — `sessionMarkerPort` parameter, `port.delete()` in staleSessionHandler | PASS |
| codex.ts uses SessionMarkerPort for clearSession | `src/platform/runtime/lib/agents/codex.ts` — `sessionMarkerPort` parameter, `port.delete()` in staleSessionHandler | PASS |
| opencode.ts uses SessionMarkerPort for clearSession | `src/platform/runtime/lib/agents/opencode.ts` — `sessionMarkerPort` parameter, `port.delete()` in staleSessionHandler | PASS |
| pi.ts uses SessionMarkerPort (no file-based calls) | `src/platform/runtime/lib/agents/pi.ts` — `SessionMarkerPort` import, `__setSessionPortForTest`, no `_sessions` usage | PASS |
| sessionsModule retained for test backward compat | All five files retain `sessionsModule` parameter with `sessions` default for test injection | PASS |
| ADR0053_PERSISTENCE_INVENTORY updated | `src/platform/runtime/lib/core/durable-state-inventory.ts` — `session-read-sessions` and `session-write-sessions` point to `session-marker-repository.ts`, `cutoverTask: null` | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |
| No Attempt-shaped type introduced | `test/domain-attempt-guard.test.ts` — 11/11 tests pass | PASS |

Next action: Write fast unit tests covering resume, failover, duplicate marker, stale update, restart, and database-unavailable scenarios (CP 5).
