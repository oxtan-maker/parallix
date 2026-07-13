# CP-3 — Bounded caller migration and policy guard

## Summary

Both inventory-confirmed writer families now use `writeJson` without changing their paths or
payload fields. `writeSession` exposes an injected writer seam and lets persistence errors
propagate. `startAgent` converts that error into a rejected launch result rather than returning
success. NEL capture likewise exposes an injected writer seam, marks persistence failures, and
causes `performHandoff` to stop before PR or Backlog review transitions; NEL computation
unavailability remains observational.

The inventory-backed policy test parses direct `writeFileSync(JSON.stringify(...))` calls with
the TypeScript AST. It accepts only the three exact generated/configuration exceptions recorded
in the inventory and has a negative fixture proving a new session-state writer is rejected.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 session metadata uses approved API | `lib/tools/sessions.ts:35`; `lib/tools/sessions.ts:50` | PASS |
| SC4 NEL record uses approved API | `lib/commands/handoff.ts:1077`; `lib/commands/handoff.ts:1088` | PASS |
| Generated and scratch exceptions remain direct and inventoried | `lib/core/durable-state-inventory.ts:54`; `lib/core/durable-state-inventory.ts:61`; `test/durable-state-policy.test.js:9` | PASS |
| Session write failure propagates without replacing prior metadata | `test/sessions.test.js`, "writeSession propagates durable persistence failure without replacing prior metadata" | PASS |
| Agent caller emits no successful launch result after marker failure | `lib/agents/agents.ts:501`; `test/agents.test.js`, "startAgent rejects instead of reporting launch success when session persistence fails" | PASS |
| NEL write failure is caller-visible and creates no record | `lib/commands/handoff.ts:1087`; `test/handoff.test.js`, "captureNelAtHandoff reports injected persistence failure and writes no success record" | PASS |
| Handoff does not advance review state after NEL persistence failure | `lib/commands/handoff.ts:390`; `test/handoff.test.js`, "performHandoff stops before review transitions when NEL persistence fails" | PASS |
| SC7 guard passes exact documented exceptions | `test/durable-state-policy.test.js:42`; "direct durable JSON write guard passes only inventory-documented exceptions" | PASS |
| SC7 guard rejects a new direct durable writer | `test/durable-state-policy.test.js:57`; "direct durable JSON write guard rejects a new non-inventoried writer" | PASS |
| CP-3 focused suite passes | `node --test test/storage.test.js test/sessions.test.js test/sessions-coverage.test.js test/agents.test.js test/handoff.test.js test/durable-state-policy.test.js` (219 passed, 1 annotated skip) | PASS |

Next action: add exact session/NEL path-and-schema compatibility assertions, measure the non-documentation implementation diff, run graphify update, then execute both declared integration gates.
