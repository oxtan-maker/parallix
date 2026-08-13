---
id: TASK-2370
title: update liveness
status: active
assignee: [codex]
created_date: '2026-08-13 10:24'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 89912
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px board does not reliably know which missions are currently being worked on, which agent is doing the work, or which missions actually require operator action. It also renders a one-time projection, so changes made by other running px processes are not reflected until the board is restarted.

Do not solve this by adding another parallel execution model. Parallix already has the intended seed: LiveMissionWork / MissionOperationalFacts.currentWork models ephemeral current work on a mission, while ProgressPort already emits operation progress. The board currently defeats that design by hard-coding currentWork: null and separately reconstructing liveness by scanning OS processes.

Complete the existing mission-scoped operational-state architecture so the shared board projection has an authoritative answer to:

Is this mission currently being worked on?
Which operation/phase and agent family are doing that work?
Does this mission actually require operator action?
Has the underlying state changed since the board was rendered?

Preserve Parallix's existing agent semantics. Agents run autonomously without permission prompts. Usage-limit detection writes an AgentBlock and the same operation selects the next eligible family. A family handoff such as claude -> qwen is continued mission work, not a human-attention event. Only inability to continue autonomously may turn that situation into operator attention.

Mission, not an invented run/attempt aggregate, remains the identity around which current operational work is projected. currentWork is ephemeral operational fact, not a new mission lifecycle state and not ordinary lifecycle persistence.

The broad OS-process scan may remain as recovery/reconciliation evidence where useful, but the normal board path must not infer mission ownership and current agent primarily by parsing ps, worktrees, or session-marker history.

The operator UI must clearly separate work currently progressing from work requiring the human. Running missions must be visible in the operator rail/menu, but must not inflate NEEDS YOU. Attention actions must execute the command represented by the item rather than displaying review/integrate while Enter actually dispatches active:execute.

Acceptance Criteria

#1 Characterization tests first reproduce the current defects: currentWork is absent despite a live operation, review/other phases can be misidentified by process inference, and a running board does not observe externally-caused state changes without restart.

#2 Trace the existing authority path before implementation. Document in code/tests which existing authority owns each relevant fact: Mission lifecycle, Review, AgentBlock, current operation progress, agent/session resume metadata, gate state, and process-liveness reconciliation. Do not create duplicate authorities.

#3 LiveMissionWork / MissionOperationalFacts.currentWork is completed as the shared projection's mission-scoped representation of work happening now. It identifies enough information for all UI clients to show the current operation/phase, summary, active agent family when applicable, and freshness.

#4 Application orchestration publishes current-work changes at the real operation boundaries for all board-relevant long-running phases, including at least active execution, handoff/review, review response where applicable, and integration. UI adapters must not reconstruct these semantics themselves.

#5 Agent-family failover updates the same mission's current work rather than creating a new mission/run/attempt concept. A usage block followed by successful automatic selection of another eligible family keeps the mission in WORKING and out of NEEDS YOU.

#6 AgentBlock remains the authority for family availability. A blocked family alone never means the mission needs human help. Human attention is produced only when the workflow cannot autonomously proceed, or another existing mission/review/gate condition genuinely requires operator action.

#7 Current-work freshness is safe across abnormal process termination. A killed/crashed px process cannot leave a mission displayed as permanently running. Use the simplest mechanism consistent with ADR 0053 and the local-first architecture; process identity, expiry/heartbeat, or reconciliation are implementation choices, not new domain concepts.

#8 Observation failure is not silently converted into "nobody is running." Preserve an explicit distinction between known-current-work, known-idle/stopped, and operational state that cannot currently be verified where that distinction matters.

#9 BoardProjectionBuilder consumes the authoritative current-work source instead of hard-coding currentWork: null. Broad process scanning is no longer the primary source for deciding which mission/agent is working.

#10 Attention policy is derived in application/projection code, not in Ink components. A mission with valid current work is represented as WORKING rather than NEEDS YOU. Review/integration/active missions with no autonomous work underway may become attention items according to the existing command/lifecycle policy.

#11 The operator rail/menu surfaces both current work and human attention in a comprehensible hierarchy. Running missions show mission, operation/phase and agent family. NEEDS YOU counts only missions requiring human action.

#12 Agent handoff is visible live: a test such as claude running -> usage blocked -> qwen running updates the displayed/current projected agent without adding a NEEDS YOU item.

#13 Exhaustion is distinguishable from handoff: when no eligible family can continue an operation, the mission becomes an actionable attention item with a truthful reason instead of merely disappearing from "running".

#14 Attention items carry or resolve to their typed application command. The command shown to the operator and the command dispatched by Enter are identical. No attention row may display px review or px integrate while dispatching active:execute.

#15 Source-health warnings are correctly scoped. A stale/unavailable global source must not be stamped onto every attention item unless that item's conclusion actually depends on that source.

#16 Interactive px board observes board-relevant changes made by other px processes without restart. This includes at minimum mission lifecycle/current-work changes and agent-block changes. Updates occur within a bounded delay and rebuild through the shared application projection rather than direct UI reads of SQLite/Git/processes.

#17 Time-driven changes also become visible without unrelated writes where relevant, including expiry of timed AgentBlock state and any freshness mechanism chosen for current work.

#18 Piped/non-interactive px board remains a finite one-shot rendering and does not hang because reactive behavior was added to the interactive TUI.

#19 Restart/reconnect reconstructs the same current operational picture from shared authorities; Ink component memory or an in-process event array is never the authority for whether a mission is being worked on.

#20 Shared board contracts remain UI-neutral so TUI and the local web-board work can consume the same facts. No TUI component reads Git, Markdown, SQLite, /proc, or subprocess state directly.

#21 Red-to-green tests cover at least: live active work; live review work; automatic usage-block failover; all-eligible-agents exhausted; abnormal process disappearance/stale current work; external change while TUI is open; exact attention-action dispatch; and source-warning scoping.

#22 ./scripts/verify-local.sh all passes.

#23 ./scripts/verify-local.sh static-analysis passes.

Architectural Guardrails
Do not introduce MissionRun, AgentAttempt, Attempt, or another durable per-launch entity. src/application/consumer-domain-requirements.ts explicitly records that current consumers do not require durable per-launch identity and ADR 0053 excludes it.
Do not turn agent-family retry/failover into mission lifecycle state. The in-call retry/failover loop and AgentBlock semantics remain intact.
Do not repurpose Mission.assignee to mean "the process/agent working right now". Assignment and current operational work are separate facts.
Do not add permission/waiting-for-approval states for agent execution; Parallix agents run in YOLO mode.
Do not make ps//proc command-line parsing the new authority. It may be retained only for bounded reconciliation/recovery where the authoritative operational fact needs verification.
Do not put volatile progress updates through ordinary Mission lifecycle CAS writes merely to make the UI move.
Do not create a daemon, network service, event-sourcing subsystem, or generic job scheduler for this mission unless existing architecture makes it unavoidable and the need is proven by a failing acceptance criterion.
Do not duplicate the same runtime fact in SessionMarker, telemetry, operational history, Mission, and a new table. Reuse the authority that owns the fact and project from it.
Do not solve live refresh with UI-only polling of every underlying source. Invalidation/re-query must stay behind the shared application boundary.
Prefer completing/removing obsolete heuristics over layering new heuristics on top of them.
Out of Scope
Changing agent selection order or usage-limit detection semantics.
Adding agent permission prompts or interactive agent approval.
Introducing durable per-launch analytics identity.
Changing mission lifecycle vocabulary.
Reworking review-domain semantics unrelated to detecting current work.
Implementing the full TASK-2283 browser UI; this mission supplies correct shared contracts/reactivity and fixes the existing TUI behavior.
General visual redesign of the board beyond what is required to distinguish WORKING from NEEDS YOU and expose truthful actions/status.
Definition of Done

#1 The board can answer "what is being worked on right now?" from a mission-scoped operational fact rather than reconstructing the answer from process-command heuristics.

#2 Automatic agent failover is demonstrated end-to-end without falsely requiring human attention.

#3 A genuinely stalled/unrunnable mission is demonstrated entering human attention with a useful reason.

#4 An already-open interactive TUI changes when another Parallix process changes relevant state; no restart is required.

#5 Killing a working Parallix process does not leave the mission permanently reported as running.

#6 The operator rail displays running work separately from NEEDS YOU and executes the exact action it advertises.

#7 Existing process/session heuristics that are no longer authoritative are removed, demoted to explicit reconciliation, or documented with their remaining bounded purpose.

#8 TASK-2368 is reviewed against this implementation and closed/superseded if its defect is fully covered rather than leaving duplicate fixes.

#9 Architecture/authority documentation is updated only where the implemented authority boundary actually changed; no duplicated implementation documentation is added.

#10 Final Goal Check cites concrete file and test evidence for every acceptance criterion, including the red-before/green-after bug reproductions.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
