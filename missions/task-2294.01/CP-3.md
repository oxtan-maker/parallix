# CP-3: Implementer pinning in `px rebase` shared-file conflict path

## Summary

Resolved mission implementer from task file before launching agent-assisted conflict resolution in the rebase workflow. The `startAgent` call now carries `agent` (pinned implementer), `slug`, `role: 'implementer'`, and `pinnedAgent: true`. When the implementer is missing or unavailable, the command exits non-zero with a message naming the family — no silent fallback.

## Changes

- `src/application/rebase-workflow.ts:820-850` — resolve implementer via `port.resolveTaskFile` + `port.getTaskImplementer`, pass `agent` override to `port.startAgent`, carry `slug` + `role: 'implementer'` + `pinnedAgent: true`, catch `PinnedAgentUnavailableError`
- `test/rebase-use-case.test.ts` — 4 new tests: pins implementer (SC2/SC7), unavailable implementer exits non-zero (SC5), missing implementer exits non-zero, any family passes through (AC #4)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: rebase shared-file pins implementer | `src/application/rebase-workflow.ts:822-844` | PASS |
| SC2: test asserts agent option equals implementer | `test/rebase-use-case.test.ts`, `"rebase use case pins the recorded mission implementer for shared-file conflicts"` | PASS |
| SC5: unavailable implementer exits non-zero | `src/application/rebase-workflow.ts:846-850` | PASS |
| SC5: test verifies unavailable path | `test/rebase-use-case.test.ts`, `"rebase use case exits non-zero when the pinned implementer launcher is unavailable"` | PASS |
| SC7: slug + role carried on launch | `src/application/rebase-workflow.ts:842-843` | PASS |
| AC #4: any implementer family passes through | `test/rebase-use-case.test.ts`, `"rebase use case passes any configured implementer family through unchanged"` | PASS |
| Tests pass | `npm test -- test/rebase-use-case.test.ts` (12/12 pass) | PASS |

Next action: Commit CP-4 (remove `conflict-resolution` step from `config/agents.json` and update `docs/agents.md`).
