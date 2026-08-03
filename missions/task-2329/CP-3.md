# CP-3: Interaction and Layout Enhancements

## Summary
Implemented keyboard-driven lifecycle shortcuts and the collapsible shipped/done lane, extending existing `shell.tsx` and `board-layout.tsx` only.

### Changes
- **SC6 Lifecycle shortcuts**: Added `Ctrl+D` (draft:create), `Ctrl+A` (active:execute), `Ctrl+R` (review:submit), `Ctrl+I` (integrate:merge) handlers in `KeyHandler`. Integrated capabilities dispatch through `BoardCommandController`; unavailable capabilities produce `unavailableCapability` outcome. Help text updated to list `Ctrl+D/A/R/I: lifecycle` and `Shift+S: shipped`.
- **SC7 Shipped collapse**: Added `shippedCollapsed` state to `BoardShell`. `Shift+S` toggles the done lane between full `LaneColumn` rendering and a narrow `SHIPPED · N` strip (width: 8 columns). No projection changes — pure layout toggle.

### Files Modified
| File | Lines | Change |
|---|---|---|
| `src/interfaces/tui/shell.tsx` | +30 | `shippedCollapsed` state, `dispatchLifecycle`, lifecycle shortcut key handlers, updated help text |
| `src/interfaces/tui/board-layout.tsx` | +18 | `shippedCollapsed` prop, collapsed done lane as narrow strip |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6 lifecycle shortcuts | `src/interfaces/tui/shell.tsx:183-201` dispatchLifecycle + LIFECYCLE_SHORTCUTS, `src/interfaces/tui/shell.tsx:485-498` Ctrl+D/A/R/I key handlers, `test/tui-characterization-cp1.test.ts:301` "keyboard help text lists lifecycle shortcut bindings" | PASS |
| SC7 shipped collapse | `src/interfaces/tui/shell.tsx:144` shippedCollapsed state, `src/interfaces/tui/shell.tsx:494-497` Shift+S handler, `src/interfaces/tui/board-layout.tsx:155-170` collapsed strip render, `test/tui-characterization-cp1.test.ts:290` "BoardShell renders done lane at full width by default" | PASS |
| SC10 no new files | No new `.tsx` files for CP-3; all changes in existing modules | PASS |

Next action: Run verification gate (`./scripts/verify-local.sh all`) and write CP-4 audit document.
