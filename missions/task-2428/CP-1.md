# CP-1 — Review command characterization

Added characterization coverage for the existing CLI/application selection:
`--submit` invokes submit-for-review rather than a reviewer decision,
`--consume-artifacts` invokes persisted-artifact consumption, and
`--submit-review approve` invokes reviewer verdict submission. All three board
kinds remain unavailable at this checkpoint; `review:submit` is misleading,
and approval must stay on the checked reviewer/provider path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Existing CLI/application behavior is characterized before board dispatch changes. | `test/task-2428-review-board-characterization.test.ts` — “task-2428 characterization: review:submit CLI selects submit-for-review, not a reviewer decision”; `npm test -- --unit-test-headroom test/task-2428-review-board-characterization.test.ts` | Complete |
| SC2: Enabled board kinds use typed, browser-safe input only. | `src/application/controller/board-command.ts`; CP-2 scope in `missions/task-2428/MISSION.md` | Pending CP-2 |
| SC3: Start/continue review rules remain intact. | `test/task-2332.14-review-use-case.test.ts`; CP-3 scope in `missions/task-2428/MISSION.md` | Pending CP-3 |
| SC4: Findings handling uses persisted artifacts, not browser-supplied data. | `test/task-2428-review-board-characterization.test.ts` — “task-2428 characterization: review:act-on-findings CLI consumes persisted reviewer artifacts only” | Characterized; dispatch pending CP-2/3 |
| SC5: Board approval cannot fabricate provider or human approval. | `test/task-2428-review-board-characterization.test.ts` — “task-2428 characterization: approve:review CLI selects reviewer verdict submission and remains unavailable” | Characterized; negative board-path test pending CP-4 |
| SC6: Failed board commands leave authoritative state truthful and surface failure. | CP-3 scope in `missions/task-2428/MISSION.md` | Pending CP-3 |
| SC7: CLI review and history behavior remain unchanged. | `test/task-2332.14-review-use-case.test.ts`; `./scripts/verify-local.sh all` | Pending final gate |

Next action: add the typed, payload-free dispatch for persisted reviewer-artifact consumption only; retain `review:submit` and `approve:review` as unavailable.
