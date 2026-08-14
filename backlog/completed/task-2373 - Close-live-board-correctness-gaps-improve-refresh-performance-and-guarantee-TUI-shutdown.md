---
id: TASK-2373
title: >-
  Close live-board correctness gaps, improve refresh performance, and guarantee
  TUI shutdown
status: done
assignee: [custom]
created_date: '2026-08-13 17:46'
labels: [user_value]
dependencies: []
ordinal: 92912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2370 established the correct direction for live mission state: mission-scoped `currentWork` is authoritative for what Parallix is doing now, while Mission lifecycle, Review, AgentBlock, gates, and other existing authorities keep their existing responsibilities.

Do **not** redesign that architecture.

Close the remaining correctness gaps where actual autonomous execution is not faithfully reflected in `currentWork`, make current-work replacement/termination deterministic under failover and asynchronous publication, propagate genuine inability to continue into truthful operator attention, remove misleading board affordances, fix obvious live-board performance problems, and make quitting the interactive board actually terminate the client process.

The important workflow is the real composed path, not isolated entry points:

`px active -> execute -> handoff -> autonomous review -> reviewer -> implementer act-on-review -> further review rounds -> integration`

At every point, the board must identify the operation and agent actually doing work. Automatic agent-family failover remains autonomous: a usage-limited agent being replaced by another eligible agent must update WORKING, not create NEEDS YOU.

The board client must also have deterministic lifecycle semantics. `q`, Ctrl+C, and normal termination must really stop the interactive `px board` process and release its TTY/resources. Unit tests proving an exit callback ran are insufficient: verify this with a real spawned client/PTY process.

## Acceptance Criteria

* [ ] #1 Add red characterization tests for each remaining defect before fixing it. At minimum reproduce:

  * nested autonomous review launched from the `px active`/handoff path reporting the wrong phase or agent;
  * asynchronous agent-change publication racing later current-work state;
  * a terminal event from older work clearing newer current work;
  * genuine review escalation losing its useful blocking reason;
  * `q`/Ctrl+C not reliably terminating a real interactive board under at least one currently failing condition;
  * current-work history being reread unboundedly during board refresh.

* [ ] #2 Preserve the TASK-2370 architecture. `currentWork` remains the mission-scoped representation of work happening now. Do not introduce `MissionRun`, `AgentAttempt`, `Attempt`, or another durable per-launch model.

### Correct current work through the complete autonomous workflow

* [ ] #3 The normal `px active` path publishes the **actual nested work** performed after implementation. Once handoff enters autonomous review, `currentWork` must follow reviewer and implementer launches inside the review loop instead of remaining a generic handoff owned by the original implementer.

* [ ] #4 Reviewer launches publish the actual reviewer family and a review phase.

* [ ] #5 Implementer launches caused by review findings publish the actual implementer family and a review-response/act-on-review phase.

* [ ] #6 Multiple review rounds continue updating the same mission's `currentWork` correctly.

* [ ] #7 The direct `px review` path and review invoked through `px active` use the same application-level current-work publication seam. Do not duplicate review-runtime inference in callers or UI code.

* [ ] #8 Automatic usage-limit failover updates the active agent on the same mission. Example:
  `claude -> usage blocked -> qwen`
  must remain WORKING throughout when Qwen can continue.

* [ ] #9 Agent-selection/failover callbacks that affect current work are awaitable and ordered. Do not fire-and-forget authoritative current-work writes.

### Make replacement and termination operation-aware

* [ ] #10 Current-work reconciliation must not rely solely on wall-clock "newest event for mission wins" when operations overlap or writes complete out of order.

* [ ] #11 `operationId` or an equivalent already-existing operation identity is used to ensure a terminal event clears only the work it belongs to. An old operation ending after newer work starts must not clear the newer work.

* [ ] #12 Same-operation phase/agent replacement is deterministic under equal or near-equal timestamps. Use durable ordering already available from the operational store where appropriate rather than depending on timestamp coincidence.

* [ ] #13 Do not solve ordering by introducing a new run/attempt aggregate.

### Truthful NEEDS YOU behavior

* [ ] #14 Review-loop escalation that cannot be resolved autonomously is projected into the mission's operator-facing blocking reason instead of being discarded when current work ends.

* [ ] #15 Useful existing reasons such as exhausted implementer/reviewer options, terminal review-loop failure, or other autonomous exhaustion survive into NEEDS YOU.

* [ ] #16 An individual family becoming usage-blocked does not itself create mission attention while another eligible family can take over.

* [ ] #17 WORKING and NEEDS YOU remain mutually truthful:

  * active autonomous work -> WORKING;
  * autonomous failover in progress -> WORKING;
  * nobody can progress autonomously and operator action is required -> NEEDS YOU;
  * stale/dead work -> not falsely WORKING.

### Harden liveness without inventing domain concepts

* [ ] #18 Current-work liveness cannot be kept alive indefinitely by PID reuse. Strengthen process identity beyond a bare PID using the simplest local mechanism available, for example PID plus process-start identity.

* [ ] #19 Abnormal process termination still removes/ages out stale current work correctly.

* [ ] #20 Do not introduce `Lease` as a domain concept. Heartbeats/expiry/process identity are infrastructure mechanisms only if required.

### Make the operator rail honest

* [ ] #21 WORKING shows all relevant live mission work or clearly indicates hidden overflow with `+N more`; the displayed WORKING count must not claim work that is invisible with no indication.

* [ ] #22 Missions considered working only because of bounded legacy/recovery evidence cannot silently disappear from both WORKING and NEEDS YOU. Render the uncertainty truthfully or remove the obsolete fallback if authoritative current work now makes it unnecessary.

* [ ] #23 Attention rows never display a green `run ▶` affordance for an action the board controller will reject as unavailable.

* [ ] #24 The command/action displayed for an attention item and the typed application command executed on Enter are the same.

* [ ] #25 Where review/integration board commands already have appropriate application use cases and can be integrated without bypassing authority boundaries, wire them through the typed board controller. Otherwise render them clearly as unavailable/non-runnable rather than pretending they can run.

### Actually terminate `px board`

* [ ] #26 Add an end-to-end interactive client test using a spawned built/dev `px board` under a PTY or equivalent real terminal harness. Do not mock Ink's `exit()` as the proof of shutdown.

* [ ] #27 From an idle interactive board, sending `q` causes the `px board` process to terminate within a bounded test timeout.

* [ ] #28 From an idle interactive board, Ctrl+C causes the process to terminate within a bounded test timeout.

* [ ] #29 `q` and Ctrl+C still terminate when a confirmation dialog is armed. Modal/input state must not swallow quit semantics.

* [ ] #30 SIGTERM to the board client terminates it cleanly; do not intercept normal process termination in a way that leaves the client alive.

* [ ] #31 Exercise shutdown after the live projection subscription has started and prove the subscription/timer is disposed and cannot keep Node alive.

* [ ] #32 Exercise shutdown while a board-dispatched operation is in flight using a deterministic test seam. Define and implement explicit ownership semantics:

  * the board client itself must terminate;
  * no hidden Promise, timer, stdin listener, Ink instance, DB handle, or child-process handle may accidentally keep it alive;
  * any child operation must be deliberately cancelled/terminated or deliberately detached according to existing Parallix ownership semantics, never accidentally orphaned.

* [ ] #33 Terminal raw mode/input state is restored on shutdown.

* [ ] #34 Repeatedly starting and quitting `px board` leaves no accumulating `px board` processes or board-owned resources behind.

* [ ] #35 Diagnose the actual resource preventing termination. Do not "fix" the tests solely by calling unconditional `process.exit()` before cleanup. A final entry-point exit may only be used if normal resource ownership is first made explicit and tested.

### Fix obvious refresh performance defects

* [ ] #36 The live board no longer rereads and parses the complete lifetime history of `mission.current-work` events every two seconds. The read adapter/repository obtains only the latest relevant current-work fact per mission, using an indexed/bounded query or an equivalent non-duplicating projection.

* [ ] #37 Historical current-work events may remain available for audit/history, but board read cost must scale with current missions/current work rather than total historical current-work event count.

* [ ] #38 Add/verify the SQLite indexes required by the production current-work read path. Do not add indexes without demonstrating which query they serve.

* [ ] #39 Slow historical board metrics are not recomputed every fast liveness refresh when their underlying authority has not changed. Cache, split refresh cadence, or otherwise avoid unnecessary recomputation while keeping the shared `BoardProjection` contract UI-neutral.

* [ ] #40 Review/gate/mission reads are not repeated solely to discover that nothing changed if a cheap existing revision/change signal can safely avoid the work. Prefer a simple bounded invalidation/revision mechanism over a daemon, event bus, or filesystem-watch architecture.

* [ ] #41 Preserve time-driven refresh for facts that can change without writes, including AgentBlock expiry and current-work freshness.

* [ ] #42 No refresh builds may overlap. A slow projection rebuild must not cause an accumulating timer/build backlog.

* [ ] #43 Add focused performance tests/instrumentation proving:

  * increasing historical current-work rows does not proportionally increase rows parsed per idle refresh;
  * unchanged fast refreshes do not repeatedly rebuild slow historical metrics;
  * the board still notices a new current-work fact within the intended interactive refresh bound.

* [ ] #44 Do not optimize by moving authority reads into Ink components. All refresh/read behavior remains behind the shared application boundary.

### Regression and verification

* [ ] #45 End-to-end test the representative happy path:
  `execute(agent A) -> usage block -> execute(agent B) -> reviewer C -> implementer B -> reviewer D -> completed`
  and assert the projected WORKING agent/phase follows reality without false human attention.

* [ ] #46 End-to-end test the representative failure path where all eligible autonomous continuation is exhausted and assert the mission leaves WORKING and enters NEEDS YOU with the actual reason.

* [ ] #47 Existing TUI one-shot/piped rendering remains finite and exits without starting a live subscription.

* [ ] #48 Existing board projection/UI-neutrality architecture tests continue to pass.

* [ ] #49 `./scripts/verify-local.sh static-analysis` passes with a terminal PASS result.

* [ ] #50 `./scripts/verify-local.sh all` passes with a terminal PASS result.

## Architectural Guardrails

* Do not reopen the basic TASK-2370 architecture unless a failing test proves an invariant impossible to satisfy.

* Do not introduce `MissionRun`, `AgentAttempt`, `Attempt`, generic job entities, or per-agent-launch lifecycle persistence.

* Do not create new Mission lifecycle states for execute/review/failover/runtime progress.

* Do not make `Mission.assignee` mean "agent currently executing".

* Keep `AgentBlock` authoritative for temporary family availability.

* Do not turn recoverable usage-limit failover into operator attention.

* Do not use broad `ps`/`/proc` scanning as the normal authority for mission ownership.

* Do not infer nested review activity in the TUI or BoardProjectionBuilder. Publish it where the actual orchestration happens.

* Do not add a daemon, event bus, generic scheduler, or distributed-runtime abstraction for local board refresh.

* Do not duplicate `currentWork` into a second authoritative table merely for speed. A SQL projection/index/materialized read optimization must have one clearly documented authority.

* Do not keep appending compensating UI heuristics for bad application state.

* Do not hide unavailable commands behind a button that looks runnable.

* Do not accept mock-only shutdown evidence.

* Do not treat "we invoked exit", "the component unmounted", or "the timer was unref'd" as proof that the client died. The OS process must actually be gone in the end-to-end test.

* Do not suppress a failing or interrupted verifier in checkpoint prose. An interrupted verifier is not a PASS.

## Out of Scope

* Redesigning Mission lifecycle.
* Changing the agent selection/fallback algorithm beyond what is required to publish the selected agent correctly.
* Adding permission prompts; agents remain autonomous/YOLO.
* Persisting per-launch attempt analytics.
* General redesign of the board visual language.
* Replacing SQLite operational persistence.
* Building a daemon or server solely for live refresh.
* Broad performance refactoring outside paths exercised by interactive board refresh.
* Solving unrelated statistics correctness defects.

## Definition of Done
<!-- DOD:BEGIN -->
* [ ] #1 An already-open board follows the actual agent and phase through execute, autonomous review, review response, and agent-family failover.

* [ ] #2 An old operation cannot clear or overwrite newer current work due to asynchronous publication ordering.

* [ ] #3 Genuine autonomous exhaustion becomes NEEDS YOU with a useful reason; recoverable family failover does not.

* [ ] #4 WORKING and attention affordances are truthful and every displayed runnable action is actually runnable.

* [ ] #5 A real interactive `px board` process is proven to terminate on `q`, Ctrl+C, and SIGTERM, including modal/subscribed states; shutdown evidence contains the spawned PID and verifies that PID is gone.

* [ ] #6 No leaked board subscription, timer, TTY mode, in-flight client resource, or accidental child-process ownership keeps the client alive.

* [ ] #7 Board refresh no longer scans unbounded current-work history or recomputes slow historical metrics every two seconds when nothing relevant changed.

* [ ] #8 Performance fixes retain timely detection of external/current-work and time-driven changes.

* [ ] #9 No new run/attempt/domain-runtime abstraction was introduced.

* [ ] #10 Final Goal Check cites concrete test and file evidence for each acceptance criterion.

* [ ] #11 The mission may not be handed off, integrated, or marked done while either required verifier is interrupted, unavailable, BLOCKED, or lacks a terminal PASS result.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
