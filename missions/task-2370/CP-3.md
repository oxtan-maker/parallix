# CP-3: Shared liveness policy and reactive board refresh

## Summary

The shared projection now reconciles current-work facts before attention policy
runs: live and unverified work remain WORKING, stale work is actionable, a
known-dead publisher is cleared, and an exhausted operation keeps its truthful
blocking reason. `BoardProjectionBuilder` remains the single read boundary.

`subscribeToBoardProjection` re-queries that shared builder every two seconds
only for interactive UI use. It fingerprints displayed state, keeps the last
good frame on a transient read failure, and cleans up its timer on unsubscribe.
Piped rendering still supplies no subscription. The TUI receives projection
updates through a callback; it does not read SQLite, Git, or processes.

Source warnings are now scoped to each attention item's declared dependencies,
instead of copying a global warning onto unrelated rows.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4/SC5: family handoff is WORKING; exhaustion is actionable | `test/current-work-reconciliation.test.ts`, `"current work keeps automatic family handoff working and makes exhaustion actionable"` | PASS |
| SC6: unverified, stale, and known-stopped work remain distinct | `test/current-work-reconciliation.test.ts`, `"current work distinguishes unverified, stale, and known-stopped publishers"` | PASS |
| SC7: open interactive board rebuilds after an external projection change | `test/task-2370-repro.test.ts`, `"TASK-2370 repro C: an already-open interactive board rebuilds after an external board-relevant change"` | PASS |
| SC7: piped board remains finite | `src/interfaces/tui/ui-command.ts` renders with `renderToString` before it creates `subscribeToBoardProjection` | PASS |
| SC9: source warnings are scoped to the attention item's dependencies | `src/interfaces/tui/shell.tsx`, `test/tui-wave-4-attention.test.ts` | PASS |
| CP-3 focused verification | `npx tsx --test test/task-2370-repro.test.ts test/current-work-reconciliation.test.ts test/tui-wave-4-attention.test.ts` → 21 pass / 0 fail | PASS |

Next action: begin CP-4 — render WORKING separately from NEEDS YOU, use each attention item's typed action for both display and Enter dispatch, review TASK-2368 coverage, and run the final gate.
