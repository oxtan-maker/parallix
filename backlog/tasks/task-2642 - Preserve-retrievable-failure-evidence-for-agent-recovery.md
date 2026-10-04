---
id: TASK-2642
title: Preserve retrievable failure evidence for agent recovery
status: backlog
assignee: []
created_date: '2026-10-04 05:43'
labels:
  - bug
dependencies: []
priority: high
ordinal: 160008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Agents repairing a failed verification command must receive usable, attributable evidence even when parallel output, truncation, a fresh agent context, or a harness restart hides the important failure. This is a general Parallix product capability for arbitrary customer repositories and commands.

Incident: TASK-2637.03 pre-review verification ran two concurrent unit groups. One had 16 genuine assertion failures; the other later printed 2,019 passes. The terminal tail and the generic final group error omitted the failing assertions. Parallix launched a targeted repair and then a fresh-context diagnostic repair before exhausting its two-attempt budget. The local mitigation in that mission repeats failures in Parallix's own development test runner; it is useful repository maintenance but does not establish a product-wide evidence contract.

Deliver a compact repair handoff with exact command, working directory, captured revision, exit/signal, incident and attempt identity, an honest description of what evidence is available, and a supported way for that agent to retrieve/search the retained command output. Preserve stdout and stderr attribution and capture completeness; the visible last summary must never be substituted for the actual process outcome. Persist evidence before launching a repair agent. Both resumed and fresh agents must be able to retrieve the incident's original failure and latest retry evidence after a process restart, within the existing mission/repository access boundaries. A fresh context should receive evidence references, not inherit the previous model's assumptions.

Prefer the smallest extension to existing execution, recovery, and evidence mechanisms. Inspect existing logging/retention first; do not invent a parallel Mission state or review authority. Keep raw evidence separate from concise prompt presentation. Optional reporter-specific summaries belong in appropriate adapters and must fall back to opaque command evidence; product correctness cannot depend on recognizing Node test glyphs, a test framework, this repository's runner, a task ID, branch, or repository name. Bound storage and prompt use, expose unavailable/truncated evidence honestly, and respect configured credential redaction and access controls. Retained raw evidence means unabridged captured output within those policies, not unrestricted secrets.

Preserve retry counts, fresh-context escalation, verification authority, lifecycle decisions, and existing success criteria. Do not add retries to compensate for missing evidence or infer a root cause from a summary. Evidence improves diagnosis; only the actual configured verifier proves a repair. Keep the scope to failed-command recovery evidence and its retrieval. General agent transcript search, tmux/PTY session management, sandbox isolation changes, a new observability platform, and self-development script changes as the product solution are out of scope. Future tmux sessions may provide another evidence source, but this capability must work headlessly without tmux. If typed ports, dependency direction, composition authority, or adapter boundaries require a change, present measured evidence, alternatives, and risks and obtain the explicit architectural decision required by AGENTS.md before dependent implementation.

Research basis (2026-10-04): Anthropic recommends compact context plus stable identifiers for on-demand retrieval, durable handoffs across fresh contexts, and inspecting complete trial transcripts to distinguish agent mistakes from harness failures. This supports evidence capture plus retrieval as the narrow next step. The tmux manual documents capture-pane and pipe-pane, finite history-limit, and alternate-screen history limitations: terminal session access can complement retained evidence, but it is not itself a durable command-evidence contract.

References:
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- https://man.openbsd.org/tmux.1
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An owning-suite red-to-green regression reproduces an arbitrary command whose actionable failure falls between a large prefix and a later passing-looking parallel summary; the launched repair prompt exposes attributable evidence and a working retrieval route without customer runner changes.
- [ ] #2 Each failed invocation retains command, cwd, revision, exit/signal, incident/attempt identity, stdout/stderr attribution and capture-completeness metadata before repair launch; original and retry evidence cannot overwrite or be confused with another concurrent mission or repository.
- [ ] #3 Both targeted resumed repair and fresh diagnostic repair receive bounded context and can retrieve/search the relevant retained output, including the omitted middle, using a supported interface available within their actual launch environment; restart does not silently invalidate references.
- [ ] #4 Arbitrary toolchains and opaque failures work without framework parsing, Node glyphs, tmux, or Parallix repository/task special-casing; optional structured summaries cannot override the actual process outcome or invent a root cause.
- [ ] #5 Missing, interrupted, truncated, expired, oversized or access-denied evidence is reported explicitly with an actionable fallback; retention/resource bounds and credential redaction preserve existing access boundaries and cannot silently produce a complete-evidence claim.
- [ ] #6 Existing retry budgets, fresh-context escalation, gate verification, Mission persistence and lifecycle authority remain unchanged; exhaustion reports the failed check, attempts and retrieval route rather than an ungrounded diagnosis or extra autonomous attempts.
- [ ] #7 Deterministic contract and adapter checks prove evidence delivery and retrieval in a small unrelated fixture repository; a bounded configured-agent evaluation checks whether the agent actually retrieves the hidden failure and identifies the repair target, reporting retrieval success, repair outcome and context cost separately. Real model traffic belongs in agent-e2e, not unit tests.
- [ ] #8 Live documentation explains the general recovery evidence contract and how agents/operators retrieve it; tmux/history work remains independently scoped, and architecture changes obey the explicit decision requirement before implementation.
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
