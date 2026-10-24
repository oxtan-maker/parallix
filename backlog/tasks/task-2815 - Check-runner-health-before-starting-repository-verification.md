---
id: TASK-2815
title: Check runner health before starting repository verification
status: backlog
assignee: []
created_date: '2026-10-24 05:09'
labels: []
dependencies: []
priority: high
ordinal: 293008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2785 repeatedly returned to implementation after systemd could not create memory-limited test scopes. During investigation, /run/user/1000 was 100% full with 3.2 GiB of Parallix terminal data. Moving unused completed-mission logs to disk freed 1.45 GiB and scope creation succeeded. This supports a runtime-capacity diagnosis but does not establish the cause of every historical timeout.

Reuse the existing runner diagnostics and verification orchestration to check the actual ability to create and enforce a memory-limited scope, plus usable capacity on the runtime and test-temporary filesystems, before expensive verification starts. Represent an unhealthy runner as an actionable infrastructure blocker through existing status/evidence paths. Do not add verification gates, weaken memory containment, or treat runner unavailability as a mission regression. Board visibility is a separate investigation; reuse existing presentation where sufficient.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The verification entry point checks actual memory-scope creation/enforcement and usable runtime/temp filesystem capacity before starting expensive checks, reusing existing diagnostics and owners.
- [ ] #2 An unhealthy runner prevents expensive checks from starting and retains an actionable infrastructure diagnostic with the failed operation, filesystem or service, observation time, and remediation through existing status/evidence paths.
- [ ] #3 Infrastructure failure does not consume repeated implementation repair attempts without changed runner-health evidence; recovery requires a successful fresh health check and the original required verification.
- [ ] #4 Focused tests extend the owning preflight/verification suites for unavailable scope creation, full runtime/temp storage, healthy launch, and recovery; preserve operator-owned gate configuration and all memory/test invariants.
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
