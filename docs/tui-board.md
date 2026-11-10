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

Closed missions have no live-work attention or lifecycle actions, even when an
older activity record reports running or blocked work. Their retained activity
and audit history remain available. A done mission awaiting closeout is still
open, so closeout failures remain visible.

A blocked run that can still be retried keeps its usual `px active` retry.
A recorded contract stop, or a blocker with no eligible retry, stays visible
with its blocking detail and a concrete `px lead <mission> --once` next step.
The rail labels this as lead investigation and offers no direct lifecycle run
control. Lead never first dispatches an ineligible command. On active and review
Missions, it investigates through its bounded recovery path when operator
judgment admits that recovery: a blocker is evidence to investigate, not proof
that only a human can resolve the problem. Judgment never admits recovery for an
integration Mission, so an integration authority blocker escalates with its
blocking detail and the next step instead of being investigated.

Recovery may repair within the recorded Mission contract and continue through
supported actions. It cannot change that contract, acknowledge an operator stop,
stand down approval, manufacture review authority or integrate. If a reserved
operator decision remains, recovery must explain the decision, supporting
evidence, options and recommended next step. Unchanged blockers exhaust the
existing recovery budget; live work and workflow ownership prevent duplicate
launches. Ordinary integration handoffs remain operator-owned.

## What a card shows

Each mission card renders the facts the projection supplies:

```text
▍task-2304 · custom
Ink TUI wave 2: lane columns and responsive layout
cp CP-2.md · gate ✓
next: run the verification gate
PR 42 · review approved
▲ waiting on upstream fix
```

- **slug and agent** — the mission id and the assigned agent family.
- **title** — truncated with `…` when it does not fit the column.
- **checkpoint and gate** — the last recorded checkpoint and the state of the gate
  that applies now (see [Gate states](#gate-states)).
- **next step** — recorded guidance from the `Next action:` line of that
  checkpoint.
- **pull request and review** — the PR number when one exists, and whether the
  current revision is approved.
- **blocking reason** — a red flag line, shown only when the mission is blocked.

A fact the projection does not have reads `unavailable`. That is deliberate: the
card distinguishes "we know there is nothing" from "we could not read this", and
it never guesses a value the workflow has not recorded.

Backlog and refined web cards with current work show its summary or blocking
reason, and name the family the provider observation saw in the same header
label a flight card uses. The assigned family never stands in for the executing
worker, and no card header carries a work badge or an execution count row.

A web flight card with an unresolved retained repair shows its usage below the
existing progression row, for example `repair attempts spent (2/2)`. Its tooltip
distinguishes the autonomous review allowance from repair usage. Review history
keeps one mark per recorded round. The Review recovery disclosure carries the
recorded recovery guidance; repair usage does not change enabled actions.

Web cards show the available commands alongside Cancel. When no command can
run, one unavailable control explains why. Commands that can run together remain
individually accessible.

On the web board, hold an enabled refinement, execution, or review button with
mouse or touch to choose an agent family for that launch. A short click keeps
the usual automatic selection. The menu shows the server's known families and
availability; unavailable families cannot be selected. Choosing an available
family sends one launch request. If that family becomes unavailable, the request
reports the problem instead of silently choosing another family.

With the button focused, press Arrow Down or Shift+F10 to open the menu. Use
arrow keys, Home or End to move between available families, and Enter or Space
to choose. Escape closes the menu and returns focus to the button; clicking
outside also dismisses it. Releasing a hold, cancelling a touch gesture, or
moving away before the hold completes does not choose a family. Family choice
is unavailable while a command is pending and does not replace a running worker.

Integrate started from the web or terminal board runs in the mission's own
worktree and lands on its recorded base, wherever `px web` or `px ui` was
started; the host never changes directory and needs no restart per mission. If
the mission worktree is missing, is on another branch, or the base cannot be
resolved, the command stops before any merge or push and its outcome names the
mission and the missing fact.

In-flight web cards put checkpoint progression, gate status, and pull-request
review information on one compact row in implementation order: checkpoints →
gates → review.
The bounded checkpoint control retains the existing solid progress bar and
completion check. Its tooltip and accessible description name the completed and
total counts plus the current and recorded checkpoints; the dialog's labelled
state symbols keep completed, current, and future entries distinct without
colour alone.
Current work does not add completion. Checkpoint
names are labels, so sparse names do not change the supplied plan size. Missing
or empty plans omit the checkpoint control while leaving the gate status visible;
legacy plans with omitted states show completion unknown as a disclosure without
an empty progress track, even when evidence is present. Checkpoint tracks
never blink.

Click the checkpoint track, or focus it and press Enter or Space, to open the
checkpoint dialog, including in intake cards and the expanded done rail. A
checkmark to the right means every supplied checkpoint is explicitly completed.
The dialog opens on the supplied current checkpoint, or the recorded checkpoint when no current entry is
supplied. Select any checkpoint to read its description and Goal Check evidence;
planned entries without evidence remain available.
Close the evidence panel with its close control, Escape, or the backdrop.
Checkpoint indicators stay beneath the terminal and mission edit dialogs, so
they cannot cover dialog content or receive clicks through a backdrop.

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
the preceding non-overlapping seven days in the machine local timezone. Dates
advance at local midnight; new deliveries appear on refresh throughout the day.
A mission belongs to a comparison by
its delivery-completion day, even when it started earlier; once selected, its
whole lifecycle and recorded agent work are included. Each decision figure
shows its observation count, so an unavailable or partly measured statistic is
not mistaken for a zero.

The current-flow section answers a different question: WIP, lane age,
bottleneck, and agent availability describe the state now and are not forced
into the completed-mission window.

In `px web`, use **Board** and **Flow** in the header to switch between current
operations and the completed-mission view. Flow keeps one cohort visible at a
time: **All agents** or a concrete recorded implementer family, paired with the
current or previous decision window. **Mission order** preserves the observed
step sequence; **Longest first** reorders only the elapsed-time rows. The cards,
actor graph, return paths, timing rows, totals and state cards all come from the
same selected projection. Missing observations remain named collection gaps,
and elapsed time without a recorded owner is shown as not observed rather than
assigned to an actor or replaced with zero. Wide graph and timing regions scroll
locally on narrow screens so their labels and return loops keep their desktop
geometry.

## Where each fact comes from

The board reads what the lifecycle already recorded. It never queries the review
provider and never launches an agent of its own, so a field stays `unavailable`
until the step that produces it has run.

| Field | Source | Appears after |
|---|---|---|
| recorded checkpoint, guidance, Goal Check | recorded Mission checkpoint evidence | the executing agent records checkpoint evidence |
| gate | executor observations and verification evidence for the mission worktree's current inputs (see [Gate states](#gate-states)) | the mission declares a gate, or integration gates are configured |
| pull request | the pull-request reference the review loop records on the round once it confirms an open PR | `px review` with a review provider configured |
| agent availability | the `agent_blocklist` table | an agent hits a provider usage limit |
| cycle time | the `board_lane_events` table | any lifecycle step: mission intake (entry into `backlog`), every lane transition, `integration → done`, and closure |
| agent runtime | the `duration_minutes` column of the `usage_statistics` table, summed per mission over its recorded runs | an agent finishes a run and its measurement is written |
| operations | the `operational_history` table | `px active`, `px review`, or `px integrate` |

### Gate states

Before integration, the gate is the set of gates the mission declares; from
integration on, it is the repository's configured pre-integration plan. The
card shows one state:

| State | Meaning |
|---|---|
| `running` | the integration gate executor is observed running for the owning workflow attempt, or by a live `px integrate --dry-run` process that owns no workflow operation |
| `passed` | every applicable gate has a passing result that covers the worktree's current inputs |
| `failed` | a gate failed on the current revision, and no later pass covers the same inputs |
| `stale` | the only results cover an earlier revision, earlier inputs or uncommitted changes |
| `not-run` | gates apply but none has a result yet, including a mission that has not started |
| `unconfigured` | the mission declares no gate, or no pre-integration gate is configured, so none will run |
| `unavailable` | the worktree or verification evidence could not be read |

Each surface renders that state in its own form. The terminal board writes it as
text (`gate ✓`, `gate ✗ FAIL`, `gate · stale`); the web board renders the same
state as an inline icon whose accessible name is the state, with no visible gate
text, and only the running icon moves.

Passing results are the verification proofs the gate executor writes after an
exit code of 0. Failures are the recovery evidence captured before a repair
starts. Integration results come from the executor's verification evidence and the
per-hook validation records that `px integrate` keeps for each commit. A record
covering only part of the configured plan cannot pass the whole plan. The lifecycle
lane, an agent's prose and a `PASS` row in a Goal Check table never produce a gate
result; ADR 0048 classifies such reports as unverifiable claims. Workflow checking
alone does not show a running gate. A cancelled integration run supersedes prior
success and contributes no passing evidence.

Gate observations share one view of each worktree’s inputs during a board refresh.
The next refresh reads those inputs again, so checkout, branch and toolchain
changes cannot retain an earlier refresh’s passing state.

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
| Web board | Click the red `cancel ✕` button on the card, then click `delete <mission> lifecycle rows` in the dialog that opens. Focus starts on `keep mission`; Tab stays inside the dialog, and `Escape` keeps the mission. The dialog remains visible above a scrolled board and checks the latest action availability before sending. |
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

Once a mission reaches `done`, cancellation is unavailable. An interrupted
integration closeout resumes through `px integrate <slug> --recover-landed` so
the remaining statistics, cleanup and post-integration hook finish without
another gate run or merge.

Integration picks its checkouts from the Mission rather than from the directory
you invoked it in, so the same command lands the same mission from the primary
checkout or from the mission checkout. If no mission checkout remains, the
command either points at `--recover-landed` when the landing is already on the
receiving base, or names the mission and the checkout it expected; it never
falls back to running integration in the current checkout.

From the repository root, `px status` checks stored Mission state before calling
a retained worktree stale. Live Missions stay out of cleanup diagnostics even
when their task mirror is missing or still says `done`. If Mission authority is
unavailable, unreadable or has no matching Mission in this repository, status
reports uncertainty without a cleanup command. A missing or completed task
mirror alone does not establish safe cleanup. Done and closed Missions retain
guarded landed-recovery advice; recovery still checks that landing occurred.
The scan uses the requested repository and normalizes branch slugs just like
single-Mission status. Read failures include their underlying cause. A retained
worktree can outlive cancellation, which deletes its Mission record; status
cannot reconstruct that lifecycle from a branch or an old task mirror.

## Creating a mission (web board)

`px web` has a **Create new mission** button in the top bar. It opens a dialog
that adds a mission to the backlog of the repository the board is serving:
nothing is drafted, no agent starts and no worktree is created. Use
`px draft` or `px active` when you want that work to begin.

| Field | Notes |
|---|---|
| Title | Required. |
| Description and context | Description is free text. Context (why the mission exists) is optional; with both, they are recorded as the mission's goal and why. A description alone is kept as the description, and refinement still requires a goal and why, which the refining agent fills in from it. Context without a description is rejected. |
| Labels | Comma separated. |
| Success criteria | Edit each criterion in its own row. **Add criterion** adds a focused blank row; **Remove** deletes only that criterion. Remove every row to clear the list. Line breaks within a row stay part of that criterion. |
| Dependencies | Pick any number of unfinished missions from the dropdown. Finished, closed and unknown missions are refused. Dependencies are recorded for operators and agents; nothing enforces them. |

Parallix assigns the mission its identity (`px-NNNN`) and the new card
appears in the backlog lane. Fields that fail validation keep what you typed and
say what to fix. Retrying a submission that did reach the host returns the
mission it already created, rather than creating a second one. `Escape` or **Cancel** closes the dialog without creating anything.
The terminal and TUI have no equivalent button; they create missions through
`px draft`.

Each unfinished card has an **Edit** action. It loads the mission's current
planning values into the same keyboard-accessible form. **Save changes** replaces
the fields listed above; clearing optional text, labels, criteria or dependencies
removes those values. Saving keeps the mission's identity, ownership, lane and
execution/review evidence. Saved titles remain visible after refresh and reload;
editing an old Backlog input does not rename an already-recorded mission.
Finished missions cannot be edited.

**Cancel** or `Escape` discards the form. A failed save keeps your entries and
shows the reason. If another writer changed the mission, cancel and reopen
**Edit** to load the latest values before reapplying your changes; a stale form
cannot overwrite newer data. Saving disables a second submission until the
first completes. Reload the board if its refresh fails after a successful save.

## Leaving

Press `q` or `Ctrl+C`.

## Launching the board

Use `px` with no command from an interactive terminal for the default board
launch. `px ui` continues to launch the same board explicitly. To opt out of the
default for one invocation, run `PARALLIX_NO_TUI=1 px`; set that environment
variable in your shell environment to keep usage help as the no-command default.

## Browser freshness and operation history

The web board keeps informational body and metadata text at 11px or larger,
including unavailable actions and unknown states. Secondary text colors meet
4.5:1 contrast on their rendered surfaces, including faded shipped cards.
Decorative strokes and hidden glyphs use separate treatments.

Review circles show recorded rounds and outcomes, including rounds beyond five.
The round number does not indicate how many retries remain.

Focusable mission cards show hover and keyboard focus outlines. Use Up/Down to
move the current mission selection, then Enter or Space to open its operation
history; clicking the card body opens the same view. Closing it returns focus
to the card. Nested actions and disclosures keep their own behavior.
Cancel and Edit share a compact row above the primary actions, with long action
labels wrapping inside their controls.

Repeated failure reasons appear once per mission in the normal web board view.
Other surfaces keep the mission and action visible; expand **Reason** or
**Blocking reason** to read the duplicate text. Distinct reasons stay separate.
**Recovery** expands coordinator evidence beside the activity line. These
disclosures support keyboard and touch. An unknown gate stays explicitly
unknown: the web board carries its observation on the icon itself, read by
assistive technology without an extra control.

Command feedback appears in the initiating mission card's footer and is
announced as a polite status update. It follows the mission between lanes.
When the card is absent or hidden by the done or history disclosure, feedback
appears below the board with the mission ID; revealing the card moves it back
into its footer. Refreshing the board retains this feedback until another
action for that mission clears or replaces it.

The web host stays responsive while a separate process builds board data. A read
that exceeds its deadline fails individually; it does not discard work already
loading or fail other pending reads. A later refresh reuses the loaded state.
Closing `px web` also stops its board readers.

If a projection refresh fails, the browser keeps the last validated board visible
with a stale warning and the server's failure message. Stream errors request a
coordinated refresh; only a successful read begun after the latest failure can
clear it. Recovery reads are serial and coalesced. A failed recovery waits for
another stream signal, reconnect or requested refresh rather than retrying in a
loop.

Operation log times use the viewer’s local timezone in 24-hour HH:mm:ss format.
Expand a time with a click or keyboard activation to read its full date, time,
timezone and original timestamp. Missing or malformed times show “Time unavailable”;
any supplied malformed text remains in the detail. Identical phase and message
text appears once per row; distinct text and agent attribution remain visible.

The browser keeps at most 256 operation log entries. Unmatched live progress is
merged with durable history using producer timestamps, so older accumulated
progress cannot crowd a newer durable completion out of the log. Recent progress
survives a snapshot that has not yet recorded it. Explicit operation and progress
sequence identities absorb corresponding persisted entries and collapse replay;
identical message text alone never identifies an event.

Legacy history without a progress identity cannot be correlated reliably with a
live entry and may show both. Producer clocks can disagree, and equal or missing
timestamps cannot establish an authoritative order across processes. In those
ambiguous cases durable entries receive priority at the bounded tail, while live
entries remain available until their own bounded store evicts them. Durable
server order is retained; progress sequences order only their own operation.
Transient live history resets when stream cursors regress after a host restart.
