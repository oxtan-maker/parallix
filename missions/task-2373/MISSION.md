# Mission: Close live-board correctness gaps, improve refresh performance, and guarantee TUI shutdown (task-2373)

## Goal
Make the interactive `px board` faithfully reflect autonomous execution, terminate deterministically, and refresh without unbounded cost — without redesigning the TASK-2370 `currentWork` architecture.

## Why Now
TASK-2370 established `currentWork` as the mission-scoped authority for live work. Remaining correctness gaps mean the board misreports agent/phase during nested review, loses ordering under asynchronous publication, and cannot prove `q`/Ctrl+C actually kills the process. Refresh scans all historical current-work rows every 2s, costing linearly with history length. These defects compound: wrong state + slow refresh + unreliable exit = untrustworthy board.

The workflow under test is the real composed path, not isolated entry points:

`px active -> execute -> handoff -> autonomous review -> reviewer -> implementer act-on-review -> further review rounds -> integration`

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: correctness (current-work through review loop, operation-aware termination, truthful NEEDS YOU), performance (bounded current-work read, indexed query, revision-based skip), reliability (real PTY shutdown tests, resource ownership semantics)

## Scope
- Red characterization tests for every defect, written before its fix
- Current-work publication through the full autonomous review loop (reviewer and implementer launches publish actual family and phase), through multiple review rounds
- One shared application-level publication seam used by both the direct `px review` path and review invoked through `px active`
- Awaitable, ordered agent-selection/failover callbacks for authoritative current-work writes
- Operation-aware replacement and termination (`operationId` guards, durable store ordering, no new run/attempt aggregate)
- Truthful NEEDS YOU projection (autonomous exhaustion carries its blocking reason; recoverable family failover stays WORKING)
- Process liveness beyond bare PID (PID + process-start identity), including abnormal-termination ageing
- Honest operator rail (WORKING count matches visible items or shows `+N more`; legacy/recovery-evidence missions never silently vanish; no phantom `run ▶`; displayed command equals dispatched command)
- Deterministic `px board` shutdown proved by real PTY/spawned-process tests (`q`, Ctrl+C, SIGTERM, modal state, subscription cleanup, raw-mode restore, resource ownership, no process accumulation)
- Bounded current-work read (latest relevant fact per mission via indexed/bounded query), with history retained for audit
- SQLite indexes justified against the production read query
- Revision/invalidation-based skip for unchanged slow historical metrics and unchanged authority reads
- Overlapping refresh guard (no accumulating timer backlog)
- Preserved time-driven refresh for AgentBlock expiry and current-work freshness
- Performance tests proving bounded read cost, no needless recomputation, and timely detection
- Regression E2E for the happy path and the exhaustion path
- One-shot/piped board rendering remains finite

## Out of Scope
- Redesigning Mission lifecycle or `Mission.status`
- Changing the agent selection/fallback algorithm beyond publishing the selected agent correctly
- Adding permission prompts; agents remain autonomous/YOLO
- Persisting per-launch attempt analytics
- General redesign of board visual language
- Replacing SQLite operational persistence
- Building a daemon or server solely for live refresh
- Broad performance refactoring outside interactive board refresh paths
- Solving unrelated statistics correctness defects

## Success Criteria
> **Falsifiability rule:** each criterion must be falsifiable; no subjective adjectives, no vague quantifiers.

### Red first
- SC1: Each of the six defects has a characterization test that fails on the parent commit and passes after its fix: nested autonomous review reporting wrong phase/agent; asynchronous agent-change publication racing later current-work state; a terminal event from older work clearing newer work; review escalation losing its blocking reason; `q`/Ctrl+C not terminating a real interactive board; unbounded current-work history reread per refresh.

### Correct current work through the autonomous workflow
- SC2: After handoff into autonomous review, `currentWork` follows reviewer and implementer launches instead of remaining a generic handoff owned by the original implementer — verified by E2E over `execute -> reviewer -> implementer -> reviewer -> completed`.
- SC3: Reviewer launches publish the actual reviewer family and a review phase; implementer launches caused by review findings publish the actual implementer family and a review-response/act-on-review phase.
- SC4: Three or more consecutive review rounds each update the same mission's `currentWork` to the then-current family and phase.
- SC5: `px review` and review invoked through `px active` publish current work through the same application seam — verified by a test asserting a single publication call site, with no review-runtime inference in CLI, TUI, or `BoardProjectionBuilder`.
- SC6: `claude -> usage blocked -> qwen` keeps the mission WORKING throughout while Qwen can continue — verified by E2E.
- SC7: Agent-selection/failover callbacks that write current work are awaited and ordered — verified by a test that fails if a write is fire-and-forget (a delayed publish still lands before the next state is read).

### Operation-aware replacement and termination
- SC8: A terminal event for an old operation does not clear newer current work — verified by a test asserting `operationId`-based matching.
- SC9: Same-operation phase/agent replacement resolves deterministically under equal or near-equal timestamps, using durable ordering from the operational store — verified by a test with identical timestamps on two events.

### Truthful NEEDS YOU
- SC10: Review-loop escalation that cannot be resolved autonomously projects its reason into the mission's operator-facing blocking reason instead of being discarded when current work ends — verified by E2E exhaustion test asserting the reason text.
- SC11: Exhausted implementer/reviewer options and terminal review-loop failure survive into NEEDS YOU; a single family becoming usage-blocked while another eligible family exists does not create attention.
- SC12: WORKING and NEEDS YOU stay mutually truthful across four states: active autonomous work -> WORKING; failover in progress -> WORKING; no autonomous progress possible -> NEEDS YOU; stale/dead work -> not WORKING.

### Liveness
- SC13: Current work cannot be kept alive by PID reuse — verified by a test where a reused PID with a different process-start identity is treated as dead.
- SC14: Abnormal process termination still ages out stale current work.

### Honest operator rail
- SC15: WORKING renders every live mission or an explicit `+N more`; the displayed WORKING count never exceeds visible rows without that indicator.
- SC16: A mission considered working only from bounded legacy/recovery evidence either renders its uncertainty or the obsolete fallback is removed — it never disappears from both WORKING and NEEDS YOU.
- SC17: No attention row renders a green `run ▶` for an action `BoardCommandController` will reject as unavailable; the command shown and the typed application command dispatched on Enter are the same string.
- SC18: Review/integration board commands either route through the typed board controller using existing application use cases, or render as explicitly unavailable/non-runnable.

### Actually terminate `px board`
- SC19: `q` on an idle spawned interactive `px board` under a PTY (or equivalent real terminal harness) terminates the process within 5s; evidence cites the spawned PID and proves that PID is gone.
- SC20: Ctrl+C terminates the same real process within 5s, evidence citing the PID as in SC19.
- SC21: `q` and Ctrl+C both terminate the real process while a confirmation dialog is armed.
- SC22: SIGTERM terminates the real process cleanly.
- SC23: Shutdown after the live projection subscription has started disposes the subscription/timer; no hidden Promise, timer, stdin listener, Ink instance, DB handle, or child-process handle keeps Node alive.
- SC24: Shutdown while a board-dispatched operation is in flight (via a deterministic test seam) terminates the client, and any child operation is deliberately cancelled or deliberately detached per existing ownership semantics — never accidentally orphaned. The chosen ownership semantics are stated in the checkpoint.
- SC25: Terminal raw mode/input state is restored on shutdown.
- SC26: Ten start/quit cycles of `px board` leave zero surviving `px board` processes and zero board-owned resources.
- SC27: The actual resource preventing termination is named in the checkpoint. Any final entry-point `process.exit()` appears only after resource ownership is made explicit and tested.

### Refresh performance
- SC28: Board refresh reads only the latest relevant current-work fact per mission — verified by a performance test showing rows parsed per idle refresh does not grow with historical current-work row count.
- SC29: Historical current-work events remain queryable for audit while board read cost scales with current missions, not total history.
- SC30: Every SQLite index added is justified by naming the production query it serves.
- SC31: Slow historical metrics are not recomputed on a fast refresh whose underlying authority is unchanged — verified by a performance test counting recomputations, with `BoardProjection` remaining UI-neutral.
- SC32: Review/gate/mission reads are skipped when a cheap existing revision/change signal proves nothing changed.
- SC33: Time-driven refresh still detects AgentBlock expiry and current-work staleness without a write.
- SC34: A new current-work fact is visible on the board within 4s.
- SC35: Refresh builds never overlap; a slow rebuild produces no timer/build backlog — verified by a test proving a single in-flight build.

### Regression and verification
- SC36: E2E happy path `execute(agent A) -> usage block -> execute(agent B) -> reviewer C -> implementer B -> reviewer D -> completed` asserts projected WORKING agent/phase follows reality with no false human attention.
- SC37: E2E failure path where all eligible autonomous continuation is exhausted asserts the mission leaves WORKING and enters NEEDS YOU with the actual reason.
- SC38: One-shot/piped TUI rendering remains finite and exits without starting a live subscription.
- SC39: Existing board projection/UI-neutrality architecture tests pass unchanged.
- SC40: `./scripts/verify-local.sh static-analysis` reports a terminal PASS.
- SC41: `./scripts/verify-local.sh all` reports a terminal PASS.

## Risks and Assumptions
- Review loop `onAgentLaunched` callback is the seam for nested current-work publication; if the review loop does not expose it for all agent launches, add the seam before fixing correctness
- `operationId` is expected on `CurrentWorkEvent`; callers publishing without a stable `operationId` are fixed in this mission
- The operational-history table may lack the index the bounded read needs; adding one is low risk but must be justified against the production query (SC30)
- PTY harness depends on `node-pty` or equivalent; fallback is `child_process` with a real TTY-ish stdio and manual key injection — mock-only evidence is never acceptable
- The board subscription timer uses `setTimeout`/`unref()`; do not replace it with a blocking timer during shutdown
- `BoardProjection` stays a public contract; existing UI-neutrality tests must survive unchanged

## Checkpoints
- CP 1: Red characterization tests for all six defects (SC1). Tests fail on the parent commit.
- CP 2: Current-work publication through the autonomous review loop; one shared seam for `px review` and `px active`; awaitable ordered callbacks (SC2–SC7).
- CP 3: Operation-aware replacement and termination via `operationId` and durable store ordering (SC8–SC9).
- CP 4: Truthful NEEDS YOU projection (SC10–SC12).
- CP 5: Process liveness hardening — PID + process-start identity, abnormal-termination ageing (SC13–SC14).
- CP 6: Honest operator rail — WORKING overflow, legacy-evidence visibility, affordance/command parity (SC15–SC18).
- CP 7: Deterministic `px board` shutdown proved on real spawned processes (SC19–SC27).
- CP 8: Refresh performance — bounded read, justified indexes, revision-based skip, overlap guard, time-driven refresh preserved (SC28–SC35).
- CP 9: Regression E2E, one-shot rendering, architecture tests, both verifiers (SC36–SC41), plus the anti-slop audit of every changed file.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion covered by that checkpoint, using durable, verifiable references. Parallix accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/current-work-reconciliation.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name in the repo
  3. **Test file paths** — must be an existing test file
  4. **ADR references** — e.g., `ADR 0051` (must exist under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair it with an accepted reference above
- Shutdown criteria (SC19–SC22, SC26) must cite the spawned PID and the check proving that PID is gone
- A non-generic `Next action:` line at the bottom
- The final checkpoint cites concrete test and file evidence for every success criterion

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red test for unbounded history read | `test/task-2373-repro.test.ts`, `"board refresh reads all history rows"` | PASS |
| SC28 bounded current-work read | `src/adapters/sqlite/operational-history-repository.ts` — `findByTypeLatestPerMission()` | PASS |
| SC41 verification gate | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/domain/mission.ts` — Mission lifecycle states unchanged; no new state for execute/review/failover/runtime progress; `Mission.assignee` never means "agent currently executing"
- `src/domain/agents.ts` — agent family model and selection/fallback algorithm unchanged beyond publishing the selected agent
- `src/application/projections/board.ts` — `BoardProjection` is a public contract; add fields only with an ADR, and keep it UI-neutral
- `src/application/projections/board-subscription.ts` — UI-neutrality boundary (ADR 0051); no authority read moves into Ink components
- `src/adapters/sqlite/mission-store.ts` — mission lifecycle persistence unchanged
- `AgentBlock` stays authoritative for temporary family availability; do not fork or shadow it
- No new domain aggregates: `MissionRun`, `AgentAttempt`, `Attempt`, `Lease`, generic job entities, or per-agent-launch lifecycle persistence
- No daemon, event bus, generic scheduler, filesystem-watch, or distributed-runtime abstraction for local board refresh
- No second authoritative table duplicating `currentWork` for speed; a SQL projection/index/materialized read has exactly one documented authority
- No broad `ps`/`/proc` scanning as the normal authority for mission ownership

## Anti-Slop Guardrails
Audited per changed file in CP 9; a violation is a defect, not a style note.

- **Publish at the source, never infer downstream.** Nested review activity is published where orchestration happens. No review-runtime inference in the TUI, `BoardProjectionBuilder`, CLI callers, or any other consumer.
- **One seam, not per-caller copies.** `px review` and `px active` share one publication path. Duplicating the logic per entry point is the defect this mission exists to remove.
- **Replace guards in place; never add a parallel one.** When an existing check (liveness, reconciliation, availability, affordance-enablement) is wrong, edit it. A second classifier living beside the old one is slop.
- **No compensating UI heuristics.** Bad application state is fixed in the application. Do not add another TUI-side patch that masks it.
- **No line-number-coupled assertions.** Tests and checkpoint evidence cite file + symbol or test name, never `some-file.ts:<line>` asserted from another file.
- **No mock-only shutdown evidence.** "We invoked `exit()`", "the component unmounted", "the timer was unref'd" are not proof. The OS process must be gone.
- **No `process.exit()` as the fix.** Making a shutdown test green by exiting before cleanup is forbidden; ownership is made explicit first (SC27).
- **No unavailable action dressed as runnable.** If it cannot run, it renders as unavailable.
- **No index without a named query.** Every added index states the production query it serves.
- **No unannounced scope growth.** New abstractions, files, or dependencies beyond the Scope list need a stated reason in the checkpoint that names what existing thing failed.
- **No suppressed verifier.** An interrupted, unavailable, or BLOCKED verifier is not a PASS and is never described as one in checkpoint prose.

## Stop Rules
- Stop if a failing test proves a TASK-2370 `currentWork` invariant is impossible without redesign; escalate to architecture review before continuing. Do not reopen that architecture for any weaker reason.
- Stop if no real-process harness can inject `q`/Ctrl+C reliably; report it rather than substituting mock-based shutdown evidence.
- Stop if the index addition requires a migration that blocks existing operational-history writes; defer the index to a separate migration mission.
- Never introduce `MissionRun`, `AgentAttempt`, `Attempt`, or `Lease`, including as a "temporary" or test-only type.
- Never move authority reads into Ink components (ADR 0051).
- Do not hand off, integrate, or mark this mission done while either verifier is interrupted, unavailable, BLOCKED, or lacks a terminal PASS.
