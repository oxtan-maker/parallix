# CP-2 — Typed persisted-artifact command

Enabled only `review:act-on-findings`. Its board request has no payload member,
and the controller forwards only the mission slug to the existing persisted
reviewer-artifact consumer. `review:submit` remains unavailable because its
CLI meaning is submit-for-review, not a reviewer decision; `approve:review`
remains unavailable because it must stay on the checked reviewer/provider path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Existing CLI/application behavior is characterized before board dispatch changes. | `test/task-2428-review-board-characterization.test.ts`; `npm test -- --unit-test-headroom test/task-2428-review-board-characterization.test.ts` | Complete |
| SC2: Enabled board kinds use typed, browser-safe input only. | `test/task-2428-board-review-artifacts.test.ts` — “task-2428: review artifacts board command forwards only the mission slug to the trusted consumer”; `src/application/controller/board-command.ts` | Complete for `review:act-on-findings` |
| SC3: Start/continue review rules remain intact. | `test/task-2332.14-review-use-case.test.ts`; CP-3 scope in `missions/task-2428/MISSION.md` | Pending CP-3 |
| SC4: Findings handling uses persisted artifacts, not browser-supplied data. | `test/task-2428-review-board-characterization.test.ts` — “task-2428 characterization: review:act-on-findings CLI consumes persisted reviewer artifacts only”; `test/task-2428-board-review-artifacts.test.ts` | Complete for enabled kind |
| SC5: Board approval cannot fabricate provider or human approval. | `src/application/controller/board-command.ts`; `test/task-2428-review-board-characterization.test.ts` — “task-2428 characterization: approve:review CLI selects reviewer verdict submission and remains unavailable” | Pending CP-4 negative test |
| SC6: Failed board commands leave authoritative state truthful and surface failure. | `test/task-2428-board-review-artifacts.test.ts` — “task-2428: failed persisted-artifact consumption surfaces a failed board result” | Complete for enabled kind |
| SC7: CLI review and history behavior remain unchanged. | `test/task-2332.14-review-use-case.test.ts`; `./scripts/verify-local.sh all` | Pending final gate |

Next action: test the enabled command against review lifecycle state, reviewer identity, and reviewed revision invariants without broadening its payload.
