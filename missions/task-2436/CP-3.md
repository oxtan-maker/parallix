# CP-3 — drag, selection, and focus work stopped safely

Implemented the controller’s shared action selection and focus return path. Positive drag intent remains unavailable because no projected action result identifies a target lane; no browser lane mapping was introduced.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: enabled action confirmation and typed request | `test/web-client-snapshot.test.ts` `the command client sends one typed request to the guarded route` | PASS |
| SC2: unavailable actions cannot dispatch | `web/src/action-button.tsx:24`; `test/web-board-render.test.ts` | PASS |
| SC3: cancellation/failure retain authoritative lane | `src/interfaces/web/transport.ts` `WebCommandResult`; `test/task-2433-web-mutation.integration.test.ts` | BLOCKED — controller contract incomplete |
| SC4: stale conflict refreshes once | `test/task-2433-web-mutation.integration.test.ts` `web mutation: a stale status after the snapshot is a wire conflict with exactly one attempt` | BLOCKED — browser refresh controller not added |
| SC5: only one matching projected action permits a drop | `src/interfaces/web/transport.ts` `WebCommandAction` | BLOCKED — no typed documented result/target lane |
| SC6: snapshots alone change lanes | `web/src/board.tsx`; `web/src/shell.tsx` | PASS — no local lifecycle path added |
| SC7: rail/board selection and keyboard controls | `web/src/attention-rail.tsx`; `web/src/board.tsx` | BLOCKED — interaction controller not added |
| SC8: terminal focus restoration | `web/src/shell.tsx`; `test/web-board-render.test.ts` | BLOCKED — no modal or refresh focus path added |
| SC9: drag, keyboard, and accessibility assertions | `test/web-board-render.test.ts`; `test/task-2433-web-mutation.integration.test.ts` | BLOCKED — no safe target-intent fixture exists |
| SC10: completed-tree verifier | `./scripts/verify-local.sh all` | PASS |

Next action: Add server action-result metadata before enabling positive drag intent.
