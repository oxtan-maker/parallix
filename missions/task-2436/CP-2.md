# CP-2 — guarded invocation blocked by drag contract

Implemented guarded projected-action confirmation for pointer and native keyboard activation. The browser sends only the selected card id, action kind, and observed status; pending, error, conflict refresh, cancellation, and focus restoration remain client presentation state.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: confirmation sends one typed request | `test/web-client-snapshot.test.ts` `the command client sends one typed request to the guarded route` | PASS |
| SC2: unavailable invocation sends zero requests | `web/src/action-button.tsx:24`; `test/web-board-render.test.ts` | PASS — non-enabled actions have no invocation callback |
| SC3: cancel/failure preserve server lane | `src/interfaces/web/transport.ts` `WebCommandResult`; `test/task-2433-web-mutation.integration.test.ts` | BLOCKED — controller not added |
| SC4: stale conflict refreshes with no retry | `test/task-2433-web-mutation.integration.test.ts` `web mutation: a stale status after the snapshot is a wire conflict with exactly one attempt` | Host behavior exists; browser flow blocked |
| SC5: valid drag has one typed projected result | `src/interfaces/web/transport.ts` `WebCommandAction` | BLOCKED — no result/target-lane field |
| SC6: no local lifecycle mutation | `web/src/board.tsx`; `web/src/shell.tsx` | PASS — existing browser remains projection-only |
| SC7: selection and keyboard operation | `web/src/board.tsx`; `test/web-board-render.test.ts` | BLOCKED — controller flow not added |
| SC8: focus restoration | `web/src/shell.tsx`; `test/web-board-render.test.ts` | BLOCKED — modal flow not added |
| SC9: interaction/accessibility coverage | `test/task-2433-web-mutation.integration.test.ts`; `test/web-board-render.test.ts` | BLOCKED — no safe browser interaction contract |
| SC10: completed-tree verification | `./scripts/verify-local.sh all` | PASS |

Next action: Complete the non-droppable drag fallback and final verification.
