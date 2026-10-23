---
id: TASK-2813
title: Restore local-only timing enforcement on GitHub
status: backlog
assignee: []
created_date: '2026-10-23 05:32'
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
GitHub CI failed test/integration/process/lead-active-interruption.test.ts:6: the TASK-2792 case timed out after 3500 ms (reported duration 3694.621453 ms). The same current-tree test passed locally in 2440 ms without coverage and 2518 ms with coverage. Hosted CPU speed and contention must not decide compliance with workstation performance budgets.

Historical policy: TASK-2542, "gitbhub runs tests and checks it should not (yet again)" (2026-09-19), explicitly states "TIMING ENFORCEMENT IS LOCAL-ONLY". Its archived record is recoverable with git show fad897a84:"backlog/completed/task-2542 - gitbhub-runs-tests-and-checks-it-should-not-yet-again.md". It excluded the timing-proof suite and budget reporter from GitHub while retaining local timing enforcement and finite timeout safety nets. TASK-2615 subsequently replaced brittle elapsed-time guardrails with CPU accounting and retained hosted timing suspension (commit b0cb0710f).

Regression provenance: TASK-2792, "Release workflow ownership correctly after Ctrl+C", introduced the unconditional { timeout: 3500 } and 1800 ms startup deadline in the lead interruption suite (mission commits 016164ca6 / 7cb6a7a86; landed on current main through combined squash 5a5e6cb23, whose headline names TASK-2804 but whose body includes TASK-2792). These deadlines bypass the existing onGitHubActions() suspension of CPU hooks/reporters. TASK-2807 (95e4cda00) subsequently restored covered integration concurrency from one to four; it did not introduce this timeout, although contention can expose it.

Restore the operator's intended separation: local verification enforces the existing performance/CPU limits; GitHub verifies functionality without workstation-speed deadlines, while retaining generous finite hang protection and reliable cleanup. Reuse the existing timing-policy owner and inspect other CI-selected cases/helpers for the same bypass. Keep functional suites in GitHub and preserve their assertions, coverage and normal parallel scheduling. This task explicitly authorizes separating the affected hosted hang bounds from local performance limits; it does not authorize weakening local budgets, removing all deadlines, adding/restoring verification gates, or suppressing failures with retries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused red-to-green regression in the existing timing-policy/runner owning suite showing that hosted execution cannot enforce the local 3500 ms performance threshold through a case-level timeout or its startup helper; local enforcement remains intact.
- [ ] #2 The TASK-2792 lead SIGINT case runs in GitHub with finite, generous hang/startup bounds independent of workstation performance limits; exit 130, interruption diagnostics, stopped durable operation and released current ownership assertions are preserved.
- [ ] #3 Audit CI-selected case-level timeouts and helper deadlines for equivalent bypasses of hosted timing suspension; correct performance-derived limits within a cohesive shared policy and record the scope/evidence in mission evidence.
- [ ] #4 Existing local CPU budgets, headroom checks, tier membership, functional coverage, LCOV/Sonar flow and normal covered parallel scheduling remain intact; no new/restored gate, blanket skip, retry-based pass or global serialization is introduced.
- [ ] #5 Exercise the real interruption flow using isolated fixture state under local and simulated hosted timing policies, including controlled delay beyond 3500 ms that passes hosted functional verification within its finite hang bound; demonstrate that a hung child still fails and is cleaned up. Follow ADR 0057, use the owning suite, and keep any added/modified integration case within the repository 3.5-second execution constraint by testing policy with doubles where needed.
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
