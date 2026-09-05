# CP-1 — approved reference audit

The approved export was identified as `/tmp/Parallix Kanban Board Controller.zip` (SHA-256 `deb2c70f1813550f2bb2638b74ac0efe9e61c9240e4c5afee53edbedbc4b81d9`), using its `Parallix Board GPU.dc.html` member only. The audit covers the rendered top bar, FLOW panel, attention rail, refined/backlog intake stack, active/review/integrate flight columns, done disclosure rail, and operation log composed by `web/src/board.tsx`.

Confirmed inventory: the board already has the required regions, lane order, widths, palette, card bands, fan treatment, collapsed done rail, and operation log. The approved product/repository divergence remains valid: `web/src/top-bar.tsx` renders `Parallix` once and `snapshot.repositoryId` separately. Confirmed corrections are the reference scrollbar treatment (9px with 5px thumb radius), removal of the non-reference FLOW `READ` region in favor of the reference cycle-time summary, and removal of non-reference attention-source text and top-bar unattributed-session text. The latter facts remain available in the transport but are not reference-screen elements.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Approved reference export established | `unzip -p /tmp/Parallix Kanban Board Controller.zip 'Parallix Board GPU.dc.html'` | PASS |
| Every board surface compared against the approved reference | `web/src/board.tsx`, `web/src/top-bar.tsx`, `web/src/flow-panel.tsx`, `web/src/attention-rail.tsx`, `web/src/intake-column.tsx`, `web/src/flight-column.tsx`, `web/src/done-rail.tsx`, `web/src/operation-log.tsx` | PASS |
| Confirmed reference elements and no confirmed extras | `Parallix Board GPU.dc.html`; `test/web-board-render.test.ts` | IN PROGRESS |
| Product name and repository identity remain distinct | `web/src/top-bar.tsx`; `test/web-board-render.test.ts` | PASS |
| Focused coverage and required gate complete | `test/web-board-render.test.ts`; `./scripts/verify-local.sh all` | IN PROGRESS |

Next action: Apply the four confirmed reference-alignment corrections and cover their rendered output.
