# CP-1: Failing reproduction test for submit-for-review retry

## Summary

Added `test/task-2339-submit-for-review-idempotent.test.ts`, a domain-level reproduction of the
handoff retry failure described in the mission goal. The test drives `decideMission` from `active`
to `review` with a `submit-for-review` command, then replays the same command — exactly what a
relaunched handoff does after gatekeeper pushback.

On the pre-fix tree both tests are red with the reported production error:

```
MissionRuleViolation: Cannot submit-for-review while task-2339 is review; expected active
    at requireStatus (src/domain/mission-workflow.ts:51:11)
    at decideMission (src/domain/mission-workflow.ts:75:5)
```

The second test pins the no-op contract that CP-2 must satisfy: a retry carrying a *different*
review payload must not rewrite the review already recorded on the mission, so the idempotent path
cannot silently advance an in-flight round.

The file is a root-level `test/*.test.ts` and is therefore picked up by the default suite
discovery in `test/run-default-tests.ts:64`; it is not on the integration exclusion list, so
`./scripts/verify-local.sh all` will run it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4: reproduction test exists and is red before the fix | `test/task-2339-submit-for-review-idempotent.test.ts:66`, `"retrying submit-for-review on a review mission is an idempotent no-op"` fails with `Cannot submit-for-review while task-2339 is review; expected active` under `npx tsx --test test/task-2339-submit-for-review-idempotent.test.ts` | PASS |
| Red assertion targets the real domain guard | `src/domain/mission-workflow.ts:74` (`requireStatus(mission, ['active'], command)`) is the throw site reported in the failure stack | PASS |
| No-op contract pinned for CP-2 | `"submit-for-review retry does not advance the recorded review conversation"` in `test/task-2339-submit-for-review-idempotent.test.ts:84` | PASS |
| Test runs in the default gate (not silently dropped) | `test/run-default-tests.ts:64` discovers all root `*.test.ts`; the new file is absent from the integration exclusion list at `test/run-default-tests.ts:94` | PASS |
| SC6: no focused or skipped tests introduced | `test/task-2339-submit-for-review-idempotent.test.ts` contains only bare `test(...)` calls, no `.only` / `.skip` | PASS |

Next action: CP-2 — allow `review` in the `submit-for-review` `requireStatus` list at
`src/domain/mission-workflow.ts:74` and return the mission unchanged when it is already `review`,
then replace the `Date.now()` idempotency keys at `src/adapters/cli/commands/handoff.ts:738` and
`src/adapters/cli/commands/integrate.ts:1299` with stable `handoff-${slug}` / `integrate-${context.slug}`.
