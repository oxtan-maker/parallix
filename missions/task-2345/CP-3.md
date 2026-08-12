# CP-3: Documented precedence and verified delivery

## Summary

Documented SQLite as the runtime block authority and `agents.local.json` as an
operator override, including explicit local unblock behavior. The complete
mission gate passes with the shared launcher/board authority in place.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Runtime blocks make the launcher seam return blocked | `test/task-2345-repro.test.ts`, `"block persisted via updateAgentBlockChecked makes defaultIsAgentBlockedNow return true"` | PASS |
| Local-only and SQLite-only blocks resolve identically | `test/task-2345-repro.test.ts`, `"local-only and SQLite-only blocks both resolve as blocked"` | PASS |
| Explicit local false overrides SQLite | `test/task-2345-repro.test.ts`, `"explicit local unblock overrides a SQLite block"` | PASS |
| Board and launcher use the same authority decision | `test/task-2345-repro.test.ts`, `src/adapters/agents/agent-block-authority.ts` | PASS |
| Operator-facing precedence contract is documented | `./scripts/verify-local.sh all` | PASS |
| Required mission verification gate passes | `./scripts/verify-local.sh all` | PASS |
| Mandatory integration verification gate passes | `./scripts/verify-local.sh integrate` | PASS |
| Changed tests contain no focused or bare skipped tests | `test/task-2345-repro.test.ts` | PASS |

Next action: Handoff may proceed with the committed CP-1 through CP-3 evidence and the passing final verification gate.
