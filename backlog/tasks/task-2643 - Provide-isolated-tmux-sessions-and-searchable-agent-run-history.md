---
id: TASK-2643
title: Provide isolated tmux sessions and searchable agent run history
status: backlog
assignee: []
created_date: '2026-10-04 05:44'
labels: []
dependencies:
  - TASK-2642
priority: medium
ordinal: 161008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Give each agent run a separately identified, supervised terminal session and a supported way to inspect/search its own retained run history. Operators should be able to attach to an active run, detach without killing it, and inspect the same attributable history after an agent exits or a harness restarts. This is a larger roadmap capability, distinct from the narrow failed-command evidence repair in TASK-2642.

Start with a measured design checkpoint: inventory existing launchers, PTY behavior, provider-native transcripts, process supervision, confinement, fallback/resume markers, current-work recording, and evidence storage. Reproduce history loss and orphan/stale session behavior under representative providers. Compare extending existing native logs and PTYs with a tmux launcher adapter, then propose the smallest justified architecture and rollout. Record platform/dependency support, session/socket ownership, signals and child cleanup, disk limits, restart adoption, and effects on existing confinement. Present evidence, alternatives and behavioral risks and obtain the explicit architectural decision required by AGENTS.md before implementing any changed port, dependency direction, composition authority or adapter boundary. Ticket creation does not waive that decision.

After that decision, implement the approved tmux session mechanism behind the existing launch and supervision authority. A run needs stable repository, Mission, role, agent-family and attempt/session identity so concurrent missions and fallback families cannot share the wrong pane, history or resume marker. Define tmux socket/server scoping and access deliberately; separate panes alone are not a security sandbox. Keep existing process/confinement boundaries authoritative and prevent one run from reading or controlling another through the new retrieval/attach surface. Preserve exit/signal propagation, cancellation, timeouts, usage fallback, fresh versus resumed context, current-work publication and review/gate authority. Configure capability/rollout explicitly; missing tmux must produce the documented supported fallback or an actionable unavailable result, never a silently broken agent launch.

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
- [ ] #1 A measured design checkpoint compares existing PTY/native transcript support with a tmux adapter, identifies lifecycle and confinement risks and platform dependencies, and obtains the explicit architectural decision before dependent implementation.
- [ ] #2 Each supported launch receives an attributable run/session identity and deliberate tmux socket/server scope; concurrent missions, roles and fallback families cannot attach to, search or control the wrong run through the provided interface.
- [ ] #3 Operators can attach/detach and reconnect to supported live sessions; agent exit, signal, cancellation, timeout and harness restart reconcile through the existing launch/supervision authority without orphan children, stale current work or accidental session reuse.
- [ ] #4 Terminal history survives scrollback overflow, alternate-screen/redraw behavior and session exit through durable capture; provider-native transcripts/tool results are preserved where supported, and retrieval states its source, coverage, capture completeness and omissions.
- [ ] #5 Current agents and authorized replacement/fresh agents can perform bounded search and retrieval of their run history with stable evidence references; long transcripts stay outside prompt context and reuse TASK-2642 evidence ownership, retention, redaction and access contracts.
- [ ] #6 Existing provider fallback/resume behavior, fresh-context semantics, process confinement, lifecycle/gate authority and retry budgets remain intact; tmux is an optional/configured mechanism with documented dependency and platform behavior.
- [ ] #7 Focused owning-suite tests cover concurrent isolation, overflow/alternate-screen capture, launch failure, cancellation, restart and cleanup with finite CPU/wall budgets; classify real tmux boundary checks under ADR 0057 with the declared dependency rather than contacting tmux from unit tests.
- [ ] #8 A bounded configured-agent evaluation demonstrates retrieval of an earlier omitted tool/command failure from the correct run and a useful repair decision; report retrieval accuracy, outcome and context cost independently, including a headless/native-history baseline.
- [ ] #9 Live docs explain supported platforms/providers, attach/search usage, history coverage and limitations, cleanup/retention and the distinction between terminal-session separation and the existing security confinement boundary.
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
