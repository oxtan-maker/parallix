# CP-1: Fleet recovery supervisor

## Summary of work done

`px lead` works down the board's "needs your attention" queue — the same list
the web board shows a human. It is not given a mission: with no arguments it
takes the whole queue, in the board's order, re-reading it every pass so an item
that appears or clears mid-run is seen without restarting. Naming missions
narrows it.

- `docs/adr/0059-fleet-level-recovery-supervisor.md` — the decision, replacing
  the earlier stateless-tick ADR of the same number, which it now records as a
  rejected alternative (a per-tick budget bounds nothing when ticks repeat, and
  driving an enabled `integrate` crosses the human landing boundary).
- `src/application/recovery-supervisor.ts` — the loop. Its work list is the
  board's attention queue, which already excludes missions with a live agent,
  already carries the reason, and already resolves the command an operator would
  press. Each pass takes at most one step per item: leave an item the human owns
  alone, press the advertised action once per distinct mission state, else start
  one fresh recovery agent in the mission worktree. An item counts as cleared
  only when the board stops asking about it. `HUMAN_ONLY_ACTIONS` holds
  `integrate:merge`, and no supervisor path runs it.
- Budget is per failure: `failureFingerprint` keys attempts by the normalized
  attention reason, defaulting to `DEFAULT_REBOUND_ATTEMPTS` — the same counting
  every other retry in this repository uses. A reason that survives its attempts
  escalates; a different reason reopens that escalation with its own attempts.
- Transient failure is bounded in both directions. A failed board action is
  retried once against the same state, then the press is spent so recovery and
  escalation still happen — a command that always fails is never retried forever.
  A failed board read is reported through `onBoardReadFailure`, retried, and
  after `BOARD_READ_ATTEMPTS` consecutive failures the run throws rather than
  reporting an unreadable board as an empty one.
- Liveness is read from the current-work authority for the one mission being
  acted on (`ConcreteCurrentWorkReadAdapter.loadMissionCurrentWork` plus
  `reconcileCurrentWork`), so a pass costs one board projection rather than one
  per liveness question.
- Concurrent in-process immediate SQLite writers take turns instead of blocking
  the holder synchronously; a queued writer gives up with `SQLITE_BUSY` after the
  connection's busy timeout, and commit, rollback and close all hand the turn
  back even when the statement under them throws, so a failed transaction cannot
  strand every other writer in the process.
- `src/interfaces/cli/lead.ts` — `px lead [--once] [--poll <seconds>]
  [--budget <n>] [--dry-run] [<mission>…]`, reporting the queue after each pass
  and printing the observed steps behind any escalation.
- `src/adapters/filesystem/recovery-claim.ts` — the cross-run claim. The owner
  record (pid plus a random token) is written into a staging directory that is
  then `rename`d into place, so a claim is never visible without its owner.
  Stealing a dead owner needs a separate takeover lock and re-reads the owner
  under it, so two runs that saw the same corpse cannot both take the mission; an
  unreadable claim is left alone rather than stolen; and a release removes the
  directory only while its token is still the caller's. The takeover lock follows
  the same rules: recovering one abandoned by a dead holder is a single-winner
  `rename`, and liveness comes from the recorded pid, never from age.
- Liveness is rechecked from the authorities before *anything* is dispatched, not
  only before a recovery launch: the queue ranks a blocking reason and a failed
  gate above liveness, so a live mission can be on it.
- Steps run per mission without serializing the fleet: a launcher call blocks
  until its agent exits, so one mission's agent must not stall the rest. Each
  pass races the running steps against the polling interval, so a mission that
  becomes stuck while every agent is slow is still discovered; a pass in which
  nothing moved waits the interval out instead of spinning on steps that return
  `watching` immediately.
- `src/adapters/process/polling-pause.ts` — the pause is a referenced timer,
  because nothing else keeps the process alive while the supervisor waits on
  another process's agent or claim, and the loop cancels the pause it drops so no
  referenced timer outlives its pass.
- Recovery launches carry `FRESH_SESSION_MARKER_PORT`, so the stuck session is
  never resumed, and record their telemetry on the mission's execute stage
  (`recovery` is a mapped token-using activity in `src/domain/usage.ts`).
- `src/application/recording/current-work-recorder.ts` gains the `recovery`
  phase, so recovery is visible as operational work and never a lifecycle lane.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The work list is the board's needs-attention queue, in the board's order, re-read every pass | `test/task-2489-recovery-supervisor.test.ts`, `"the work list is the board attention queue, in the board order"` and `"an item that appears mid-run is picked up on the next pass"` | PASS |
| A mission with credible current work is never touched, including when the board ranks its failed gate first; `unverified` counts as working | `test/task-2489-recovery-supervisor.test.ts`, `"a mission with a working agent is never on the queue, so it is never touched"` and `"a live agent is never dispatched onto, even when the board ranks its failed gate first"` | PASS |
| A recovery launch starts a fresh session and does not resume the stuck one | `test/agents.test.ts`, `"a recovery launch uses the fresh-session marker port"` | PASS |
| A recovery launch's usage is attributed, so mission statistics do not under-report it | `test/task-2489-recovery-supervisor.test.ts`, `"a recovery launch is attributed, so mission usage does not under-report it"`; `AGENT_WORK_STAGE_BY_ACTIVITY.recovery` in `src/domain/usage.ts` | PASS |
| A mission whose agent is still running does not stop the fleet, and still gets one step at a time | `test/task-2489-recovery-supervisor.test.ts`, `"a mission whose agent is still running does not stop the rest of the fleet"` | PASS |
| A claim is never visible without its owner, and only a readable dead owner is taken over | `test/task-2489-recovery-supervisor.test.ts`, `"a claim is never visible without its owner, and only a readable dead owner is taken over"` | PASS |
| Two runs that observed the same dead owner cannot both take the claim, and a release removes only the caller's own | `test/task-2489-recovery-supervisor.test.ts`, `"two runs that saw the same dead owner cannot both take the claim"` and `"a release removes only the claim the caller published"` | PASS |
| A mission that becomes stuck while another mission's agent is pending is still discovered | `test/task-2489-recovery-supervisor.test.ts`, `"a pending agent does not stop the queue from being read for new missions"` | PASS |
| A pass that moves nothing waits out the polling interval instead of spinning | `test/task-2489-recovery-supervisor.test.ts`, `"a live or claimed mission is polled, not spun on"` | PASS |
| Liveness is read per mission instead of by rebuilding the board, and an unreadable current-work authority stops the step | `test/task-2489-recovery-supervisor.test.ts`, `"liveness is read per mission, not by rebuilding the queue"` and `"an unreadable current-work authority stops the step instead of dispatching"` | PASS |
| The polling pause keeps the process alive while it waits, and the loop cancels the pause it drops | `test/task-2489-recovery-supervisor.test.ts`, `"the polling pause keeps the process alive, and the loop cancels the one it drops"` | PASS |
| An abandoned takeover lock is recovered ownership-safely: age never decides liveness, and two contenders cannot both enter | `test/task-2489-recovery-supervisor.test.ts`, `"a contender that recovers the abandoned takeover lock first is not displaced"` and `"an abandoned takeover lock whose holder is alive is left alone"` | PASS |
| An item that clears and returns is supervised again with the attempts it had left | `test/task-2489-recovery-supervisor.test.ts`, `"a mission that clears and comes back is supervised again, keeping the attempts it spent"` | PASS |
| The supervisor never integrates: an integration item is left for the human | `test/task-2489-recovery-supervisor.test.ts`, `"the supervisor never integrates: an integration item is left for the human"` | PASS |
| The board's advertised action is pressed once per state before any recovery agent | `test/task-2489-recovery-supervisor.test.ts`, `"the board action is pressed once per state, then recovery takes over"` | PASS |
| The recovery agent gets the board reason as evidence, the action that failed, and its constraints | `test/task-2489-recovery-supervisor.test.ts`, `"the recovery worker gets the board reason, the action that failed, and the constraints"` | PASS |
| A human-only-looking reason does not by itself veto a recovery attempt | `test/task-2489-recovery-supervisor.test.ts`, `"an attention reason a classifier would call human-only still gets a recovery attempt"` | PASS |
| The budget is spent per failure, and a different reason reopens an escalation with its own attempts | `test/task-2489-recovery-supervisor.test.ts`, `"the budget is spent per failure, like every other retry budget in the repo"`, `"a different attention reason reopens an escalated mission with its own attempts"`, `"the same reason with a moved line number or count is still the same failure"` | PASS |
| Transient board reads and command dispatches do not abandon work or spend recovery budget | `test/task-2489-recovery-supervisor.test.ts`, `"a transient board read waits and does not orphan an in-flight step"`, `"a transient board-action failure is retried before recovery"` | PASS |
| A command that keeps failing still reaches recovery and escalation; an unreadable board is reported and fails instead of looking empty | `test/task-2489-recovery-supervisor.test.ts`, `"a persistently failing board action reaches recovery and escalation"`, `"an unreadable board is reported and fails instead of looking empty"` | PASS |
| Concurrent in-process immediate writers take turns, and a queued writer fails bounded instead of waiting forever | `test/sqlite-adapter-cp1.test.ts`, `"concurrent in-process immediate writers wait without blocking the first workflow"`, `"times out queued immediate writers and releases turns when the owner closes"` | PASS |
| A recovery agent's exit is not evidence: the item leaving the queue is | `test/task-2489-recovery-supervisor.test.ts`, `"a recovery agent that exits successfully is not itself evidence"` and `"a mission the board stops asking about is cleared — the queue is the proof"` | PASS |
| One recovery agent per mission, claimed across runs, released even on failure, with liveness rechecked inside the claim | `test/task-2489-recovery-supervisor.test.ts`, `"recovery is claimed, released, and skipped when another run holds the claim"`, `"work that starts between reading the queue and launching cancels the recovery"`, `"only one supervisor run holds a mission claim, and a released claim is available again"` | PASS |
| One escalated mission does not stop the rest of the queue | `test/task-2489-recovery-supervisor.test.ts`, `"one escalated mission never stops the rest of the queue"` | PASS |
| `px lead` works the whole queue with no arguments, rejects unknown missions, reports each pass, and exits non-zero on escalation | `test/task-2489-recovery-supervisor.test.ts`, `"px lead works the whole attention queue with no arguments"`, `"px lead rejects an unknown mission instead of treating it as an empty board"`, `"px lead --dry-run prints the queue and acts on none of it"`, `"px lead exits non-zero with the evidence when a mission escalates"` | PASS |
| Recovery is operational work, not a lifecycle lane | `src/application/recording/current-work-recorder.ts` `recovery` phase; `test/persistence-inventory-guardrail.test.ts` (no new durable concept) | PASS |
| Documentation updated where supported behavior changed | `README.md`, `docs/use-cases.md` (UC-11), `src/interfaces/cli/runtime.ts` usage; `./scripts/verify-local.sh docs` PASS | PASS |
| Gates green on the final tree | `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` | PASS |
