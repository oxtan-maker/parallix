# CP-1 — typed-action boundary mapped

Mapped the browser board, shared web transport, host command route, and projection fixture. The current action projection provides `kind`, `display`, `state`, and `reason`; it does not provide a typed documented result or target lane. The mission therefore cannot safely implement drag intent without inferring lifecycle meaning from presentation or creating a client transition table, both prohibited by the mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: projected action identity is available for confirmation and dispatch | `src/interfaces/web/transport.ts:129`; `test/web-command-request.test.ts` | MAPPED — implementation recorded in CP-2 |
| SC2: unavailable controls remain non-dispatchable | `web/src/action-button.tsx`; `test/web-board-render.test.ts` | Current read-only behavior verified; implementation pending |
| SC3: cancellation/failure preserve the authoritative lane | `src/interfaces/web/transport.ts` `WebCommandResult`; `test/task-2433-web-mutation.integration.test.ts` | Host outcome contract available; browser implementation pending |
| SC4: stale conflict refreshes without retry | `test/task-2433-web-mutation.integration.test.ts` `web mutation: a stale status after the snapshot is a wire conflict with exactly one attempt` | Browser refresh flow pending |
| SC5: drag intent requires one advertised action with a documented target result | `src/interfaces/web/transport.ts` `WebCommandAction` | BLOCKED — no typed result/target-lane field exists |
| SC6: lanes change only after authoritative snapshot replacement | `web/src/shell.tsx`; `web/src/board.tsx` | Current browser is projection-only; interactive implementation blocked by SC5 contract gap |
| SC7: synchronized selection and keyboard-only controls | `web/src/board.tsx`; `test/web-board-render.test.ts` | Pending |
| SC8: focus restoration after terminal paths | `web/src/shell.tsx`; `test/web-board-render.test.ts` | Pending |
| SC9: interaction, request-count, payload, and accessibility coverage | `test/task-2433-web-mutation.integration.test.ts`; `test/web-board-render.test.ts` | Existing host/render coverage mapped; browser interaction coverage pending |
| SC10: completed-tree verifier | `./scripts/verify-local.sh all` | Deferred until the required action-result contract is supplied |

Next action: Obtain a server-projected typed action result (including its target lane or equivalent documented lifecycle result) before implementing any drag/drop affordance.
