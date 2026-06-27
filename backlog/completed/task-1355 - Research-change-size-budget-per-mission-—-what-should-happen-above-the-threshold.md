---
id: TASK-1355
title: >-
  Research: change-size budget per mission — what should happen above the
  threshold
status: done
assignee: [claude]
created_date: '2026-06-26 17:59'
labels:
  - ai_sdlc
dependencies:
  - TASK-1267
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug-reduction initiative #7 (research only). Defect density rises with diff size and large diffs degrade review quality, so a per-mission change-size budget would make the review/test/property guardrails more effective. BUT the action on breach is genuinely unclear and hard to estimate — agents have proven bad at predicting change size up front (relates to TASK-1267).

Research questions to answer before any implementation:
- What signal correlates best with mission risk: net changed lines, files touched, hunks, or cyclomatic delta? (Line count is the naive choice and easy to game.)
- When measured: at draft (predicted, unreliable) vs at handoff (actual, but too late to decompose cheaply)?
- What is the action on breach — hard block, warn+override, force decomposition into sub-missions, or just escalate review depth (e.g., trigger multi-pass review)? A hard 1000-line wall is too blunt given how variable mission shape is.
- Can we measure the actual correlation between diff size and bug rate in THIS repo's archived missions to set an evidence-based threshold rather than a guessed one?

Deliverable: a short findings doc + a recommendation (or a decision not to implement). No code in this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A findings doc analyzes diff-size vs bug rate across archived parallix missions
- [ ] #2 The doc recommends a metric (lines/files/hunks/complexity) and a measurement point (draft vs handoff) with rationale
- [ ] #3 The doc recommends a breach action (block / warn+override / escalate review / decompose) or recommends not implementing, with justification
- [ ] #4 Findings explicitly address why agent up-front size estimation is unreliable and whether actual-at-handoff measurement avoids that
<!-- AC:END -->
