# CP 6: Final cutover verification and no-fallback hardening

## Summary

Verified the mission gates, then removed the remaining production-reachable legacy session-file fallbacks discovered during the final source audit. Agent launches now lazily construct the SQLite-backed application port through the adapter factory; resume, save, and stale-session clear operations fail explicitly if that port is unavailable. The five launcher paths no longer import `tools/sessions.js`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Launch resume and save use the checked SQLite-backed port | `src/platform/runtime/lib/agents/agents.ts:135`, `src/platform/runtime/lib/agents/agents.ts:325`, `src/platform/runtime/lib/agents/agents.ts:528` | PASS |
| Stale-session clears require and await SessionMarkerPort | `src/platform/runtime/lib/agents/claude.ts:135`, `src/platform/runtime/lib/agents/codex.ts:304`, `src/platform/runtime/lib/agents/opencode.ts:859` | PASS |
| No production launcher imports the retired session-file module | `src/platform/runtime/lib/agents/agents.ts:34`, `src/platform/runtime/lib/agents/claude.ts:3`, `src/platform/runtime/lib/agents/pi.ts:4`, `src/platform/runtime/lib/agents/codex.ts:6`, `src/platform/runtime/lib/agents/opencode.ts:9` — each imports `SessionMarkerPort` from `domain-ports.js`; `grep -rn "tools/sessions" src/platform/runtime/lib/agents/*.ts` returns no matches | PASS |
| Session-marker persistence behaviors remain covered | `test/session-marker-repository.test.ts` — `"shouldResume returns true when mission, role, and agent all match"`, `"atomic commit imports all markers in a single transaction"` | PASS |
| Attempt remains excluded | `test/domain-attempt-guard.test.ts` | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Full mission verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Parallix may perform its lifecycle transition; the mission worktree and all checkpoint documents are committed.
