---
id: TASK-2830
title: Handle Git lock contention across repository workflows
status: done
assignee: [codex]
created_date: '2026-11-02 12:44'
updated_date: '2026-11-02 12:46'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 301016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal: Prevent and safely recover Git lock contention across the Git operations Parallix actually executes, with coherent operation-state diagnostics and no lost or duplicated work. Create and implement this mission from main; do not change mission/task-2816.

Evidence: task-2816 retained run workflow-821be616-0ab7-45b3-b414-08e41968167b (2026-11-02T12:24:15Z) failed at rebase pick 23/26 because the per-worktree index.lock already existed. Git requeued the pick and left the worktree detached. The workflow classified a non-conflict failure and suggested only abort; subsequent review could not resolve execution context. A later manual git rebase --continue completed the remaining four picks without changes or conflict resolution. The lock holder is unknown; do not claim a proven writer race or stale lock.

Prompt comparison: prior resolver execute-codex-a1-mvz6sx49 received the full rebase completion contract, resolved package.json, continued, ran the configured docs verification and explicitly checked both rebase state directories and the index. This incident occurred before a resolver launch. Prioritize workflow/adapter controls over stronger agent wording.

Scope: Trace all production Git execution paths, including synchronous/asynchronous shared adapters, direct subprocess calls, hooks, Backlog bookkeeping, board/status readers, agent worktrees, draft/review/rebase/integration, Forgejo sync and GitHub publication. Identify the lock families reachable from those commands and their actual worktree-local versus shared-repository scope: index, HEAD and refs/packed-refs, config/worktree config, shallow/fetch metadata, and worktree administrative locks where applicable. Distinguish intentional persistent git worktree lock markers from transient mutual exclusion. Reuse existing owners and typed ports; centralize common mechanisms without moving workflow decisions into adapters. Include child Git processes and cooperating processes where the risk is real; preserve hook reentrancy and independent-worktree concurrency.

Out of scope: blanket deletion of .lock files, age-only stale-lock decisions, bypassing hooks or Git locking, blanket retries of arbitrary Git failures, changed operator gates/budgets, architecture changes, and task-2816 implementation changes. Do not assert every Git command is safe to replay. Unknown/external owners remain protected. Remote-side locks must be diagnosed separately from local files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Audit actual production callers and reachable lock families, identifying their current owners, resource scope and safe operation-specific retry/continuation semantics; cover direct subprocess and hook paths rather than only the shared wrapper.
- [ ] #2 Read-only observations avoid optional Git writes/locks where their contract permits. Coordinate conflicting Parallix-owned mutations at the correct worktree or shared-repository scope, without serializing independent worktrees unnecessarily or deadlocking hook/child execution.
- [ ] #3 Live, external and uncertain lock owners are not disturbed. Persistent contention, permission/storage failures, ref compare-and-swap races, intentional worktree locks and unrelated errors receive distinct actionable diagnostics. Never delete a lock on age or filename alone; any proposed stale-lock cleanup requires demonstrable ownership and owner absence, otherwise stop with evidence.
- [ ] #4 Paused rebase/merge/cherry-pick or other sequencer state remains visible through command failure, status and retry admission. Route supported recovery through the existing workflow owner; do not replay the original operation over an in-progress sequencer or fail merely with detached HEAD. Verify expected branch, no remaining sequencer/conflict state, and applicable operation postconditions before success/publication.
- [ ] #5 Extend owning suites with focused red-on-parent/green regressions for the observed lock incident and representative reachable lock families: transient release, persistent/live/uncertain locks, shared versus local worktree scope, cancellation, non-lock errors and partial-operation recovery. Preserve isolation, existing gate configuration, finite CPU limits, unit 500 ms headroom and changed integration suite runtime at most 3.5 seconds.
- [ ] #6 Manually exercise public workflows in disposable repositories/state with competing Git operations and controlled locks; prove safe recovery after release, clear bounded refusal while held, no loss/duplication and correct final branch/sequencer state. Update live operator guidance only for changed behavior and retain precise evidence.
- [ ] #7 Use verification/test resource leases and custom-agent admission as the product behavior reference: transient Git contention enters a visible waiting state, automatically waits/retries and proceeds on release without consuming workflow/agent repair attempts or requiring manual reruns. Reuse matching existing mechanisms/contracts and justify any Git-specific policy differences. Do not fail after a token retry count; align waiting and cancellation semantics, with explicit justified failure bounds where needed. Recognize actual lock failures without relying solely on locale-sensitive text, preserve authoritative partial-operation state, and never duplicate commits, hook effects, ref updates or publication.
- [ ] #8 Validate the operator target of at least 99% automatic completion under representative transient contention with a documented repeatable workload and measured outcome, including locks released after multiple polling intervals. Separate transient-contention success from persistent/uncertain-lock and cancellation cases; prove bounded/cancellable behavior without changing operator CPU budgets or making integration suites exceed 3.5 seconds.
- [ ] #9 Establish one production owner for admission waiting/retry orchestration shared by verification/test leases, custom-agent capacity leases and Git lock contention. Refactor the existing paths as part of this mission and migrate all production callers; do not add a third parallel wait loop or leave superseded implementations. The shared owner governs polling/backoff, waiting notifications, cancellation, wait limits and retry accounting, with explicit resource policies where needed. Keep resource acquisition, liveness facts and operation-specific Git continuation in their appropriate adapters/application owners behind typed ports, preserving architecture, distinct behavioral assertions, hook reentrancy and independent-resource concurrency. Verify each public path actually reaches the common owner, rather than only testing an unused abstraction.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Operator clarification (2026-11-02): Consistency with verification/test leases and custom-agent capacity admission is a product requirement. Expected behavior is wait, retry automatically, and proceed when released; ordinary contention is not an immediate workflow failure or an agent repair attempt. Target at least 99% automatic completion for representative transient contention, validated with recorded results rather than asserted without measurement.

Inspect and reuse the existing owners/contracts first: src/adapters/process/gate-admission.ts (SharedGateAdmission.admit polls every 25 ms and supports cancellation/signals), src/adapters/agents/custom-capacity.ts (waitForCustomCapacity polls every 1000 ms, reports waiting, preserves agent selection and does not consume a retry), src/adapters/sqlite/custom-agent-lease-repository.ts and src/composition/gate-admission.ts. These admission loops currently wait until capacity is available, rather than failing after a small retry count. Align observable waiting, cancellation, release/cleanup, ownership and retry-accounting semantics; do not mechanically copy their polling interval or introduce an unexplained short Git timeout.

Distinguish waiting for a known live owner from inability to prove a lock abandoned. Both protect the lock and normally wait/retry; inability to delete a lock is not itself grounds for immediate failure. Explicit cancellation, confirmed unrecoverable errors, and justified exhausted waiting policy can terminate. If Git needs a different timeout/failure policy than admission leases, document the concrete reason and make the behavior understandable and consistent to users. Finite tests/hang bounds remain required. Keep independent-resource concurrency and hook reentrancy.

The no-blind-replay requirement still applies: after partial progress wait for release, inspect Git state, then execute the correct continuation/retry. Do not repeatedly restart a paused rebase or consume workflow recovery budget while waiting. No runtime implementation in task-2816; this remains a separate mission from main.

Operator clarification: consistency requires ONE owning code path, not merely similar behavior or copied loops. Include the cohesive refactor in TASK-2830 itself: extract/reuse one admission waiting/retry owner for existing verification/test and custom-agent capacity paths plus Git contention, migrate production callers and remove superseded loops/redundant tests while preserving distinct behavioral assertions. No deferred cleanup/refactor mission. Resource-specific lock acquisition/recovery remains separate from common waiting orchestration; preserve existing dependency direction and typed ports.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
