---
id: TASK-2779
title: Use active agent policy for act-on-review recovery
status: done
assignee: [codex]
created_date: '2026-10-19 07:00'
labels:
  - bug
dependencies: []
priority: high
ordinal: 260008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The act-on-review workflow step must use the same agent eligibility and selection policy as active, with active as the single configuration authority. During px-0015 integration recovery on 2026-10-18, act-on-review had no configured step entry and fell back to all built-in agent families, randomly selecting qwen even though active permits only codex, claude, and custom. Qwen failed with model entitlement denied and execution fell back to Codex. Remove the independent missing-step fallback for this implementation action; do not fix this by duplicating an active eligibility list under a new configuration key.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 act-on-review resolves eligibility and selection settings from the active step policy, including operator changes, without requiring a separate configuration entry.
- [ ] #2 Recovery and fallback for act-on-review never select a family excluded by active policy, even when its launcher is installed and healthy.
- [ ] #3 A focused regression in the owning agent-selection suite reproduces selection of an excluded family on the parent behavior and passes with the fix; cover shared selection settings and exhaustion without falling back to all built-in families.
- [ ] #4 Manually exercise integration repair selection with isolated mission state and controlled launchers to confirm only active-eligible families are dispatched.
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
