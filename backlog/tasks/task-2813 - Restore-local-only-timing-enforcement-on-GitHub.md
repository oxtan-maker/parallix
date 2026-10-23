---
id: TASK-2813
title: Restore local-only timing enforcement on GitHub
status: backlog
assignee: []
created_date: '2026-10-23 05:32'
updated_date: '2026-10-23 05:33'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - test/integration/process/lead-active-interruption.test.ts
  - test/lib/test-run-plan.ts
  - test/unit/test/lib/default-test-suite.test.ts
priority: high
ordinal: 292008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Restore the existing TASK-2542 policy: performance/timing enforcement is local-only. GitHub must execute the functional contracts without workstation-speed requirements. Keep finite hang protection and cleanup. This is a restoration of existing behavior through its current owner, not a new timing framework or a one-test timeout workaround.

Evidence and provenance:
- TASK-2542 ("gitbhub runs tests and checks it should not (yet again)", 2026-09-19) explicitly states "TIMING ENFORCEMENT IS LOCAL-ONLY". Recover its historical record with git show fad897a84:"backlog/completed/task-2542 - gitbhub-runs-tests-and-checks-it-should-not-yet-again.md". It retained finite timeout safety nets, local headroom enforcement and local timing-proof coverage.
- TASK-2615 retained GitHub timing suspension when replacing brittle elapsed-time budgets with CPU accounting (b0cb0710f). Current owners include test/lib/test-run-plan.ts, test/run-default-tests.ts, the CPU hooks and the existing default-test-suite timing-policy assertions.
- TASK-2792 ("Release workflow ownership correctly after Ctrl+C") introduced the unconditional 3500 ms case timeout and 1800 ms startup deadline in test/integration/process/lead-active-interruption.test.ts. Original mission commits: 016164ca6 / 7cb6a7a86. Main received it through combined squash 5a5e6cb23; that squash headline names TASK-2804, but its body and original mission commits identify TASK-2792.
- TASK-2807 (95e4cda00) later restored covered integration concurrency from one worker to four. It did not introduce this timeout; changing concurrency again is not the restoration.
- Reported GitHub failure: timeout after 3500 ms, duration 3694.621453 ms. Current-tree focused local runs passed at 2440 ms without coverage and 2518 ms with coverage.

Trace and repair the entire enforcement path, including per-case options and helper startup/poll deadlines that can bypass runner policy. Reuse the existing owner where its contract matches, ensure real execution uses the restored policy, and remove superseded or duplicate enforcement. Preserve distinct functional assertions. Do not merely add another helper, special-case this test, inflate all deadlines, optimize until this workstation passes, or add tests that only inspect configuration.

The operator explicitly authorizes correcting hosted deadline behavior in this task while retaining local performance enforcement. Do not weaken local CPU/headroom budgets, skip functional suites on GitHub, remove finite hang bounds, serialize the coverage population, add retries, or add/restore verification gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Trace TASK-2542/TASK-2615 policy through the current runner, case-level options and helper deadlines; identify the existing owner and record which TASK-2792 paths bypass it. Distinguish actual performance enforcement from finite hang protection before editing.
- [ ] #2 Restore local-only performance enforcement through the existing policy owner, with production test execution using that owner; remove the superseded bypass and redundant logic/tests while preserving distinct behavioral assertions. No parallel policy framework or lead-test-only exception is introduced.
- [ ] #3 Extend the existing owning suite with behavioral red-to-green evidence: a functionally successful operation exceeding the local performance threshold is accepted under hosted policy, the equivalent local performance violation is still rejected, and a genuine hang still fails with cleanup. Use doubles/controlled time for threshold proofs so no new or modified integration test exceeds 3.5 seconds.
- [ ] #4 The retained TASK-2792 real-process case proves SIGINT exit 130, interruption diagnostics, durable stopped operation and released current ownership under the restored execution path; hosted startup and outer hang bounds do not enforce workstation-speed requirements.
- [ ] #5 Audit the CI-selected population for equivalent case/helper bypasses and fix those belonging to this same policy contract. Preserve local CPU budgets/headroom enforcement, functional assertions, tier membership, coverage/LCOV/Sonar and normal parallel scheduling; do not obtain green by skips, retries, global serialization or weakened local limits.
- [ ] #6 Manually exercise the interruption/settlement flow in isolated state and verify the real runner with local and hosted policy selection, with no real missions or operator state touched. Capture focused contract results and actual GitHub functional verification before claiming restoration; a local-only green or static configuration assertion is insufficient.
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
