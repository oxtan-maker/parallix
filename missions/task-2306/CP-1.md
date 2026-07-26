## Summary

Implemented attention item selection, bidirectional sync between the attention rail and board cards, exact command preview rendering, per-item source status indicators, independent keyboard navigation for the attention rail, and the run-affordance "wave 5" message. Enter activation is restricted to rail focus only — pressing Enter on the board does not trigger attention selection.

### Changes

**`src/interfaces/tui/shell.tsx`**
- `AttentionItems` accepts `selectedMissionId`, `focusedIndex`, and `sourceStatusMap` props (`shell.tsx:265-271`)
- Renders `▶` prefix (cyan) for selected item, `▌` prefix for keyboard-focused item (`shell.tsx:291-292`)
- Added `focusedAttentionIndex` state (`shell.tsx:117`), `showWave5Message` state (`shell.tsx:118`), and `focusedArea` state (`shell.tsx:120`) to `BoardShell`
- Bidirectional sync via `useEffect`: when `selectedMissionId` changes (lane card selection), the matching attention rail item is highlighted (`shell.tsx:127-131`)
- Per-item source status indicator: `getSourceStatusIndicator()` renders `⚠ source stale` / `⚠ source unavailable` on each attention item line (`shell.tsx:325-337`, `shell.tsx:299-301`)
- Independent keyboard navigation: `focusedArea` state ('rail' | 'board') with Tab (`key.tab`) to switch; up/down (WASD) navigates the focused area (`shell.tsx:390-401`, `shell.tsx:414-419`)
- Enter key handler in `KeyHandler`: guarded by `focusedArea === 'rail'`; selects the focused attention item, updates `selectedMissionId`, and shows the wave 5 message (`shell.tsx:421-431`)
- Wave 5 message renders in command log: "execution arrives in wave 5 (TASK-2307)" (`shell.tsx:216`)
- Exported `attentionCommand()` (`shell.tsx:51`) and `attentionWhy()` (`shell.tsx:35`) for test access
- Source status map computed via `useMemo` from `projection.sourceFacts` (`shell.tsx:134-140`)

**`test/tui-wave-4-attention.test.ts`** (16 tests)
- SC1: `AttentionItems` renders `▶` prefix for selected mission
- SC2: Tab + Enter on attention item updates `selectedMissionId` and board card shows `▶`
- SC2 (board focus): Enter while board focus is active does not activate attention selection
- SC2 (multi-item): Tab + 's' (down) + Enter navigates rail and selects second item
- SC3: Lane card selection syncs to attention rail `▶` prefix
- SC4: `attentionCommand()` produces exact `px <cmd> <slug>` strings for all reason kinds
- SC4: Rendered output contains exact command text `$ px integrate task-5001`
- SC5: Tab + Enter (run affordance) shows "wave 5" / "TASK-2307" message
- SC6: Empty queue renders "nothing needs attention" (wide and narrow)
- SC7: Unavailable/stale sourceFacts render `⚠` indicator per item in the attention rail (not just top bar)
- SC8: Narrow layout (columns=60) renders attention rail with top item visible
- SC9: Rank order assertions, reason kind tests, command text pattern tests

**`test/fixtures/board-projection.ts`**
- Added `makeAttentionItem()` helper and `AttentionItem`/`AttentionReason` type imports

### Verification

`node --import tsx --test test/tui-wave-4-attention.test.ts` — 16/16 pass.
`node --import tsx --test test/tui-headless-isolation.test.ts` — 3/3 pass.
`npm run typecheck` — 0 errors.
`./scripts/verify-local.sh workflow` — 1341/1341 pass.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: AttentionItems accepts selectedMissionId, renders ▶ prefix | `src/interfaces/tui/shell.tsx:274` (AttentionItems), `src/interfaces/tui/shell.tsx:292` (▶ render), `test/tui-wave-4-attention.test.ts`, `"attention-items: AttentionItems renders with selectedMissionId and ▶ prefix for focused mission"` | PASS |
| SC2: Enter on attention item updates selectedMissionId, board card shows ▶ | `src/interfaces/tui/shell.tsx:424` (Enter handler), `test/tui-wave-4-attention.test.ts`, `"attention-items: selecting an attention item by Enter updates selectedMissionId and board card shows ▶"` | PASS |
| SC3: Lane card selection updates matching attention item with ▶ | `src/interfaces/tui/shell.tsx:127` (useEffect bidirectional sync), `test/tui-wave-4-attention.test.ts`, `"attention-items: selecting a lane card updates selectedMissionId and matching attention item renders ▶"` | PASS |
| SC4: Each item renders exact command string from attentionCommand() | `src/interfaces/tui/shell.tsx:51` (attentionCommand), `src/interfaces/tui/shell.tsx:307` (render), `test/tui-wave-4-attention.test.ts`, `"attention-items: each item renders exact command string from attentionCommand()"`, `"attention-items: rendered output contains exact command text "$ px <cmd> <slug>""` | PASS |
| SC5: Run affordance dispatches nothing, shows wave 5 message | `src/interfaces/tui/shell.tsx:216` (wave 5 text), `src/interfaces/tui/shell.tsx:424` (Enter handler, no dispatch), `test/tui-wave-4-attention.test.ts`, `"attention-items: activating run affordance shows wave 5 message and dispatches nothing"` | PASS |
| SC6: Empty queue renders "nothing needs attention" (wide + narrow) | `src/interfaces/tui/shell.tsx:278` (empty text), `test/tui-wave-4-attention.test.ts`, `"attention-items: empty attention queue renders "nothing needs attention" in wide layout"`, `"attention-items: empty attention queue renders "nothing needs attention" in narrow layout"` | PASS |
| SC7: Unavailable/stale sourceFacts render ⚠ indicator per item in rail | `src/interfaces/tui/shell.tsx:325` (getSourceStatusIndicator), `src/interfaces/tui/shell.tsx:300` (⚠ render per item), `test/tui-wave-4-attention.test.ts`, `"attention-items: unavailable sourceFacts render ⚠ indicator per item in attention rail"`, `"attention-items: stale sourceFacts render ⚠ indicator per item in attention rail"` | PASS |
| SC8: Narrow layout (columns=60) renders rail above board, top item visible | `src/interfaces/tui/shell.tsx:99` (railBeside), `src/interfaces/tui/shell.tsx:169` (column layout), `test/tui-wave-4-attention.test.ts`, `"attention-items: narrow layout (columns=60) renders attention rail above board with top item visible"` | PASS |
| SC9: Component tests assert rank order, reason kinds, command text | `test/tui-wave-4-attention.test.ts`, `"attention-items: rank order is correct (blocking=0 < gate-failed=1 < review=2 < integrate=3)"`, `"attention-items: exact command text matches px <command> <mission-id> pattern for all reason kinds"` | PASS |
| SC10: Headless-isolation test passes unchanged | `test/tui-headless-isolation.test.ts` (3 tests pass), no new react/ink imports in headless graph | PASS |
| SC11: Verification gate passes | `npm run typecheck` — 0 errors, `./scripts/verify-local.sh workflow` — 1341 pass, 0 fail | PASS |

Next action: commit is complete for CP-1; all 11 success criteria verified. Proceed to checkpoint handoff or continue with any remaining mission work.
