---
id: TASK-2816
title: Bound terminal and coverage retention and reclaim abandoned temporary data
status: backlog
assignee: []
created_date: '2026-10-24 05:10'
labels: []
dependencies: []
priority: high
ordinal: 294008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During TASK-2785 investigation, /tmp held 8.58 GiB of abandoned coverage-scratch data across three checkout temp roots; no live process referenced it. /run/user/1000/parallix-terminal occupied 3.2 GiB and filled the runtime filesystem. Completed-mission terminal transcripts included individual files hundreds of MiB in size.

Keep bulky terminal transcripts and raw coverage payloads on a disk-backed storage location while retaining short private runtime paths for sockets. Bound terminal retention and reclaim abandoned coverage/temp roots using existing ownership and cleanup mechanisms. Preserve retained workflow evidence, active runs, sandbox isolation, replay behavior, and operator-owned gates. Verify existing cleanup and retention owners before adding an implementation; interrupted runs and SIGKILL must not leave unlimited data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Bulky terminal transcripts and raw coverage payloads use disk-backed storage; socket/runtime paths remain private, portable in length, and compatible with existing sandbox boundaries.
- [ ] #2 Terminal output has finite retention/rotation with explicit reporting when content is no longer retained; completed-mission data cannot fill the user runtime filesystem.
- [ ] #3 Abandoned coverage/temp roots are reclaimed after owner-liveness checks, including recovery after interruption or SIGKILL; active runs, shared caches, and required durable evidence remain intact.
- [ ] #4 Extend owning retention/temp-cleanup/terminal suites for repeated runs, interrupted-owner recovery, active-owner protection, and replay/retention behavior; preserve gate configuration, assertions, finite budgets, and existing verification tiers.
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
