# The `px ui` board

`px ui` renders the mission board in the terminal. It is read-only: it shows what
the board projection already knows and never computes lifecycle state of its own.
Every headless command (`px status`, `px active`, `px review`, …) behaves exactly
as before; the TUI is an additional surface, not a replacement.

## Layout

The board has six lanes, in this order:

```text
BACKLOG   REFINED   ACTIVE   REVIEW   INTEGRATION   DONE
```

Each lane header shows the lane name and its WIP count. A lane with no missions
says so explicitly (`nothing in review`) rather than rendering an empty gap.

The arrangement follows the terminal size:

| Terminal width | Arrangement |
|---|---|
| 100 columns or wider | six equal columns side by side |
| narrower than 100 columns | one column, lanes stacked top to bottom |

At 100–112 columns the attention rail moves above the board so all six lanes
have enough room to render fully. At 113+ columns the rail sits on the left
as usual. Below 100 columns the rail is above the stacked lanes.

Resizing the terminal re-lays the board out at the new size. Shrinking the window
clears the previous frame first, so no stale half-frame is left behind.

## What a card shows

Each mission card renders the facts the projection supplies:

```text
▍task-2304 · custom
Ink TUI wave 2: lane columns and responsive layout
cp CP-2.md · gate passed ✓
next: run the verification gate
PR 42 · review approved
▲ waiting on upstream fix
```

- **slug and agent** — the mission id and the assigned agent family.
- **title** — truncated with `…` when it does not fit the column.
- **checkpoint and gate** — the latest checkpoint file and the latest gate result
  (`passed`, `failed`, `running`, or `unknown`).
- **next step** — the `Next action:` line from that checkpoint.
- **pull request and review** — the PR number when one exists, and whether the
  current revision is approved.
- **blocking reason** — a red flag line, shown only when the mission is blocked.

A fact the projection does not have reads `unavailable`. That is deliberate: the
card distinguishes "we know there is nothing" from "we could not read this", and
it never guesses a value the workflow has not recorded.

## Overflow

A lane shows as many cards as the terminal height allows, up to eight, and folds
the rest into a `+N more` line. The lane keeps its column; it does not stretch the
board past the last row of the terminal.

## Keyboard controls

The board is read-only. Navigation changes only the current selection; it does
not run a workflow command or change repository state.

| Keys | Result |
|---|---|
| `↑` or `W` | Select the previous mission in the current lane. Stops at the first mission. |
| `↓` or `S` | Select the next mission in the current lane. Stops at the last mission. |
| `←` or `A` | Select the nearest populated lane to the left, wrapping across the board. |
| `→` or `D` | Select the nearest populated lane to the right, wrapping across the board. |
| `?` | Show or hide the keyboard reference in the board footer. |
| `q` or `Ctrl+C` | Leave the board. |

Arrow keys are the primary navigation controls; `W`, `A`, `S`, and `D` provide a
left-hand alternative. Empty lanes are skipped when moving left or right. In a
lane with more cards than fit, moving selection also scrolls the visible card
window just enough to keep the focused card shown. The board is read-only, so it
assigns no workflow actions to `Enter` or other letter keys.

## Leaving

Press `q` or `Ctrl+C`.
