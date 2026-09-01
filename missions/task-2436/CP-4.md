# CP-4 — final browser controller authority audit

Audited the browser controller against the server-projected action contract. Actions retain their typed kind, identity, and target lane; selection and keyboard traversal are presentation state only, and no card lane is changed locally.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: immediate typed invocation | `test/web-client-snapshot.test.ts` — `the command client sends one typed request to the guarded route` | PASS |
| SC2: unavailable actions do not dispatch | `test/web-board-interaction.test.ts` — `board unavailable action ignores pointer and keyboard activation` | PASS |
| SC3: terminal outcomes preserve received lanes | `test/web-board-interaction.test.ts` — `board failure leaves the card in its received lane and restores initiating focus` | PASS |
| SC4: stale conflicts refresh without retry | `test/web-board-interaction.test.ts` — `board conflict refreshes without retry and preserves the typed outcome` | PASS |
| SC5: drag resolves projected target intent | `test/web-board-interaction.test.ts` — `board drag dispatches the projected target action and rejects other targets` | PASS |
| SC6: no local lifecycle mutation | `test/web-board-render.test.ts` — `production browser code maps no lane to a lifecycle rule or command` | PASS |
| SC6a: projected work and review presentation | `test/web-board-render.test.ts` — `activity, coordinator recovery evidence, and reduced motion stay truthful` | PASS |
| SC7: shared selection and keyboard controls | `test/web-board-render.test.ts` — `board and attention cards share a keyboard-selectable presentation selection` | PASS |
| SC8: focus restoration | `test/web-board-interaction.test.ts` — `board focus fallback lands on the selected card after refresh removes the action` | PASS |
| SC9: command, drag, accessibility, and review-resume coverage | `test/web-board-interaction.test.ts` — `board click and keyboard activation send one projected typed request`; `test/task-2436-board-handoff-resume.test.ts` — `board handoff resume advances the review round and records one lane transition` | PASS |
| SC10: required verification | `./scripts/verify-local.sh all` | PASS |

Next action: Submit the round-8 implementer resolution with the passing resume-branch and full verification evidence.
