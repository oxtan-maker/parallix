# The `px ui` board

Running `px` with no command in an interactive terminal renders the mission board.
`px ui` remains available as an explicit board command. The board is read-only: it
shows what the board projection already knows and never computes lifecycle state
of its own. Every headless command (`px status`, `px active`, `px review`, …)
behaves exactly as before; the TUI is an additional surface, not a replacement.

Set `PARALLIX_NO_TUI=1` to restore the previous interactive no-command behavior:
`px` prints usage help and exits successfully. Piped, CI, and redirected-output
no-command invocations already use that same usage-help behavior automatically.

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

## Where each fact comes from

The board reads what the lifecycle already recorded. It never queries the review
provider and never launches an agent of its own, so a field stays `unavailable`
until the step that produces it has run.

| Field | Source | Appears after |
|---|---|---|
| checkpoint, next step, Goal Check | the latest `CP-N.md` in the mission directory | `px checkpoint` |
| gate | the verifier exit code recorded in `<mission>/.workflow/gate-result.json`, read from the mission's own worktree | `px checkpoint` |
| pull request | the pull-request reference the review loop records on the round once it confirms an open PR | `px review` with a review provider configured |
| agent availability | the `agent_blocklist` table | an agent hits a provider usage limit |
| cycle time | the `board_lane_events` table | any lane transition |
| operations | the `operational_history` table | `px active`, `px checkpoint`, `px review`, or `px integrate` |

The gate cell reports an exit code and nothing else. An agent's own account of a
gate run — including a `PASS` row in its Goal Check table — is never promoted to
gate state; ADR 0048 classifies that as an unverifiable claim. `.workflow/` is
ignored by Git, so the recorded result describes the local run that produced it
rather than travelling with the branch as a committed assertion.

Missions whose lifecycle steps predate this wiring are not backfilled. Their
fields stay `unavailable` until the next step of that kind runs.

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

## Launching the board

Use `px` with no command from an interactive terminal for the default board
launch. `px ui` continues to launch the same board explicitly. To opt out of the
default for one invocation, run `PARALLIX_NO_TUI=1 px`; set that environment
variable in your shell environment to keep usage help as the no-command default.
