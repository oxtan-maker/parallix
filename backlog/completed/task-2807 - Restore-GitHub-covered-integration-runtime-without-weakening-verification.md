---
id: TASK-2807
title: Restore GitHub covered integration runtime without weakening verification
status: done
assignee: [codex]
created_date: '2026-10-22 13:05'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 286008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2762 left GitHub coverage and integration infrastructure working with the CI-safe integration population running at four workers. TASK-2796 later changed only covered integration runs to one worker in `test/lib/test-run-plan.ts`, even though TASK-2796 was scoped to rebase-diagnostic recovery and explicitly prohibited verification-gate changes. GitHub always sets `PARALLIX_TEST_COVERAGE=1`, so the whole 196-suite `integration-ci-all` population now runs serially and the required GitHub job has regressed from roughly 90 seconds to roughly five minutes.

Restore approximately the post-TASK-2762 covered GitHub integration wall time without removing coverage, skipping suites, weakening assertions, raising deadlines or CPU budgets, changing tier membership, or adding/restoring any verification gate. Do not make unrelated rebase, recovery, documentation, architecture-scan or workflow changes. Preserve the existing Sonar-consumable LCOV flow and ensure the result is stable on a clean GitHub-hosted runner, not merely fast on a warm local checkout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 The GitHub `ci-required` coverage flow still runs every registered `integration-ci` suite exactly once, produces both tier LCOV fragments, merges them into `coverage/lcov.info`, and leaves SonarQube coverage input intact.
- [ ] #2 On a clean GitHub-hosted runner, the covered `integration-ci-all` population has a measured wall time approximately comparable to the post-TASK-2762 baseline (about 90 seconds), with the chosen tolerance and raw timing evidence recorded in the mission evidence rather than asserted from local timing.
- [ ] #3 The change retains every integration assertion, test timeout, CPU budget, tier assignment and current test population. It does not serialize the entire covered population solely to protect a smaller contention-sensitive subset; any isolation or scheduling is justified by a focused reproduction of the shared-resource conflict.
- [ ] #4 A focused red-to-green regression reproduces the runtime-policy regression: coverage must not silently force the entire GitHub integration population into serial execution when the established parallel-safe schedule is available.
- [ ] #5 The affected process-heavy suites are exercised under the selected covered scheduling on a clean runner and pass without retries, test-order coupling, leaked processes, shared-state collisions or relaxed limits.
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 The focused runtime-policy and contention reproductions are green with retained failure-mode assertions.
- [ ] #2 GitHub `ci-required` passes using the unchanged coverage and SonarQube flow, with the measured timing evidence captured from that run.
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip).
- [ ] #4 No verification gate was added, restored, bypassed or weakened, and no CPU budget or timeout was raised.
- [ ] #5 Final checkpoint Goal Check table cites the scheduler, coverage-flow and clean-runner timing evidence.
<!-- DOD:END -->
