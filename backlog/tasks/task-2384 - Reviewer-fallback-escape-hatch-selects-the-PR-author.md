---
id: TASK-2384
title: Self-review by the PR author dead-ends instead of escalating for approval
status: ready-for-integration
assignee: [codex]
created_date: '2026-08-20 19:12'
labels:
  - bug
  - ai_sdlc
  - agents
  - review
dependencies: []
references:
  - src/adapters/review/review-artifacts.ts
  - src/adapters/agents/agents.ts
  - src/adapters/review/review-agent-fallback.ts
  - src/application/handoff-command-use-case.ts
priority: high
ordinal: 101917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When every other agent family is genuinely unavailable, the launcher's single-family escape hatch (`src/adapters/agents/agents.ts:343-347`) lets the implementer review its own work. That behavior is intended and stays: a self-review with no formal approval is worth more than a stalled mission.

What is broken is the ending. The reviewer runs, writes findings/outcome/verdict, posts a PR comment, and then the provider POST is skipped because Forgejo rejects a self-approval:

`[WARN] Reviewer "custom" is the PR author for mission/task-2377.05; skipping the provider review POST to avoid a self-approval (Forgejo rejects "approve your own pull is not allowed" with HTTP 422). Recording the "approve" verdict locally in the SQLite Review aggregate; a different agent or a human must post the formal approval.`

That message names the requirement — "a different agent or a human must post the formal approval" — but nothing carries it forward. The mission is left in the review lane with an approved-in-fact review, no provider approval, and no escalation, request, or queue entry telling anyone the approval is owed. Observed on mission task-2377.05, round 2 (operator log, 2026-08-20T18:51Z).

Two supporting problems in the same path:

1. The self-author condition is discovered only at POST time, after a full review has been spent. It is knowable at reviewer-selection time, where the operator could be told up front that this round will need a human approval.
2. The escape hatch fired here for the wrong reason: claude was blocked by a stale-session failure (TASK-2380) and codex/qwen/vibe could not start under the review sandbox (TASK-2383). Those are separate tasks — but the "all other families are blocked for real" precondition should be reported with the per-family reason, so a spurious exhaustion is visible in the log rather than indistinguishable from a real one.

Scope note: do not remove or gate the escape hatch, and do not make the PR author ineligible as reviewer. The mission is to make the self-review outcome a first-class, visible state that a human or another agent can act on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The single-family escape hatch still selects the implementer as reviewer when no other family is runnable; self-review remains a supported outcome
- [ ] #2 A self-review that cannot be posted to the provider leaves the mission in an explicit "approval owed" state rather than a silent stall: the pending formal approval is visible in `px status <slug>`
- [ ] #3 The operator is told at reviewer-selection time, before the review runs, that the selected reviewer authored the PR and the round will need an external approval
- [ ] #4 The escape-hatch log names why each other family was unavailable, so a spurious exhaustion is distinguishable from a real one
- [ ] #5 The locally recorded verdict remains recorded; this task does not change what a self-review verdict means for integration gating
- [ ] #6 Tests cover: self-review verdict recorded and surfaced as approval-owed, the pre-launch self-author notice, and the escape hatch still firing when all other families are blocked
- [ ] #7 `./scripts/verify-local.sh static-analysis` and the affected unit suites pass
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
