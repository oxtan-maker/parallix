---
id: TASK-2776
title: Make web checkpoint labels and current work agree
status: done
assignee: [codex]
created_date: '2026-10-18 06:02'
labels:
  - bug
  - web
dependencies: []
priority: high
ordinal: 258008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The operator observed CP-2 text alongside a blinking CP-3 marker. projectMissionCard selects latestEvidencedCheckpoint for the text and nextActionText, while checkpointEvidence marks the first planned checkpoint current for active missions. CheckpointPips blinks that marker whenever any mission work is running. These are different facts and do not establish which checkpoint is actually being worked. Trace current architectural authorities for checkpoint progress and work attribution; use those facts rather than client guesses or the assumption that first unevidenced means currently executing.

Recorded evidence describes previous recorded work, not necessarily present activity or verified completion. Keep last recorded checkpoint/evidence, any authoritatively known current checkpoint/activity, and subsequent plan/guidance semantically distinct. Next action recorded on a previous checkpoint must not masquerade as current work. Prefer current activity on the card when evidence supports it. Coordinate with TASK-2773.04, which owns the bounded progress-track visual redesign and removal of blinking, and TASK-2773.08, which owns text deduplication; avoid duplicate visual work.

Revalidate against the active tree before implementation. Preserve ports/adapters, typed application ports and composition authority; do not introduce a second status authority or change operator-owned verification gates. Read ADR 0057, extend the owning suite, retain a focused parent-red/fix-green reproduction, and run focused checks. Manually exercise the affected web flow with isolated fixtures without mutating operator missions or statistics. New or changed integration tests must finish within 3.5 seconds; unit cases must satisfy the 500 ms headroom requirement. Respect source-size caps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Checkpoint labels, details and indicators consistently distinguish last recorded evidence, known current work and future plan; recorded evidence alone is not equated with currently executing work or verified completion.
- [ ] #2 Only authoritative checkpoint/work attribution can identify the executing checkpoint; missing attribution remains explicit instead of selecting the first unevidenced checkpoint as a runtime fact.
- [ ] #3 The card prioritizes available current activity and identifies previous checkpoint next-action text as recorded guidance; checkpoint descriptions/evidence remain accessible.
- [ ] #4 Focused regression and isolated manual cases cover the reported CP-2/CP-3 mismatch, sparse and partial plans, first start, repair/review/gate work, completion and unavailable current attribution.
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
