---
id: TASK-2643
title: Provide persistent mission terminals and searchable agent run history
status: done
assignee: [codex]
created_date: '2026-10-04 05:44'
labels: []
dependencies:
  - TASK-2642
priority: medium
ordinal: 161008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Give each mission one persistent terminal keyed by its existing `task-XXXX` or `adhoc*` slug. Detect tmux automatically for declared interactive mission operations with TTY stdin/stdout; headless calls keep their pipe input/output contract and run capture. Use pipes when a terminal cannot start, without user configuration, and never replay a command that already started. Running Parallix through tmux must behave like running it from a terminal: the mission command, agents, fallback/resume, review, recovery and gates share that mission session. Roles and attempts retain separate evidence identities, not separate mission sessions.

ADR 0064 records the operator-approved command-hosting boundary and supersedes the removed design document. The CLI entry passes its executable and arguments explicitly through composition; hosting must not depend on a child-wrapper environment variable. Follow ADR 0051's ports-and-adapters dependency direction: concrete terminal mechanisms stay in process adapters, composition wires them, and application-owned ports and use cases retain lifecycle, cancellation and gate authority. ADR 0053 remains the persistence authority; terminal state is not Mission state. Existing board actions continue through their guarded use cases under ADRs 0054/0055, not through a CLI subprocess replacement.

Keep one minimal-environment console available after work stops, closing each completed operation window. Successful worktree cleanup attempts terminal retirement immediately if idle or after owned operations drain. Retirement and transport-cleanup failures warn without blocking landed administrative closure or losing a completed command result. The console preserves resolved operator state locations so re-entry and attachment use the original socket. Interactive standalone agent launches can use an operation window in this same session when no outer command terminal exists. Attach must work without an active agent or retained run record. Concurrent operations may occupy separate windows in the same mission session. Cancellation and restart reconciliation stop owned or unsupervised operations while retaining the mission terminal and other live operations. Scope private sockets by repository and mission, preserve confinement inside the terminal, and never infer active work from an idle session. This provides the stable mission terminal a future web card can display; browser terminal transport/rendering is outside this mission.

Searchable history must be durable evidence with provenance, not just a pane screenshot or whatever remains in scrollback. Capture terminal output throughout the run and prefer provider-native transcript/tool-result records where available through adapters; distinguish terminal bytes, rendered screen contents and model/tool transcript coverage. Report what is absent rather than claiming terminal capture contains unseen tool calls or model reasoning. Account for ANSI redraws, alternate screens, history overflow, interrupted writes and provider shutdown. Use the evidence identity and retrieval contract from TASK-2642 rather than introducing another Mission/review database or loading whole transcripts into prompts. Expose bounded search and retrieval with stable references and source offsets, useful to both the current agent and an explicitly authorized replacement/fresh agent; keep prompts compact. Retention, redaction and access must preserve existing repository/Mission boundaries.

This mission owns terminal-session supervision and general agent history access. It must not delay TASK-2642, require customer test runner changes, special-case Parallix's own development scripts, raise retry budgets or turn tmux into gate/lifecycle authority. Global cross-Mission semantic memory, a new sandbox system, multi-agent scheduling redesign and wholesale provider replacement are outside scope.

Research basis (2026-10-04): the tmux manual documents sessions, capture-pane and pipe-pane, but also bounded pane history and alternate-screen history limitations. Anthropic's context guidance favors compact identifiers plus on-demand retrieval; its evaluation guidance recommends inspecting attributable transcripts and checking actual outcomes. Together these support separate session supervision and durable evidence/history contracts, evaluated end to end rather than assuming tmux scrollback solves context loss.

References:
- https://man.openbsd.org/tmux.1
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ADR 0064 uses the existing ADR structure, records the explicit approved mission-terminal decision, compares alternatives and preserves ADRs 0051/0053/0054/0055; the superseded design document is removed.
- [x] #2 Interactive mission operations share one persistent repository/Mission tmux session keyed by its slug; agents, roles and fallback attempts share it. Headless calls preserve pipes and per-run capture. Per-run evidence remains attributable and isolated from other missions.
- [x] #3 Operators can attach/detach and reconnect during work and after it stops, including without run history. Exit, signal, cancellation, timeout and restart stop owned operation windows while retaining one console and other live operations. Worktree cleanup attempts retirement after owned operations drain; cleanup failure cannot block landed closeout or lose a command result. Console re-entry and attachment reuse the same socket.
- [x] #4 Terminal history survives scrollback overflow, alternate-screen/redraw behavior and session exit through durable capture; provider-native transcripts/tool results are preserved where supported, and retrieval states its source, coverage, capture completeness and omissions.
- [x] #5 Current agents and authorized replacement/fresh agents can perform bounded search and retrieval of their run history with stable evidence references; long transcripts stay outside prompt context and reuse TASK-2642 evidence ownership, retention, redaction and access contracts.
- [x] #6 Existing provider fallback/resume behavior, fresh-context semantics, process confinement, lifecycle/gate authority and retry budgets remain intact; interactive declared operations use runnable tmux automatically and otherwise fall back to pipes without user configuration or replaying started commands; headless stdin and separate stdout/stderr remain on pipes; explicit operator overrides remain available.
- [x] #7 Focused owning-suite tests cover concurrent isolation, overflow/alternate-screen capture, launch failure, cancellation, restart and cleanup with finite CPU/wall budgets; classify real tmux boundary checks under ADR 0057 with the declared dependency rather than contacting tmux from unit tests.
- [x] #8 A bounded configured-agent evaluation demonstrates retrieval of an earlier omitted tool/command failure from the correct run and a useful repair decision; report retrieval accuracy, outcome and context cost independently, including a headless/native-history baseline.
- [x] #9 Live docs explain supported platforms/providers, attach/search usage, history coverage and limitations, cleanup/retention and the distinction between terminal-session separation and the existing security confinement boundary.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Implementation Notes

Native Mission state is authoritative. CP-5 through CP-9 record the agreed
rescope and independent-review follow-ups; CP-10 binds the final audit to the
committed revision. All acceptance criteria are evidenced and complete.

Focused verification passed: 17 real-tmux cases plain and covered, 46 terminal
and landed-closeout unit cases with headroom, static analysis, and documentation
checks. The earlier 108-case focused run also covered command policy, capture
and architecture contracts.

The configured-agent evaluation was rerun on the rebuilt scoped implementation:
one paired trial, correct-run retrieval and useful repair 1/1 against baseline
0/1. [Evaluation evidence](../docs/task-2643-evidence/review-rescope-agent-evaluation.json)
records source/build fingerprints, answers, prompt sizes and measurement limits.

Final-revision integration gates and fresh review remain for Parallix. Earlier
approval and full-gate evidence do not certify this changed implementation. The
bug-label-specific Definition of Done item is not applicable: this Mission has
no bug label; focused regression cases are retained in the owning suites.
