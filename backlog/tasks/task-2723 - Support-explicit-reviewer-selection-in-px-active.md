---
id: TASK-2723
title: Support explicit reviewer selection in px active
status: backlog
assignee: []
created_date: '2026-10-12 04:21'
labels:
  - feature
dependencies: []
priority: medium
ordinal: 221008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow operators to select the reviewer for the automatic review launched after implementation with px active <slug> --implementer <family> --reviewer <family>. Today Active reads only --implementer and silently ignores --reviewer, allowing automatic selection to launch another family. Observed during TASK-2722 when --reviewer codex was supplied and Custom/Pi launched. History investigation found no prior Active wiring for this flag; treat this as a feature, not a confirmed removed capability. Thread the explicit reviewer through the existing typed execution and handoff boundaries into the existing review selection policy. Preserve current automatic selection when omitted. Board launcher availability diagnostics and signal-induced cooldown policy are separate work and out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px active accepts --reviewer <family> alongside --implementer and passes the requested family to its automatic review; a different available family is not silently substituted for a valid explicit selection.
- [ ] #2 Missing reviewer values, unknown families and unavailable or blocked explicit reviewers produce actionable diagnostics using the existing explicit-reviewer policy, rather than silently ignoring the selection.
- [ ] #3 Omitting --reviewer preserves current automatic reviewer selection; implementation selection, handoff repair and review continuation retain their existing behavior.
- [ ] #4 Extend the owning Active invocation and execution/handoff contract suites to prove argument validation and end-to-end propagation into review selection, including omission and unavailable selection; use isolated doubles and the narrowest appropriate tier.
- [ ] #5 Update CLI help and relevant live guidance, run focused contract checks and static-analysis, and manually verify the public Active interface selects the requested reviewer in an isolated safe mission.
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
