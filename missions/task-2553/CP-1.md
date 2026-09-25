# CP-1: Preserve cancel-button pointer activation

The shared `ActionButton` now prevents a pointer-down from focusing its
draggable card before the button click is delivered. The board still owns the
cancel confirmation; the control only prevents the parent focus transition
from swallowing its click.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Cancel opens confirmation from refined and active cards without dispatching deletion | `test/web-board-interaction.test.ts`, `"cancel pointer activation opens its confirmation from intake and flight cards"` | PASS |
| SC2: The action mouse-down prevents the parent card focus transition | `web/src/action-button.tsx`; `test/web-board-interaction.test.ts` | PASS |
| SC3: Board drag target dispatch behavior remains covered | `test/web-board-interaction.test.ts`, `"board drag dispatches the projected target action and rejects other targets"` | PASS |
| SC4: Static analysis accepts the final change | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: submit the repaired mission definition and scoped diff for review.
