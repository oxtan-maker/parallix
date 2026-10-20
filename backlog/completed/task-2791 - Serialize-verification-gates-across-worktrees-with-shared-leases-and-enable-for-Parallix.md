---
id: TASK-2791
title: >-
  Serialize verification gates across worktrees with shared leases and enable
  for Parallix
status: done
assignee: [codex]
created_date: '2026-10-20 02:21'
labels: []
dependencies: []
priority: high
ordinal: 272008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2781 integration failed when workflow process cases exceeded their unchanged 3500 ms wall deadlines during concurrent covered gate runs. A focused covered run of both suites passed all three cases (2127.887173 ms, 2551.733129 ms, 1404.821198 ms). Contention is a plausible contributor, not a proven root cause. Add an operator configuration option for exclusive gate execution across concurrent Parallix processes and mission worktrees, reusing the existing shared lease infrastructure and process identity/liveness handling. Enable the option in the Parallix repository configuration so Parallix develops itself with isolated gate runs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Expose a validated operator configuration option for exclusive gate execution; preserve current behavior when disabled and document its scope and waiting behavior.
- [ ] #2 When enabled, all configured verification gate entry points acquire the same shared exclusive lease across mission worktrees and concurrent px processes before starting gate children. Other gate invocations wait without overlapping; independent implementation work can continue.
- [ ] #3 Reuse the existing lease infrastructure and typed application ports with composition-owned wiring. Use a shared resource scope that covers all Parallix self-development worktrees; do not introduce a competing lock implementation or reuse agent capacity in a way that blocks agents needed by a running gate.
- [ ] #4 Release ownership only after gate descendants settle on success, failure, cancellation and interruption; reclaim abandoned ownership using existing process identity and liveness rules. Nested gate invocation must not deadlock or bypass isolation.
- [ ] #5 Enable the new option in Parallix own repository configuration and verify that inherited mission worktree configuration uses it. Preserve operator gate commands, membership, deadlines and CPU budgets.
- [ ] #6 Extend existing owning suites to prove cross-process exclusion, waiting progress, cancellation, stale-owner recovery and disabled behavior. Keep each modified integration test within 3.5 seconds and follow ADR 0057.
- [ ] #7 Manually exercise two concurrent public gate invocations using disposable repositories and shared lease state; show non-overlap and progress after release, then clean up without changing real operator data.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-20 admission observation (UTC): task-2792 completed handoff at approximately 16:16 and then waited for its mission-declared gate. Subsequent observed admission holders were task-2796 (~16:16), task-2787 (16:23:42), task-2794 (16:29:12), task-2797 handoff (~16:31), and task-2796 again (16:32:48). At audit, task-2792 owner PID 1928110/start identity 242196758 was live with no children; the verification lease belonged to task-2796 owner 1892397/242191076, created at 16:32:48.751Z. This records approximately 17 minutes of waiting with later admission opportunities; it does not establish permanent starvation.

The inspected implementation is non-FIFO: `src/adapters/process/gate-admission.ts:35-38` retries acquisition every 25 ms; `src/adapters/sqlite/custom-agent-lease-repository.ts:25-34` counts live holders and admits the transaction winner when capacity is available. It persists no waiter order or arrival timestamp and provides no bounded-wait entitlement, so a later poller can acquire before an older waiter. The existing criteria require exclusion, waiting progress and safe cleanup, but promise neither FIFO nor a finite maximum wait. These observations do not prove a contract violation. No gate configuration, budgets, criteria or lifecycle state were changed; any fairness policy needs separately scoped evidence and a decision.

2026-10-20 diagnostic admission recurrence (UTC): a supported `px review task-2785 --continue` launched a fresh repair agent, which ran the exact retained command `PARALLIX_TEST_COVERAGE=1 npm run test:integration:ci:prebuilt` directly while other worktrees held verification admission. Clean revision `315df71d3bb49f26897c7845c6c2466d0507b4f0` failed nine cases; the original CLI case passed in 4277 ms, while foreground Ctrl+C exceeded its unchanged 3500 ms bound at 3819 ms. Other CPU overruns were 603/600 ms, 162/150 ms and 857/850 ms. Suite CPU was 433909/552000 ms; elapsed 244850 ms. `/tmp/task-2785-fresh-gate.log` and `/tmp/task-2785-runner-contention.txt` retain the output and overlapping runner observations: load 52.68 and CPU-pressure avg60 58.79 percent. Contention is supported, but not proven to explain every failure.

The bounded diagnostic completed without repository changes. Supported `px stop task-2785` then stopped operation `f8194524-dacb-4b33-acd1-2f20f144c91e`, preventing an automatic full verification repeat without a demonstrated repair. Owner 466486/start243057116 and agent 470032 settled; a subsequent process scan found no active worktree runner, including separate process groups (only the pre-existing idle tmux terminal remained). Investigate admission ownership of direct fresh-repair diagnostic entrypoints and total composed CPU demand. This records a potential bypass of verification serialization, not a demonstrated lease exclusion failure; no gate, budget, status, criterion or admission policy changed.

2026-10-20 second diagnostic recurrence: supported review continuation for task-2794 launched the exact covered integration diagnostic outside shared gate admission while task-2786 held its verification lease (owner338089, acquired18:48:09Z). The diagnostic failed the same terminal observation pair: held-probe4787ms against3500ms, then provider exit1 instead of0; both cases subsequently passed in the owning isolated suite. Other prior failures passed unchanged (foreground interruption3416ms, admission596ms). Log `/tmp/task-2794-repair-gate.log` records CPU354290/552000ms; `/tmp/task-2794-repair-host.txt` records concurrent load. No tracked change justified a second full rerun. Supported stop completed before automatic repetition; a process scan including separate groups found only its idle pre-existing tmux terminal2748473. This is an operational verification-isolation problem, not a request to change operator gates or deadlines. The evidence does not prove contention is the sole cause of the observation failures.
<!-- SECTION:NOTES:END -->
