# CP-1: Presentation paths located

## Summary

Located the three browser presentation contracts and their focused render test. Flow values are formatted by `minutes` in `web/src/flow-panel.tsx`; agent-pill text is composed by `sessionsText` in `web/src/format.ts`; and the WIP indicator is rendered by `web/src/top-bar.tsx` from the existing `WebBoardSnapshot.metrics.weeklyThroughput` model. `test/web-board-render.test.ts` renders the shared transport-shaped fixture through these components.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Flow values render as whole-number strings | `web/src/flow-panel.tsx`, `test/web-board-render.test.ts` | PENDING CP-2 |
| Running-agent summaries omit command-session wording while retaining name and count | `web/src/format.ts`, `test/web-board-render.test.ts` | PENDING CP-2 |
| Throughput and attention text follows the WIP-5 indicator using existing model data | `web/src/top-bar.tsx`, `src/interfaces/web/transport.ts` | PENDING CP-2 |
| Focused automated coverage covers all three render behaviors | `test/web-board-render.test.ts` | PENDING CP-2 |
| Final verification gate succeeds | `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: Change only the three existing browser presentation functions and extend `test/web-board-render.test.ts` with regression assertions.
