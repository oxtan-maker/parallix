---
id: TASK-2536
title: Do not globally block a live agent family after an ambiguous launch failure
status: done
assignee: [custom]
created_date: '2026-09-18 06:49'
labels: [bug, ai_sdlc]
dependencies: []
priority: high
ordinal: 90002
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix's operator-local `agent_blocklist` marked both Codex and Claude
unavailable while they were demonstrably active. The database records show a
single failure burst on 2026-09-18: Codex was blocked at 06:13:46 CEST with
`exit 1`, and Claude at 06:13:48 with `exit 1: process crashed`; both had a
three-hour expiry. The workflow then recorded Claude as running at 06:16:21
CEST. The same database currently makes both families ineligible globally.

The fault appeared during that 06:13 CEST launch sequence, within the last 48
hours. Recent launcher history includes the 2026-09-16 Codex sandbox fallback
change, but no later committed Claude/Codex/blocklist change explains the
06:13 writes. Treat the persisted launch evidence and the live-work conflict
as the reproduction boundary; do not guess that a working external session
clears a failed Parallix child process.
<!-- SECTION:DESCRIPTION:END -->

## Root cause to establish

The launch retry path persists a family-wide three-hour block for a non-zero
exit unless the output matches a narrow deterministic-error or telemetry
exception. That converts an ambiguous per-invocation failure into global
unavailability, without retaining enough launch identity or checking whether
the family still has live work. Consequently a later selection reroutes away
from a usable family.

## Required fix

Keep transient retry exclusion local to the failing launch. Persist a
family-wide block only when the failure is positively classified as a genuine
provider-wide availability or quota condition. Preserve useful diagnostics:
the operator must be able to see the failed launch, its reason, and why it did
or did not create a global block.

Add a regression that reproduces an ambiguous Codex/Claude non-zero launch
while current work for that family remains live, then verifies that later
selection can still choose the family. Keep genuine usage-limit and confirmed
provider-wide outage blocks intact.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] An ambiguous non-zero Codex or Claude launch does not create a global
      `agent_blocklist` row that makes a live family ineligible.
- [ ] The failed invocation is still visible with its reason to the operator.
- [ ] Confirmed quota or provider-wide failures still produce an expiring
      persisted block and reroute as before.
- [ ] A focused regression test mocks all agent/process boundaries and finishes
      within the unit-test budget.
- [ ] `npm test -- --unit-test-headroom` and
      `./scripts/verify-local.sh static-analysis` pass.
<!-- DOD:END -->
