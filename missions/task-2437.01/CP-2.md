# CP-2 — reference-aligned board corrections

Applied the four confirmed, shared-owner corrections: FLOW now has the reference’s two panels and cycle-time summary; attention cards and the top bar no longer add non-reference source or unattributed-session text; and the browser scrollbar is 9px with a 5px thumb radius. The transport continues to retain the omitted facts, and the repository identity remains a separate live value.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Approved reference export established | `unzip -p /tmp/Parallix Kanban Board Controller.zip 'Parallix Board GPU.dc.html'` | PASS |
| Every board surface compared against the approved reference | `web/src/board.tsx`; `missions/task-2437.01/CP-1.md` | PASS |
| Confirmed reference elements and no confirmed extras | `web/src/flow-panel.tsx`, `web/src/top-bar.tsx`, `web/src/attention-rail.tsx`, `web/src/style.css`; `"the audited reference treatment omits non-reference source and attribution text and retains its scrollbar"` in `test/web-board-render.test.ts` | PASS |
| Product name and repository identity remain distinct | `web/src/top-bar.tsx`; `"a populated snapshot renders repository identity and all six received stages in received order"` in `test/web-board-render.test.ts` | PASS |
| Focused coverage and required gate complete | `npx tsx --test test/web-board-render.test.ts`; `npm run build:web`; `./scripts/verify-local.sh all` | IN PROGRESS |

Next action: Recompare the committed board surfaces with the approved GPU export, then run the required repository gate.
