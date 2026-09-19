# ADR 0059: Fleet-level recovery supervisor

Status: Accepted
Date: 2026-09-12
Related: ADR 0037 (workflow coordination), ADR 0048 (fail-closed harness),
ADR 0051 (application boundary), ADR 0053 (persistence authorities)

## Context

Recovery today is local to the command that observed a failure. ADR 0048
classifies a known failure and the rebound kernel repairs it inside handoff,
review, or rebase, under a finite attempt budget.

Nothing covers a mission that stops *between* commands: an operation exits
without reaching the next lifecycle state, a rebound exhausts or misclassifies
an incident, review or Git state is recoverable but no command is running, or a
failure-specific repair prompt cannot solve what a fresh agent in the worktree
can. Those missions pile up on the board's "needs your attention" queue and wait
for a human.

The operator's working fix is already known: start a fresh agent in the mission
worktree and say "this is stuck, diagnose it and fix it without breaking the
mission or the repository". This ADR makes that a supported capability instead of
adding a failure-specific prompt for every stranded state.

The constraint that shapes it: TASK-2479 makes `px integrate` the human landing
decision. Autonomous recovery may bring a mission to `integration`; it must never
land one.

## Decision matrix: what supervises

| Option | Bounds recovery | Diagnoses before investigating | Crosses the human landing boundary | Decision |
|---|---|---|---|---|
| Stateless per-tick supervisor with five decisions (`observe`/`advance`/`recontext`/`main-blocker`/`escalate`) | No — a per-tick budget resets every tick | Yes — the coordinator must pick the repair up front | Yes — an enabled `integrate` reads as a forward step | Rejected |
| Persistent LLM supervisor conversation | Only by prompt discipline | Partly | Unbounded by construction | Rejected — duplicates state Parallix already owns, adds conversation recovery |
| More failure-specific ADR 0048 prompts | Yes, per failure | Yes — needs a classifier rule before an agent may look | No | Rejected as the fleet answer; still right for repeatable known failures |
| **Deterministic operator-started loop over the board's attention queue, with a fresh recovery agent as second line** | Yes, per failure | No — the agent investigates | No — integration items are left for the human | **Accepted** |

## Decision matrix: what it reacts to

| Option | Agrees with what the operator sees | Knows a live agent needs nobody | Carries the reason and the command | Decision |
|---|---|---|---|---|
| A private "stuck" heuristic over lanes and gates | No — a second definition to keep in step | Must re-derive it | Must re-derive both | Rejected |
| Mission ids the operator passes on the command line | Only for the ids typed | Yes | No | Rejected as the trigger; kept as a filter |
| **The board's needs-attention queue (`projections/board.ts`)** | Yes — same list, same order | Yes — `attentionReason` returns `none` while an agent works | Yes — `reason` plus the typed `action` an operator would press | **Accepted** |

## Decision matrix: budget counting

| Option | Bounds a repeating failure | Survives a new failure appearing | Matches the rest of the repository | Decision |
|---|---|---|---|---|
| Per tick | No — resets on every poll | n/a | No | Rejected |
| Per mission per run | Yes | No — a later, different failure inherits an exhausted count | No | Rejected |
| Persisted `Attempt` entity | Yes | Yes | No — ADR 0053 excludes the entity | Rejected until supervision is unattended |
| **Per failure, process-scoped (`DEFAULT_REBOUND_ATTEMPTS`)** | Yes | Yes | Yes — same counting as the rebound kernel | **Accepted** |

## Decision

Add a fleet-level recovery supervisor above command-local recovery. It is
deterministic orchestration, operator-started and process-scoped: no daemon, no
second mission state machine, no new persistence authority.

**Work list.** The board's attention queue, re-read every pass, in the board's
order. The board remains a read model: before acting, the supervisor uses the
existing application use cases, which read the Mission, Git, review and
current-work authorities themselves (ADR 0053). Missions may be named on the
command line to narrow the run; that filters the queue, it does not replace it.

**Per item, per pass, at most one step:**

1. an item whose action is `integrate:merge` is left on the board — the
   supervisor never integrates;
2. otherwise the action the item advertises is run through its existing use
   case, once per distinct mission state, so an action that does not help is not
   repeated;
3. when the item survives that action, one fresh recovery agent runs in the
   mission worktree, and the fleet carries on while it runs;
4. a failure that survives its budget is escalated with what was observed.

At most one step per item per pass, so a mission waiting on an agent never holds
up the rest of the queue.

**Live work.** The queue ranks a blocking reason and a failed gate above
liveness, so a mission with a live agent can appear on it. Liveness is therefore
rechecked from the authorities immediately before *anything* is dispatched —
before a board action as well as before a recovery launch — and credible current
work (`live` or `unverified`) stops both.

**Recovery worker.** A fresh agent context in the existing mission worktree. The
launcher resumes a prior session whenever a stored marker matches the mission,
role and family, so a recovery launch supplies a session-marker port that reports
no marker and records none: the stuck transcript is never resumed and the
implementer's own session identity is never overwritten. Its tokens are recorded
against the mission's execute stage like any other launch, so supervision does
not under-report usage. Recovery is never gated on an ADR 0048 classification:
a conservatively `HumanOnly` diagnostic must not veto an investigation. It
receives the mission, its worktree, the lane, the board's reason *as evidence
rather than as a cause*, the action that failed, and its constraints. It may
inspect, edit within the mission contract, run gates, and commit to the mission
branch. It may not change `MISSION.md` scope, weaken a gate, edit the database to
manufacture lifecycle or review state, approve or review its own repair, merge,
or run `px integrate`. A defect outside the mission's scope, or on the primary
branch, is escalated with evidence and never absorbed into the mission.

**Verification.** A recovery agent's exit proves nothing. An item counts as
cleared only when the board stops asking about it on a later pass, and an item
that clears and returns is stuck again: it is supervised afresh, keeping the
attempts its failure already spent.

**Budget.** Per failure — the attention reason, normalized so a moved line
number, count or timestamp is the same failure — defaulting to
`DEFAULT_REBOUND_ATTEMPTS`. Rebound attempts inside commands do not consume it.
Exhausting it escalates that failure for the run; a different failure on the same
mission gets its own attempts.

**Transient failure.** Nothing the supervisor depends on is assumed reliable.
A board action that fails is retried once against the same state before the press
is spent and recovery takes over, so a flaky command does not cost an agent —
and a command that always fails still reaches recovery and escalation instead of
being retried forever. A board read that fails is reported and retried; after a
bounded number of consecutive failures the run hands the failure to the operator
rather than reporting an unreadable board as an empty one.

**Concurrency.** One step per mission at a time, and one recovery agent per
mission including across two local supervisor runs. Liveness — asked before every
dispatch and every launch — is read from the current-work authority for that one
mission, not by rebuilding the board: the queue read at the top of each pass is
the work list, and one projection per pass is what the loop costs. Steps are not serialized
across missions: a launcher call blocks until its agent exits, so awaiting one
mission would stall the fleet behind it. Each pass therefore races the running
steps against the polling interval — a mission that becomes stuck while every
running agent is slow is still discovered — and a pass in which nothing moved
waits out that interval rather than spinning on steps that return immediately.

The polling pause is a referenced timer that the loop cancels when it stops
waiting on it: while the supervisor waits on another process's agent or claim,
nothing else keeps this process alive, and an unreferenced pause would let it
exit mid-supervision.

The cross-run claim publishes its owner before it becomes visible; takeover of a
dead owner is serialized by its own lock and re-reads the owner under it, so two
runs that saw the same corpse cannot both take the mission; and a release removes
only the claim that call published, so a run that was taken over cannot delete
its successor's. Because the mission's own claim is taken by that atomic
move-aside, it stays single-owner even if the lock above it were contested. The
takeover lock obeys the same ownership rules as a claim —
recovering one abandoned by a dead holder is itself a single-winner takeover, and
liveness is decided by the recorded pid rather than by age, because an old lock
is not a dead one.

**Observability.** Recovery is published through the existing current-work
mechanism as a `recovery` phase. It is operational evidence, never a lifecycle
lane and never a persisted attempt.

## Prior art

| Source | Lesson taken |
|---|---|
| ALMAS — arXiv:2510.03463 | Supervise across workers, bound recovery, escalate with summarized evidence |
| Addy Osmani, "The Code Agent Orchestra" | Replace a repeatedly stuck context with a fresh agent; enforce a hard limit |
| Anthropic, multi-agent orchestration guidance | Self-contained worker tasks; verify output separately from the worker's claim |
| LangGraph supervisor vs. swarm | One visible routing point beats peer-to-peer handoffs |
| GitHub Copilot CLI `/fleet` | Observe-then-dispatch over isolated workers |
| OODA / agent-loop literature | A finite observe-decide-act loop needs an explicit stopping condition |
| Anthropic, long-running agent harness design | Accumulated context degrades; anchor recovery in durable repository state |

## Consequences

Positive:

- Missions stranded outside a running command recover without a human.
- The supervisor and the operator react to the same list, so there is one
  definition of "needs attention".
- Unknown failures no longer require a classifier rule before an agent may look.
- Known deterministic failures still take the cheaper ADR 0048 path first.
- Repair is proven by the board, not by an agent's self-report, and independent
  review is still required for code a recovery agent changed.
- Autonomous recovery cannot cross the human integration boundary.

Negative:

- A broad recovery agent costs more runtime than a narrow rebound prompt.
- Two recovery layers now exist and their responsibilities must stay distinct.
- The loop needs explicit concurrency, cancellation and shutdown semantics.
- Infrastructure failures and primary-branch defects still need a human.

## Reconsideration triggers

- Supervision becomes unattended or remotely coordinated: ownership, persistence
  and concurrency change, and the process-scoped budget no longer holds.
- A recurring failure mode emerges from recovery evidence: promote it into the
  ADR 0048 dispatch table instead of paying for an investigation each time.
- The attention queue stops being a faithful "needs a human" list: the work list
  must be re-decided before the supervisor is trusted with it.

## References

- `docs/adr/0037-ai-workflow-coordination-architecture.md`
- `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`
- `docs/adr/0053-operational-persistence-and-authority-boundaries.md`
- `src/application/recovery-supervisor.ts`, `src/application/rebound-kernel.ts`
- `src/application/projections/board.ts`
- TASK-2352, TASK-2377.03, TASK-2479
