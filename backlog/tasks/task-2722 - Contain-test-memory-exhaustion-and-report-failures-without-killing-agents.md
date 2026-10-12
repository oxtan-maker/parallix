---
id: TASK-2722
title: Contain test memory exhaustion and report failures without killing agents
status: backlog
assignee: []
created_date: '2026-10-12 03:30'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 220008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Regular tests launched by agents need an aggregate memory boundary that terminates the test workload and its descendants, reports a resource-limit failure to the caller, and leaves the agent and host running. Existing CPU/wall watchdogs do not prevent a test from exhausting host memory before they can report.

Evidence from PX-0008: TASK-2660 unmanaged was interrupted after a focused npm test request at 2026-10-12 02:15:17 Europe/Stockholm. The operator reported Linux memory-pressure kills at least three times. The exact historical planner selected one suite, presentation-web-contract.test.ts, which imports ten case modules; it did not expand into the complete test tier. On an isolated copy, the agent-generated DOM assertions exhausted an 8 GiB process-tree cgroup in 14 seconds. Changing only assertion failure formatting to boolean/null checks preserved four failing assertions and completed in 3 seconds at 427 MiB. The selector mistakenly found the existing FLOW button. The run's scratch directories were disk-backed, not the host's RAM-backed /tmp.

Implement production test-runner containment, rather than relying on the research harness's whole-arm cap. A runaway test must produce an actionable failure that lets the same live agent repair its work. Keep platform/resource policy in the existing architectural boundaries, profile realistic workloads before choosing defaults, and document explicit capability limits instead of implying a per-process V8 heap cap constrains all children.

Research evidence is local to /mnt/data/code/parallix-research/px-0008/qwen-no-context-expanded/recovery/20261012T032223Z/. It is supporting evidence, not a portable test dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Supported regular agent test entrypoints, including focused npm test selections, tier runs and verification gates, enforce a finite aggregate memory limit over the test process tree; the calling agent and supervising reporter remain outside the kill boundary.
- [ ] #2 A memory breach terminates all owned test descendants, returns a non-zero result and reports the selected suite/command, configured limit, available peak/kill evidence and memory-limit cause to the live caller; it is never reported as an ordinary pass or an unexplained timeout.
- [ ] #3 Default limits and any tier-specific overrides are justified by current memory profiles with explicit headroom for legitimate tests, concurrent workers, compiler/native allocations and descendants. Limits are configurable and validated without silently falling back to unbounded execution.
- [ ] #4 Focused test file selection remains focused; existing CPU budgets, finite wall deadlines, coverage requirements and verification-tier semantics remain intact. Supported direct/ad-hoc test invocations and any bypass boundaries are explicit.
- [ ] #5 A bounded retained reproduction proves an intentionally memory-growing test and a memory-growing descendant fail inside the test boundary while the parent/agent remains alive and can receive diagnostics; owning tests cover cleanup on success, failure, timeout and signal without exhausting the real host.
- [ ] #6 Platform/cgroup capability failures are actionable and accurately reported; supported fallback guarantees are stated explicitly, and docs explain resource limits and how agents should respond to a memory-limit failure.
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
