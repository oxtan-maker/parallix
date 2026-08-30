---
id: TASK-2447
title: Eliminate web-board projection hallucinations
status: backlog
assignee:
  - codex
created_date: '2026-08-30 15:06'
labels:
  - bug
  - user_value
  - web
  - backend
  - projection
dependencies: []
priority: high
ordinal: 124917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The shared MissionCard projection contains checkpoint history, pull-request reference, review approval, review history, commands, activity, and attention evidence. The web transport selectively drops facts, while earlier web components filled gaps with invented ranks, source narratives, lifecycle actions, fixed progress totals, and guessed card state. That produces a board which can disagree with Ink even though both should present the same operational truth.

Make the web board a faithful, validated view of the shared projection. The web transport must carry every board-projection fact Ink receives: all mission-card fields, attention evidence, activity, commands, metrics, provenance, and operation data. The web may choose a different visual treatment, but it may not drop, replace, or reconstruct a fact. Preserve the distinction between unknown, unavailable, null, and zero. Do not derive lifecycle eligibility, PR links, review totals, checkpoint status, ranks, or work state in React. The result must make missing evidence visible as missing rather than filling it with plausible-looking fiction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The web snapshot carries every board-projection fact available to Ink, including every MissionCard field, attention evidence, activity, commands, metrics, provenance, and operation data.
- [ ] #2 The web snapshot carries the checkpoint facts required for card indicators and the pull-request and review facts required for the PR link and review display.
- [ ] #3 Transport conversion and validation preserve every shared fact and its unknown/unavailable/null/zero semantics, and reject malformed payloads.
- [ ] #4 The browser has no client-side lifecycle rules or fabricated commands, ranks, source narratives, PR links, review totals, checkpoint states, or work states.
- [ ] #5 Attention contains only server-actionable entries with consecutive server ranks; source provenance is not presented as a fabricated operator queue.
- [ ] #6 Contract-parity tests fail whenever Ink can receive a shared board-projection fact that the web transport omits, for active, review, integration, blocked, and unavailable states.
- [ ] #7 The web board renders only received indicators and link data; missing evidence is shown as unavailable or omitted, never substituted with a plausible value.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Focused transport and web-render tests pass.
- [ ] #8 Static-analysis passes.
<!-- DOD:END -->
