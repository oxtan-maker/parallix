# Mission: Fleet recovery supervisor — watch the board, unstick agents (task-2489)

## Goal
Give Parallix a supervisor that works down the board's "needs your attention"
queue — the same list an operator sees. For each item it presses the action the
board already advertises, and when that does not clear the item it starts a
fresh agent in that mission's worktree to work out why progress stopped and
restore a state the normal workflow can continue from. It never writes mission
deliverables itself and never integrates anything.

## Why Now
Rebounds recover a single failing check inside a single command (ADR 0048,
`src/application/rebound-kernel.ts`). Nothing watches the fleet. A mission that
stops *between* commands — the agent exited without a handoff, a gate failed
after the process that would have bounced it died, review state is recoverable
but no command is running — stays parked until a human notices it. The manual
fix that works today is a fresh agent in the mission worktree told "this is
stuck, diagnose and fix it without breaking the mission or the repo". This
mission makes that a supported capability.

## Research Basis (recorded in the ADR)
1. **ALMAS** (arXiv:2510.03463) — a supervisor monitors all workers, keeps
   recovery history, bounds retries, and hands unresolved work to a human with
   summarized evidence.
2. **Addy Osmani, "The Code Agent Orchestra"** — detect stalled workers, replace
   a repeatedly stuck agent with a *fresh* one, enforce hard iteration limits.
3. **Anthropic, multi-agent orchestration guidance** — self-contained worker
   tasks, externalized state, verification separate from the worker's own claim.
4. **LangGraph supervisor vs. swarm** — one visible routing point beats
   peer-to-peer handoffs.
5. **GitHub Copilot CLI `/fleet`** — observe-then-dispatch over isolated workers.
6. **OODA / agent-loop literature** — a finite observe-decide-act loop with an
   explicit stopping condition.

Plus Anthropic's long-running-agent harness work: accumulated context degrades,
so recovery starts a new session anchored in durable repository state rather
than resuming the failed one.

## Scope
- Record the decision in an ADR under `docs/adr/`.
- Add a deterministic supervisor in the application layer whose work list is the
  board's existing attention queue: each pass re-reads the queue and takes at
  most one step per item, so a mission waiting on recovery never holds up the
  rest and an item that appears mid-run is picked up.
- Per item, per pass: leave an item the human owns (integration) alone; press the
  action the item advertises, once per distinct mission state, through its
  existing use case; otherwise start one fresh recovery agent in the mission
  worktree with what the board reported, the action that failed to clear it, and
  explicit constraints.
- Recheck liveness from the authorities immediately before dispatching anything
  — a board action as much as a recovery launch — because the queue ranks a
  blocking reason and a failed gate above liveness.
- Start the recovery agent in a new session rather than resuming the stuck one,
  and record its token usage so mission statistics do not under-report it.
- Keep the fleet moving while an agent runs: one step per mission at a time, but
  never one mission's launcher blocking another mission's supervision, and never
  blocking discovery of a mission that becomes stuck meanwhile.
- Spend the polling interval when a pass moves nothing, rather than spinning on
  missions that are live or claimed elsewhere, and keep that pause referenced so
  waiting on another process's work cannot let this one exit.
- Re-read the queue from the authorities every pass. The board is the
  observation surface, never mutation authority (ADR 0053).
- Count an item cleared only when the board stops asking about it, never on the
  agent's exit, and supervise a cleared item again if it returns to the queue.
- Bound recovery per failure, the way every other retry budget in this repository
  is counted (`DEFAULT_REBOUND_ATTEMPTS`): the same failure surviving the budget
  escalates; a genuinely different failure reopens an escalation and gets its
  own attempts.
- Keep one recovery agent per mission at a time, including across two local
  supervisor runs, and recheck current work immediately before launching.
- Make recovery visible through the existing current-work mechanism as an
  operational phase, never a lifecycle lane.
- Add the headless entry point (`px lead`) and update durable documentation
  where supported behavior changes.

## Out of Scope
- Autonomous integration. `integration` is terminal; there is no supported path
  from a supervisor or recovery context to `px integrate` (TASK-2479).
- A persistent LLM supervisor conversation, a daemon, or a cron entry.
- A durable recovery-attempt entity or any new persistence authority (ADR 0053).
- The supervisor editing mission deliverables, gates, review state, or the
  operator database itself.
- Fixing a defect that belongs to the primary branch, or outside the mission's
  scope, inside the mission.
- Peer-to-peer messaging between mission agents.

## Success Criteria
- An ADR under `docs/adr/` cites the six sources with the lesson each
  contributes and records the recovery authority, the per-failure budget, the
  verification rule, and the integration boundary.
- With no mission named, the supervisor works every item on the board's
  attention queue, in the board's order, re-reading it every pass: an item that
  appears mid-run is worked without restarting.
- A mission with credible current work (`live` or `unverified`) receives no
  command and no recovery agent, including when the board ranks its failed gate
  or blocking reason above liveness and puts it on the queue anyway.
- A recovery launch starts a fresh session: the launcher is told there is no
  marker to resume, and its usage is attributed to the mission's execute stage.
- A mission whose launcher has not returned does not stop other missions from
  being supervised, and still gets only one step at a time.
- A cross-run claim publishes its owner before it is visible, is refused while
  that owner lives, and is taken over only when a readable owner is gone; two
  runs that observed the same dead owner cannot both take it, and a release
  removes only the claim that call published.
- A mission that becomes stuck while another mission's agent is still running is
  discovered without waiting for that agent.
- A pass over missions that are live or claimed elsewhere waits out the polling
  interval instead of re-reading the queue immediately, on a referenced timer
  that the loop cancels once it stops waiting on it.
- A board action that fails is retried once against the same state; one that
  keeps failing still reaches recovery and escalation rather than being retried
  forever.
- An unreadable board is reported and, after a bounded number of consecutive
  failures, handed to the operator — never reported as an empty queue.
- Liveness is read from the current-work authority for the mission being acted
  on, so a pass costs one board projection rather than one per liveness check.
- Recovering a takeover lock abandoned by a dead holder is ownership-safe: age
  never decides liveness, and two contenders that saw the same abandoned lock
  cannot both enter the takeover.
- An item that clears and returns is supervised again with the attempts its
  failure had left.
- An item that resolves to `px integrate` is left on the board: no command is
  run, no agent is started, and the supervisor has no integrate path at all.
- The action the item advertises is pressed before any recovery agent is
  considered, and is not pressed again against the same mission state.
- The recovery agent's instruction carries the board's reason as evidence
  (not an asserted cause), the operation that failed, and the prohibitions on
  scope change, gate weakening, manufactured review, self-review, merging, and
  `px integrate`.
- A diagnostic that a failure classifier would call human-only does not by
  itself prevent a recovery attempt.
- The same attention reason surviving the budget escalates with the observed
  evidence; a different reason on the same mission reopens that escalation and
  gets its own attempts.
- A recovery agent that exits successfully while the item stays on the queue is
  not counted as a repair.
- A mission already claimed for recovery by another supervisor run is not
  recovered twice, and the claim is released even when the launch throws.
- Current work is rechecked inside the claim, immediately before the launch, and
  work that started in that window cancels the recovery.
- One escalated mission does not stop the rest of the fleet.
- Focused unit tests in `test/task-2489-recovery-supervisor.test.ts` mock every
  external boundary and complete within 500 ms when run alone.
- `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`
  succeed on the final mission tree.
