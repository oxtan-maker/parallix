---
id: TASK-2375
title: Finish live-board operation correctness and shutdown semantics
status: backlog
assignee: [codex]
created_date: '2026-08-14 05:33'
labels: []
dependencies: []
ordinal: 95912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
references:

* backlog/completed/task-2373 - Close-live-board-correctness-gaps-improve-refresh-performance-and-guarantee-TUI-shutdown.md
* backlog/tasks/task-2373.01 - Add-macOS-and-Windows-process-start-identities.md
* src/application/projections/current-work.ts
* src/application/projections/board-readers.ts
* src/application/projections/board-subscription.ts
* src/application/review-command-use-case.ts
* src/application/execute-mission-service.ts
* src/adapters/backlog/concrete-current-work-read-adapter.ts
* src/adapters/sqlite/operational-history-repository.ts
* src/adapters/process/process-liveness.ts
* src/interfaces/tui/shell.tsx
* src/interfaces/tui/ui-command.ts
* test/task-2373-shutdown.test.ts
  priority: high

---

## Description

TASK-2373 established the correct live-board architecture and fixed most first-order defects. Keep that architecture.

This mission closes the remaining correctness gaps found in production composition:

1. the bounded current-work read path can discard the still-running operation that the operation-aware reducer is supposed to preserve;
2. `operationId` is not guaranteed to identify one top-level invocation, so late events from overlapping invocations can still clear newer work;
3. board shutdown is proven for idle/modal states but not while a board-dispatched operation is actually in flight;
4. the historical metrics cache is invalidated by volatile `blockedForMs`, causing expensive metrics work to repeat every refresh while an agent family is blocked.

Also correct the unsafe non-Linux liveness fallback already covered by TASK-2373.01: when process-start identity cannot be verified, bare PID existence must not make current work authoritative `live` forever.

Do not redesign `currentWork`, Mission lifecycle, agent failover, or the board projection boundary. This is a composition/correctness cleanup of the existing design.

## Acceptance Criteria

### Preserve current work correctly

* [ ] #1 Add a red production-path test proving the current bounded read implementation can lose a still-running operation when newer terminal events from older operations occupy the bounded result set.

  Representative ordering:

  ```
  1  op-A running
  2  op-B running       <- actual current work
  3  op-A ended
  4  op-A blocked
  ```

  The projected current work must remain `op-B`.

* [ ] #2 Remove the assumption that an arbitrary fixed number of latest mission events is sufficient for operation-aware reconciliation.

* [ ] #3 The production current-work read path returns enough information to determine the newest still-standing operation correctly regardless of how many older operations later emit terminal/blocking events.

* [ ] #4 Keep historical `mission.current-work` events available for operational history while ensuring board reads remain bounded by current operational state rather than total historical event count.

* [ ] #5 Do not fix this by increasing `findLatestByTypePerMission(..., 2)` to another magic number.

* [ ] #6 Do not introduce `MissionRun`, `AgentAttempt`, `Attempt`, or another durable execution aggregate. Use the existing mission-scoped current-work/event model.

### Make operation identity actually identify an invocation

* [ ] #7 Every top-level long-running invocation that publishes current work receives a correlation identity unique to that invocation.

* [ ] #8 All nested phases and agent-family handoffs belonging to that invocation retain the same `operationId`.

* [ ] #9 Starting another review/execute/integrate invocation for the same mission creates a different `operationId`; mission slug alone is not sufficient.

* [ ] #10 A late `ended`/`blocked` event from invocation A cannot clear or replace current work from newer invocation B.

* [ ] #11 Add a red-to-green overlap test using two invocations of the **same operation type on the same mission**, not merely different operation names.

* [ ] #12 Operation identity remains correlation metadata, not a new domain entity or lifecycle state.

### Prove shutdown while work is actually running

* [ ] #13 Extend the real PTY/spawned-client shutdown suite to cover a board-dispatched operation that remains intentionally in flight long enough to test shutdown.

* [ ] #14 The test must use the real interactive `px board` process and record its OS PID. Mocking `useApp().exit()` or a controller callback is not sufficient evidence.

* [ ] #15 After dispatching the long-running board action, prove the action has actually started before issuing the quit signal.

* [ ] #16 Pressing `q` while that action is in flight terminates the board client PID within a bounded timeout.

* [ ] #17 Ctrl+C while an action is in flight terminates the board client PID within a bounded timeout.

* [ ] #18 Define and test explicit child-operation ownership semantics:

  * if board-owned work must be cancelled, prove its process/resource is terminated;
  * if work is intentionally detached and allowed to continue, prove the board process does not remain attached to it and document that existing Parallix ownership rule.

* [ ] #19 No unresolved Promise, stdin listener, Ink instance, timer, PTY handle, DB handle, or child-process handle may accidentally keep the board client alive.

* [ ] #20 Do not satisfy shutdown by unconditional early `process.exit()` that bypasses resource cleanup. Diagnose and fix ownership/cleanup first.

* [ ] #21 Repeated start -> dispatch work -> quit cycles do not accumulate board client processes or board-owned resources.

### Fix metrics refresh invalidation

* [ ] #22 Add a red test proving that an unchanged board with an active timed `AgentBlock` currently causes historical metrics recomputation on successive refreshes because `blockedForMs` changes with wall clock time.

* [ ] #23 Historical/slow metrics cache identity must depend only on facts that can actually change those metrics.

* [ ] #24 Volatile presentation/runtime values such as `blockedForMs` must not invalidate historical cycle-time/throughput metrics every two seconds.

* [ ] #25 Agent availability/countdown values must still refresh accurately without forcing expensive historical metrics recomputation.

* [ ] #26 Add instrumentation/test evidence showing repeated idle refreshes during a long AgentBlock reuse the slow metrics result.

* [ ] #27 Preserve the existing non-overlapping board rebuild behavior.

### Correct unverifiable process liveness

* [ ] #28 On platforms/configurations where process-start identity cannot be obtained, bare `kill(pid, 0)` success must not be treated as indefinitely authoritative proof that the original Parallix process is still alive.

* [ ] #29 Represent PID-exists-but-identity-unverifiable as `unverified` or equivalent so the existing freshness/TTL policy can eventually age the work out.

* [ ] #30 Linux process-start identity continues to provide authoritative liveness where available.

* [ ] #31 Update TASK-2373.01 wording/implementation expectations so its documented fallback matches actual semantics; do not create a second competing liveness task.

### Production-composition verification

* [ ] #32 Add an end-to-end/current-production-wiring test that exercises:
  `operation A running -> operation B running -> late terminal events from A`
  through the same repository/read-adapter/reconciler path used by `px board`, and proves B remains WORKING.

* [ ] #33 Add an end-to-end test for two overlapping same-type invocations on one mission and prove their unique `operationId`s prevent cross-termination.

* [ ] #34 Add a refresh test showing:

  * AgentBlock countdown changes;
  * board projection updates;
  * slow metrics calculation is not rerun solely because the countdown changed.

* [ ] #35 Existing autonomous agent-family failover remains unchanged and does not create NEEDS YOU while another eligible family can continue.

* [ ] #36 Existing nested `active -> handoff -> review -> act-on-review` current-work publication remains correct.

* [ ] #37 Existing idle/modal `q`, Ctrl+C, SIGTERM, terminal restoration, and repeated-shutdown tests remain green.

* [ ] #38 `./scripts/verify-local.sh static-analysis` reaches a terminal PASS.

* [ ] #39 `./scripts/verify-local.sh all` reaches a terminal PASS.

## Architectural Guardrails

* Keep `currentWork` as the mission-scoped representation of work happening now.

* Keep Mission lifecycle, Review, AgentBlock, gates, and current work as separate existing authorities.

* Do not introduce `MissionRun`, `AgentAttempt`, `Attempt`, a job scheduler, daemon, event bus, or new runtime aggregate.

* Do not replace correctness with a larger arbitrary history window.

* Do not make timestamps the sole ordering mechanism where the operational store already provides durable event sequence/order.

* Do not turn `operationId` into persisted domain identity; it is correlation for one top-level invocation.

* Do not change the existing agent fallback/usage-block algorithm.

* Do not move repository/process/SQLite reads into Ink components.

* Do not make volatile countdown/presentation values part of slow historical-metric cache identity.

* Do not claim a client shutdown fix from mock/component tests; the OS PID must actually disappear.

* Do not claim an in-flight shutdown criterion from a test that only verifies command dispatch.

* An interrupted, unavailable, or timed-out verifier is not a PASS.

## Out of Scope

* Redesigning the live-board/current-work architecture.
* Changing Mission lifecycle states.
* Changing review-loop behavior unrelated to correlation/current-work correctness.
* Redesigning the board UI.
* General performance optimization outside live-board hot paths.
* Adding macOS/Windows process-start implementations beyond what is already scoped in TASK-2373.01.
* Introducing per-agent-launch history/domain concepts.
* Changing agent usage-limit detection or selection order.

## Definition of Done
<!-- DOD:BEGIN -->
* [ ] #1 Current-work correctness no longer depends on retaining an arbitrary N latest events.

* [ ] #2 Late events from any number of older operations cannot hide or clear newer live mission work.

* [ ] #3 Two overlapping same-type invocations of the same mission have distinct operation correlation and cannot terminate each other's current work.

* [ ] #4 A real board client is proven to terminate while a board-dispatched operation is actually running, with deliberate and tested child-operation ownership semantics.

* [ ] #5 Long AgentBlock countdowns no longer cause historical metrics to be recomputed every fast refresh.

* [ ] #6 PID-only unverifiable liveness ages out safely instead of remaining `live` forever.

* [ ] #7 No new execution/domain abstraction was introduced.

* [ ] #8 Final Goal Check maps every acceptance criterion to semantically relevant test/file evidence; component tests may not be cited as evidence for a production-composition or process-lifecycle property they do not exercise.

* [ ] #9 Both required verification commands have terminal PASS results before review/integration/done.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
