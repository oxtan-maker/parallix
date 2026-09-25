---
id: TASK-2567
title: Make mocked lifecycle E2E fast without agent launches
status: done
assignee: [codex]
created_date: '2026-09-24 19:35'
labels:
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repository's workflow integration gate runs `test/e2e-mission-lifecycle.test.ts`. Nine cases recently took about 195 seconds in total; ordinary single-lifecycle cases took about 19–21 seconds each, versus the previous 1–4 seconds per test.

A representative primary-branch case took 21.2 seconds without instrumentation. Lightweight process timing attributed about 12.0 seconds to draft, 6.6 seconds to active, 0.8 seconds to the review-state read, and 1.0 second to integrate. It started 24 CLI processes, including 10 `status` reads, and launched three stub agent processes through the normal agent launcher. The stub then ran separate CLI processes to record the mission contract and checkpoint evidence. Non-status contract writes alone took about 6.9 seconds. Although 495 Git subprocesses ran, their combined wall time was about 1.8 seconds.

This suite tests mocked-agent lifecycle behavior. It must not launch or probe an agent executable. Drive draft, execute, and review through in-process fake agent ports that produce the required artifacts and recorded state, while retaining the real lifecycle transitions, Git worktree/integration behavior, and failure-path assertions. Keep real agent-launch coverage in the separate agent E2E suite. Avoid a test-only production mode or a second workflow implementation if the existing ports can supply the fake.

`px status` is being optimized separately under TASK-2564; exclude that work from this task. TASK-2558 covers parallel integration gates and is also separate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 The mocked lifecycle suite launches and probes no agent executable; a test guard detects an accidental agent-launch regression.
- [ ] #2 Draft, active, review, integrate, adhoc intake, hook, and failed-gate assertions still exercise their real lifecycle and Git boundaries with deterministic fake agent output.
- [ ] #3 Real agent launcher behavior remains covered by the separate agent E2E suite, with no real-agent test moved into the mocked lifecycle gate.
- [ ] #4 Record comparable before/after wall times on the same workstation. Target at most 8 seconds for a representative single-lifecycle case and a substantial reduction from the approximately 195-second nine-case suite, without adding flaky timing assertions.
<!-- AC:END -->
