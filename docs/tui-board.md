# The `px ui` board

Running `px` with no command in an interactive terminal renders the mission board.
`px ui` remains available as an explicit board command. The board is read-only: it
shows what the board projection already knows and never computes lifecycle state
of its own. Every headless command (`px status`, `px active`, `px review`, …)
behaves exactly as before; the TUI is an additional surface, not a replacement.

The board uses the non-archived task catalog visible from the checkout where it
is launched. Tasks that have started use their shared persisted lifecycle state,
while an unstarted task remains visible in that checkout's Markdown lane.
Missions from other repositories and archived tasks do not appear on the
operational board.

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

## What the attention rail lists

`▲ NEEDS YOU NEXT` lists the missions waiting on a person: a blocked mission
first, then a failed gate, then a mission in review, then one in integration.

A mission with current work is left out of that list, because the turn is
already being taken. The workflow records the active operation and agent family
when it launches the agent, so the board does not guess ownership from the
mission assignment or command line. Two facts still outrank current work and
keep the mission listed: a blocking reason and a failed gate. Process liveness
only verifies that a recorded operation has not disappeared; unavailable
verification is never treated as an idle mission.

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

## Cycle time and agent runtime are different numbers

FLOW reports both, under labels that do not overlap:

- **Median lifecycle cycle time** — how long a mission took from its first lane
  event to closure, waiting included. It measures the delivery system.
- **Median agent runtime** — how many minutes the agents actually ran on a
  mission, summed across its recorded runs. It measures the agents.

A mission that activates on Monday morning, runs an agent for 22 minutes, waits
overnight, and closes after 15 minutes of review on Tuesday has 37 minutes of
agent runtime and about 26 hours of cycle time. Reading either number as the
other hides exactly the gap worth managing, so no FLOW label uses "cycle time"
for execution minutes.

When lifecycle history supplies experiment cohorts, FLOW also shows the supplied
cohort comparison. It labels cohort population separately from the observation
count for each cycle-time, review, runtime, and cost figure; unavailable facts
remain unavailable rather than becoming zero.

## Weekly decision window

FLOW separates completed-mission decisions from the board's current operational
state. Its decision section shows the current rolling seven calendar days and
the preceding non-overlapping seven days. A mission belongs to a comparison by
its delivery-completion day, even when it started earlier; once selected, its
whole lifecycle and recorded agent work are included. Each decision figure
shows its observation count, so an unavailable or partly measured statistic is
not mistaken for a zero.

The current-flow section answers a different question: WIP, lane age,
bottleneck, and agent availability describe the state now and are not forced
into the completed-mission window.

## Where each fact comes from

The board reads what the lifecycle already recorded. It never queries the review
provider and never launches an agent of its own, so a field stays `unavailable`
until the step that produces it has run.

| Field | Source | Appears after |
|---|---|---|
| checkpoint, next step, Goal Check | the latest `CP-N.md` in the mission directory | the executing agent commits checkpoint evidence |
| gate | the verifier exit code recorded in `<mission>/.workflow/gate-result.json`, read from the mission's own worktree | a lifecycle transition runs the verifier |
| pull request | the pull-request reference the review loop records on the round once it confirms an open PR | `px review` with a review provider configured |
| agent availability | the `agent_blocklist` table | an agent hits a provider usage limit |
| cycle time | the `board_lane_events` table | any lifecycle step: mission intake (entry into `backlog`), every lane transition, `integration → done`, and closure |
| agent runtime | the `duration_minutes` column of the `usage_statistics` table, summed per mission over its recorded runs | an agent finishes a run and its measurement is written |
| operations | the `operational_history` table | `px active`, `px review`, or `px integrate` |

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

Navigation changes only the current selection; it does not run a workflow
command or change repository state. The two keys that do act on a mission open a
confirmation before anything happens.

| Keys | Result |
|---|---|
| `↑` or `W` | Select the previous mission in the current lane. Stops at the first mission. |
| `↓` or `S` | Select the next mission in the current lane. Stops at the last mission. |
| `←` or `A` | Select the nearest populated lane to the left, wrapping across the board. |
| `→` or `D` | Select the nearest populated lane to the right, wrapping across the board. |
| `?` | Show or hide the keyboard reference in the board footer. |
| `Shift+X` | Ask to cancel the selected mission. A second `Shift+X` confirms; `Escape` dismisses. See [Cancelling a mission](#cancelling-a-mission). |
| `q` or `Ctrl+C` | Leave the board. |

Arrow keys are the primary navigation controls; `W`, `A`, `S`, and `D` provide a
left-hand alternative. Empty lanes are skipped when moving left or right. In a
lane with more cards than fit, moving selection also scrolls the visible card
window just enough to keep the focused card shown. Navigation itself changes
nothing; the keys that do act on a mission — `Enter` and `Shift+X` — each open a
confirmation first.

## Cancelling a mission

A mission that went wrong and will be redone from scratch can be retired from the
operator database. Cancelling deletes that one mission's lifecycle rows — its
lane history, checkpoints and goal checks, review rounds, findings, resolutions,
review events, external task reference, labels and session markers — and moves
its Backlog task file into `backlog/archive/tasks/`. The board projects its
cards from task markdown, so the archive move is what makes the card leave every
lane; without it the deleted mission would be re-projected on the next refresh.
Cancelling is irreversible, and it is scoped to the single mission you name:
every other mission's rows and task files are untouched.

Three ways to reach it, all running the same command against the database:

| Surface | How |
|---|---|
| TUI board | Select the mission, press `Shift+X`, then press `Shift+X` again to confirm. `Escape` dismisses, and `Enter` — which confirms every other action — does nothing here. |
| Web board | Click the red `cancel ✕` button on the card, then click `delete <mission> lifecycle rows` in the panel that opens. `keep mission` dismisses it. |
| Terminal | `px cancel <slug> --yes`. Without `--yes` the command explains what would be deleted and exits without touching anything. |

The confirmation is deliberately different from the ordinary lifecycle
confirmation on every surface, so a reflexive keypress or click on the wrong card
cannot delete a mission.

### What cancelling keeps

Recorded usage statistics survive. Those rows hold the tokens actually spent and
the money actually charged; a cancelled mission still cost what it cost, so
cancelling never punches a hole in cost history. Weekly stats and cohort reports
keep counting the cancelled mission's spend.

### What stays your job

Cancelling touches the database only. It prints the git cleanup and stops:

```sh
git worktree remove <path> && git branch -D <branch>
```

Run that yourself when you are ready. Parallix never removes a branch, a
worktree, a remote branch or a pull request as part of a cancellation. The task
file is archived, not deleted, and keeps whatever `status` it had: move it back
out of `backlog/archive/tasks/` and set its `status` to `backlog` if you plan to
redo the work.

## Leaving

Press `q` or `Ctrl+C`.

## Launching the board

Use `px` with no command from an interactive terminal for the default board
launch. `px ui` continues to launch the same board explicitly. To opt out of the
default for one invocation, run `PARALLIX_NO_TUI=1 px`; set that environment
variable in your shell environment to keep usage help as the no-command default.
