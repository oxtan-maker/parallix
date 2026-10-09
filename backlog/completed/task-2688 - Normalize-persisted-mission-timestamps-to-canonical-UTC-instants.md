---
id: TASK-2688
title: Normalize persisted mission timestamps to canonical UTC instants
status: done
assignee: [codex]
created_date: '2026-10-08 07:28'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 192008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mission lifecycle and administrative closure timestamps currently mix ISO-8601 UTC Z strings and explicit offsets. Normalize full timestamp storage to one canonical UTC ISO-8601 format while preserving each instant. Reporting must continue using the operator local timezone independently of storage. TASK-2685 must work with existing mixed formats and does not depend on this cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Define and enforce one UTC ISO-8601 timestamp format with explicit precision for new mission lifecycle and closure writes; audit other full timestamp fields before defining migration scope.
- [ ] #2 Provide an idempotent migration preserving exact instants, relationships, ordering and mission counts; date-only measurement fields retain their calendar-date meaning.
- [ ] #3 Malformed or timezone-ambiguous historical values are reported explicitly and are never silently assigned a timezone or discarded.
- [ ] #4 Existing mixed offset and UTC values remain readable during transition; chronological ordering compares parsed instants rather than raw timestamp text.
- [ ] #5 Demonstrate unchanged local-time reporting membership across migration, including midnight, DST and year boundaries, with isolated fixtures and focused owning-suite checks.
- [ ] #6 Before modifying real operator data, provide a backup and dry-run audit with a concrete migration and recovery plan.
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
