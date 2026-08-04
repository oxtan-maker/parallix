# CP-2: Idempotent submit-for-review and stable idempotency keys

## Summary

Domain fix: `decideMission`'s `submit-for-review` case now accepts `review` in addition to
`active`, and returns the mission untouched when it is already `review`. The early return sits
before the gate/evidence/review-round validations, so a retry cannot rewrite an in-flight review
round. `MissionLifecycleService.laneEvent` already suppresses lane events when `decided.status ===
from` (`src/application/mission-lifecycle-service.ts:126`), so the no-op emits no duplicate lane
event — the restricted lifecycle service and the lane-event repository were not touched.

CLI fix: both idempotency keys dropped `Date.now()`, so the `idempotency_key` UNIQUE constraint can
actually deduplicate a retried handoff or integration.

Docs: `src/domain/README.md` mission-rules section now states the idempotent-replay behaviour, since
the state machine contract it documents changed.

The CP-1 reproduction test is now green, and the existing domain suite still passes — no existing
test asserted the old rejection (`grep -rn "expected active" test/` finds only unrelated
assertions), so the CP-2 stop rule on breaking existing tests was not reached.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `submit-for-review` is an idempotent no-op on `review` status | `src/domain/mission-workflow.ts:75` (`requireStatus(mission, ['active', 'review'], command)`) and `src/domain/mission-workflow.ts:82` (`return mission;`) | PASS |
| SC2: handoff key stable, no `Date.now()` | `src/adapters/cli/commands/handoff.ts:740` (`idempotencyKey: \`handoff-${slug}\``) | PASS |
| SC3: integrate key stable, no `Date.now()` | `src/adapters/cli/commands/integrate.ts:1301` (`idempotencyKey: \`integrate-${context.slug}\``) | PASS |
| SC4: reproduction test red on parent, green after fix | `"retrying submit-for-review on a review mission is an idempotent no-op"` in `test/task-2339-submit-for-review-idempotent.test.ts` — threw `Cannot submit-for-review while task-2339 is review; expected active` at commit `4b8e6feb5`, passes on this tree via `npx tsx --test test/task-2339-submit-for-review-idempotent.test.ts` | PASS |
| No-op cannot rewrite an in-flight review round | `"submit-for-review retry does not advance the recorded review conversation"` in `test/task-2339-submit-for-review-idempotent.test.ts:84` | PASS |
| No duplicate lane event from the no-op (stop-rule check) | `src/application/mission-lifecycle-service.ts:126` returns `null` when the lane did not move; file unmodified (restricted area) | PASS |
| Existing domain workflow tests still pass | `npx tsx --test test/domain-mission.test.ts` — 19 pass / 0 fail together with the new file, including `"mission lifecycle follows the command-owned path without UI-only states"` | PASS |
| DoD #5: docs reflect the behaviour change | `src/domain/README.md:105` | PASS |
| Lint and typecheck clean on changed files | `npx tsc --noEmit` and `npx eslint src/domain/mission-workflow.ts src/adapters/cli/commands/handoff.ts src/adapters/cli/commands/integrate.ts test/task-2339-submit-for-review-idempotent.test.ts` — both silent | PASS |

Next action: CP-3 — run the mission gate `./scripts/verify-local.sh all` on the committed tree and
confirm no `.only` / bare `.skip` was introduced (SC5, SC6).
