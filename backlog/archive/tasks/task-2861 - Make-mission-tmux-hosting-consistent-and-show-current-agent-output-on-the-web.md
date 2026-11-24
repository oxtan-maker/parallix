---
id: TASK-2861
title: Make mission tmux hosting consistent and show current agent output on the web
status: backlog
assignee: []
created_date: '2026-11-17 13:28'
labels:
  - bug
  - wave
dependencies: []
references:
  - src/composition/mission-terminal.ts
  - src/adapters/agents/run-session.ts
  - src/adapters/process/tmux-host.ts
  - src/adapters/process/tmux-mission-terminal.ts
  - src/application/mission-terminal.ts
  - web/src/mission-history.tsx
  - docs/adr/0064-mission-terminal-sessions-and-run-history.md
  - docs/adr/0047-per-mission-change-size-budget.md
  - docs/adr/0057-verification-tiers-and-trust-model.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make clicking a mission card show the current mission/agent activity consistently when tmux hosting is enabled. Consolidate the duplicated hosting decisions and shared launch lifecycle so foreground commands, owned workflow executors and standalone agent launches cannot silently disagree.

This is one planning parent. The draft lifecycle authors it and converts the wave plan into subtasks with recorded dependencies. Do not activate the umbrella as an implementation mission or create child Backlog files by hand.

## Observed failure and evidence

Investigation on 2026-11-17, task-2859.01, using retained run records, the workflow-operation database, read-only tmux probes and the same mission-terminal capability used by the web:
- At 12:58:20 UTC, integrate used tmux and failed because Git found unstaged changes. That output remains in the idle mission console.
- At 12:59:15 UTC, a later integrate invocation had interactive=false and used pipes. Subsequent rebase and integration work also used pipes, including agent output that never reached the retained tmux console.
- The capability simultaneously returned overview state=capture-only with probe=idle and live kind=live with operation=null containing the earlier rebase failure. The web therefore displayed an old shell prompt beside a message about newer pipe execution.
- Foreground hosting, workflow hosting and standalone agent hosting independently implement terminal selection, probing and fallback. The underlying native launch machinery is already shared. Foreground and workflow orchestration also differ in execution-identity observation and fallback diagnostics.

The Git dirty-worktree error is independent of this defect. This wave does not change rebase recovery or modify the affected live mission.

## Required behavior

One hosting policy owns the choice between inherited mission terminal, a new hosted operation and pipe execution. One shared command-host lifecycle owns the common launch, capture, execution observation, fallback and cleanup behavior. Reuse the existing native tmux owner; remove superseded branches and redundant tests while retaining distinct assertions. Keep command capture and agent-attempt capture distinct where their attribution contracts differ.

Mission workflow hosting must not depend on whether the caller happens to have a TTY. With tmux selected and available, supported background mission executors use the same persistent mission terminal and their agent descendants inherit it. auto uses the available host for those executors; pipe remains an explicit opt-out. An explicit tmux request, including whenUnavailable=fail, must not be silently bypassed by interactive=false. Unsupported hosting or fallback must have a recorded, actionable reason. Interactive attachment remains conditional on a TTY and separate from hosting. Structured/read-only commands retain their caller-side output contracts.

Preserve headless caller stdin, output/stream semantics and exit status, explicit cancellation ownership, detach behavior, credential isolation, repository/mission isolation and retained history across restart and worktree removal. Never replay a command that already started. Preserve standalone-agent restrictions that have a real provider or input-contract reason; express them through the common policy rather than divergent copies.

The web distinguishes an active operation, an idle retained console, current pipe capture, ended work and unknown/probe failure. Old idle-console bytes must not appear to be current agent activity. Current captured output remains visible and tails correctly even when tmux is unavailable or explicitly disabled. When concurrent operations exist, correlate the displayed operation and its run identity; do not treat a shell, open capture or unrelated operation as proof of a live agent.

## Wave plan for the draft lifecycle

These are provisional Small/Medium boundaries under ADR 0047, counting inserted plus deleted engineering lines including tests. Draft must estimate honestly and split further at a cohesive boundary if any child would exceed 235 NEL; do not enlarge the bucket or fold slices together.

1. Shared terminal selection policy (estimate 180-230 NEL; no prerequisites). Trace the three production entry paths and their owning tests; consolidate selection, inheritance, required-host/fallback decisions and reasons while preserving existing behavior. Retain provider/input-specific restrictions as explicit inputs. No new parallel tmux implementation.
2. Shared hosted-command lifecycle (estimate 180-230 NEL; depends on 1). Reuse the existing native launch/supervisor and consolidate foreground/workflow orchestration, including capture host attribution, immutable execution identity, diagnostics, startup failure and cleanup. Preserve independently meaningful capture contracts. Keep behavior changes for slice 3 separate.
3. Observable background workflows (estimate 180-230 NEL; depends on 2). Reproduce the interactive=false bypass red-to-green in the owning suite, then implement the required background hosting and explicit override semantics. Verify inheritance, stdin/output/exit contracts, no replay after startup, detach versus stop, unavailable tmux and fail/fallback behavior. Update the affected terminal documentation and ADR 0064's TTY-only hosting description to the delivered behavior; preserve ports-and-adapters principles.
4. Accurate web terminal state and current output (estimate 180-230 NEL; depends on 3). Reproduce the idle-console/newer-pipe mismatch red-to-green in the existing mission-history/terminal presentation owners. Align capability/transport/browser state and run selection, including concurrent operations and probe failures. Clearly label retained idle output and follow current captured output without losing history or confusing coordinator capture with agent liveness.
5. End-to-end acceptance (operational, 0 NEL expected; depends on 3 and 4). Manually exercise the completed feature in a disposable repository and disposable PARALLIX_HOME: interactive launch, non-TTY workflow launch, visible agent activity from the card, ended operation, newer pipe activity beside an old console, unavailable tmux, detach/reconnect, stop and retained history. Use existing fixtures and owners. Any newly discovered code fix becomes a bounded child rather than unbudgeted work in this operational slice.

## Verification and scope constraints

Each implementation child performs its own manual end-to-end check with isolated state; the final slice verifies the combined behavior. Extend the existing owning suites and preserve distinct behavioral assertions. Unit policy tests use doubles; real tmux checks belong to integration-local with the workstation dependency declared in the existing category registry. New or modified integration tests must stay within 3.5 seconds and retain finite CPU budgets; unit cases must meet the 500 ms headroom requirement. Prefer focused checks; do not add, restore, weaken or retune operator-owned verification gates. Record verification evidence in checkpoints, not live documentation.

Do not alter mission lifecycle/review authority, architecture principles, terminal identity, real mission/database state, provider assignment, rebase handling or the unrelated agent authorization defect tracked by TASK-2860. This wave consolidates existing owners within their boundaries. If an architectural-principle change proves necessary, stop dependent implementation and obtain the explicit decision required by AGENTS.md. Live documentation explains delivered behavior without implementation inventories or test reports.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The draft lifecycle converts this single parent into independently deliverable Small/Medium children with explicit dependencies and complete child contracts; the umbrella is not activated for implementation.
- [ ] #2 Foreground mission commands, owned workflow executors and standalone agent launches use one terminal-selection owner; common hosted-command orchestration is reused, superseded implementations are removed, and distinct attribution/assertions are preserved.
- [ ] #3 Supported mission workflows launched without a TTY use the selected available tmux host; explicit pipe, tmux, fail and fallback settings behave consistently, and terminal attachment is independent of hosting.
- [ ] #4 Headless input/output and exit contracts, agent terminal inheritance, no-replay-after-start, cancellation/detach, credential and mission isolation, restart and history retention remain correct.
- [ ] #5 The task-2859.01 failure modes have focused retained red-to-green reproductions in the owning suites: interactive=false bypass and an idle old console beside newer pipe/agent activity.
- [ ] #6 The web clearly distinguishes idle retained console, current terminal/pipe output, ended work and failed/unknown probes, correlates concurrent operations correctly and follows current activity without presenting stale bytes as current agent work.
- [ ] #7 Every implementation child has isolated manual end-to-end evidence; final wave acceptance exercises the complete card-to-agent flow, fallback, detach/reconnect, stop and retained history without touching live missions.
- [ ] #8 Focused verification meets repository isolation and runtime budgets, operator-owned gates remain unchanged, and terminal behavior documentation is updated without implementation inventories or test evidence.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
