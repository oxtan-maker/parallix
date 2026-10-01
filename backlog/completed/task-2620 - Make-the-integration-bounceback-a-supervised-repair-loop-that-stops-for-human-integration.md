---
id: TASK-2620
title: >-
  Make the integration bounceback a supervised repair loop that stops for human
  integration
status: done
assignee: [custom]
created_date: '2026-09-30 08:03'
updated_date: '2026-09-30 08:09'
labels:
  - bug
  - lifecycle
  - integration
  - review
dependencies:
  - TASK-2555
references:
  - src/application/integrate/gates.ts
  - src/adapters/cli/commands/integrate-gate-rebound.ts
  - src/adapters/cli/commands/integrate-review-resume.ts
  - src/application/integrate-workflow.ts
  - src/application/integration-repair-review.ts
  - src/composition/create-cli.ts
  - src/domain/mission-workflow.ts
  - src/domain/review.ts
  - src/application/review-repair-lifecycle.ts
  - src/application/handoff-command-use-case.ts
  - src/adapters/review/review-loop.ts
  - src/adapters/review/review-workflow-adapter.ts
  - src/application/review-command-use-case.ts
  - src/application/integrate-command-use-case.ts
  - src/application/projections/current-work.ts
  - src/application/rebound-kernel.ts
  - test/e2e-real-agent-smoke.test.ts
  - workflow.config.json
priority: high
ordinal: 147008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Intended lifecycle (operator-confirmed)

A human reviews all code before it lands. The supported loop is:

1. active -> review (agent review rounds, possibly bounces) -> integration lane (approved).
2. The human reads the PR and runs `px integrate`.
3. If an integration gate is red: the mission returns to active and its approval is withdrawn (correct, keep this). Parallix automatically repairs with a context-rich prompt, re-reviews with agent reviewers, and on approval **stops in the integration lane**.
4. The human reads the fresh PR — including what went wrong last time — and runs `px integrate` again.

Parallix never merges on an approval a human has not looked at after it was granted, and never leaves a recoverable mission silently parked. Keep the existing lane model (act-on-review stays in active); do not add a lifecycle state machine.

## What actually happens (evidence, 2026-09-20 .. 09-30, read-only from parallix.db)

- ~55 missions bounced at integration; 23 spent the 2/2 lifetime rebound budget. `agent-smoke` is the most frequent failing gate. The bounce is the main path, not an edge case.
- task-2591: 11 review rounds, 9 approvals, 7 revoked "Integration gates failed", only 2 rebound events. After the budget was spent, six times: `review --continue` approved -> the same process chained `px integrate` (create-cli.ts, `--continue` + `hasIntegrationRepairHistory` -> `runIntegrated`) -> gate red -> approval revoked, mission back to active, **no repair agent launched**. From the operator's side `review --continue` "never reaches integration".
- task-2555, 2606, 2613, 2600 sat in active with round N approved+revoked and round N+1 pending; board says orphaned-active. task-2555's integrate ended 88 ms after the rebound was recorded: human-only classification, no agent, approval and budget still spent.
- Integration after a successful auto re-review restarts and merges in the same invocation (`IntegrationRestartRequired` loop, TASK-2550 `resumeReviewAfterRepairedRevision`). This violates human review before integration.

## Defects in scope

1. **Lead approval forgery.** `px lead` calls `recordApproval()` for any review-lane mission; for an awaiting-review round it records an approve nobody gave and moves review -> integration.
2. **Automatic merges.** `px lead` / `review --continue` chain into `runIntegrated`; integrate auto-restarts and merges after an agent re-review. Remove all chaining: approval ends in the integration lane.
3. **Repair does not repair.** Human-only classification launches nothing yet has already revoked and spent budget; after budget exhaustion red gates revoke with no repair; the implementer prompt lacks the story ("this was approved, integration gate X failed with these logs at revision A"). The re-review prompt lacks the repair context (failed gate, logs, approved revision A, repair range A..B, prior approval dismissed) so the reviewer can decide scope itself.
4. **Budget semantics.** Each human-initiated `px integrate` gets a fresh bounded repair budget: `agent-smoke` retried once before counting as a failure (shared local vLLM is flaky under concurrency; the gate itself stays mandatory), then repair attempts, then return to the human with an actionable message. No lifetime counter that makes later human resumes repair-free.
5. **Forgejo impersonation.** Retraction posts `request-changes` as the reviewer's own login with a fabricated "F1 blocking" finding before any repair. Add a `parallix` Forgejo user (plus setup scripts) that dismisses stale approvals via the dismissal API.
6. **Board fans lie.** In-process nested `px review --continue` inside integrate supersedes the integrate publication (TASK-2416 guard is cross-process only) and its `ended` clears live work; the rebound implementer is never published (agent null for 16 minutes on task-2606); integrate failure publishes `ended`. Fans must spin while any Parallix work runs; a stop reason appears only when automation has genuinely run out.
7. **Silent review failures.** The injected non-terminating `exitFn` makes `exit(1); return` look like success, so `ReviewCommandUseCase` publishes `ended`. Keep the non-terminating exit (top-level processes must not die) but return failures as results the caller and board can see, so outer automation continues recovery.
8. **Two re-review paths.** Production always supplies `reReviewFn` (`px review --continue`); `resumeReviewFn`/`startAutoReviewRound` (TASK-2550) is dead in production while most TASK-2550 tests exercise it. The `fixed` route is effectively unreachable and TASK-2528 tests encode contradictory policies. Keep one path; delete dead code; tests exercise real code.
9. **Stringly-typed repair state.** Detection matches revocation reason prefix "Integration gates failed"; `rebound-to-active` hardcodes that reason for review-repair and rebase-repair callers too; `recoverLegacyIntegrationRepairReview` calls `store.save` directly on every review start. Use typed facts through the lifecycle service.
10. **Revision identity.** Revision is a `handoff-<ms>` timestamp, a commit SHA or a tree hash depending on path. Always use the git commit hash. Parallix bookkeeping commits (Backlog mirror transitions, pre-commit-hook chore) must be recognisable (author/trailer) and whitelisted so an approval of A still covers A plus only bookkeeping; the Backlog mirror stays because Backlog.md users read it. Build this on the approval-coverage rule TASK-2555 lands (`src/domain/approval-coverage.ts`) rather than a second coverage mechanism. Agent-forgot-to-commit is out of scope.
11. **Forged reviewer eligibility.** `transitionReviewRepair` builds `ConfiguredReviewerEligibility` from the round's reviewer, bypassing the configured review step.
12. **Integration failure context for the human.** When the repaired mission returns to the integration lane, the PR and `px status` show what failed last time, the repair range and the re-review outcome.
13. **Completed:** merged in Forgejo PR #540 on 2026-09-30. The Mission is done; this task must not be restarted.

## Related tickets

Lands after and builds on TASK-2555 (stale-approval stand-down and approval coverage; it overlaps mission-workflow, review, create-cli and rebase-workflow). Replaces TASK-2597 (terminal routes and visibility; removed). Implements the relevant parts of TASK-2575 (repair-capable prompts, external blocker handling). Unblocks TASK-2587 (approval authority). Re-evaluate TASK-2514 after this lands; it may be obsolete once `review --continue` works from the post-bounce state. Adjacent: TASK-2619 (review start for file-free missions). Defer TASK-2588 until this lands.

## Do not

- Do not change the lane model or add a state machine.
- Do not auto-merge in any path, including `px lead`.
- Do not weaken or remove `agent-smoke`; only retry it once.
- Do not add a third review or recovery path; remove the dead one.
- Do not mock internal seams in the new tests; mock only external boundaries (agent launcher, Forgejo HTTP, gate runner).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `px lead` never records a reviewer decision and never runs integrate; a review-lane mission with an undecided round is forwarded to review --continue only, and a regression test proves no approval is written.
- [ ] #2 No path merges after a gate repair: `px integrate`, `px review --continue` and `px lead` stop with the mission in the integration lane after re-approval; the IntegrationRestartRequired auto-merge and the --continue -> runIntegrated chain are removed.
- [ ] #3 A red integration gate withdraws approval and returns the mission to active, then launches a repair agent whose prompt contains the mission, failed gate key, command, captured logs, approved revision and the fact that integration (not review) failed.
- [ ] #4 A human-only or environment failure never spends repair budget before classification; agent-smoke is retried once before it counts as a failure, and an environment failure that survives the retry returns to the human with the exact reason.
- [ ] #5 Each human-initiated `px integrate` gets a fresh bounded repair budget; after it is spent the mission returns to the human with an actionable message, and a red gate is never revoked-and-bounced without either a repair attempt or that message.
- [ ] #6 The re-review prompt after a repair gives the reviewer the failed gate, logs, approved revision A, repair range A..B and the dismissed prior approval, and leaves review scope to the reviewer.
- [ ] #7 Stale Forgejo approvals are dismissed by a dedicated `parallix` Forgejo user (created by setup scripts); no review is posted as another login and no finding is fabricated.
- [ ] #8 Board fans spin for the whole integrate run including nested review and repair agents with the actual agent family; a stop reason is shown only when automation cannot continue; review failures surface as failures, not `ended`, without terminating the top-level process.
- [ ] #9 Exactly one re-review path remains in production; TASK-2550's unused path and its tests are removed and tests exercise the live path.
- [ ] #10 Integration-repair detection uses typed lifecycle facts, not revocation-reason string matching; rebound-to-active records the actual cause per caller; no review code calls store.save outside the lifecycle service.
- [ ] #11 Review revisions are git commit hashes on every path; Parallix bookkeeping commits are identified and whitelisted so an approval of A still covers A plus bookkeeping only.
- [ ] #12 Reviewer eligibility is always the configured review step; transitionReviewRepair no longer constructs it from the round reviewer.
- [ ] #13 When a repaired mission reaches the integration lane, the PR and `px status` show the previous integration failure, the repair range and the re-review outcome.
- [ ] #14 A fast domain table test (lane x review status x repair history -> allowed next action) and one composed test through real create-cli wiring with only launcher, Forgejo HTTP and gate runner mocked reproduce the task-2591 sequence red-to-green; both meet the unit time budget.
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
