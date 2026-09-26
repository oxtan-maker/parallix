---
id: TASK-2583
title: make the ux for pi better
status: backlog
assignee: []
created_date: '2026-09-26 10:48'
labels: []
dependencies: []
ordinal: 114008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
currently the pi agent integration is not living up to the quality bar of what a senior engineer would expect, example:   Yes
✳  — this is a fix
✳  to Parall
✳ ix's own
✳  autonomous review lifecycle
✳  (an
✳  agent workflow bug). So ai
✳ _sdlc +
✳  bug.
✳ 

OK
✳ , let me look
✳  at the key code
✳  to ground
✳  the contract
✳  in
✳  facts
✳ . Let me skim
✳  review
✳ -loop
✳ .ts around
✳  lines 40
✳ 0–42
✳ 0, and
✳  the relevant
✳  functions in review-round.ts, review
✳ -state.ts, and review
✳ -persistence.ts. I
✳  don
✳ 't need
✳  to fully
✳  understand it
✳ ,
✳  but I need enough
✳  material
✳  to write
✳  concrete success
✳  criteria and checkpoints.

Let me also
✳  check test
✳ -categories.ts
✳  to understand how new
✳  integration
✳  tests are classified (AG
✳ ENTS.md
✳  requires
✳  it
✳ ). And
✳  for
✳  test
✳  tier
✳ ing
✳ , I
✳ 'll read
✳  ADR 0059.
✳  Let
✳  me also
✳  peek
✳  at existing
✳  timing
✳  tests,
✳  e.g.,
✳  test/task
✳ -2376
✳ -lifecycle-timing.test
✳ .ts, which
✳  seems
✳  related
✳  to lifecycle

No✳  timing.

 `px label` — labels live in backlog frontmatter. Now let me ground the contract in the actual code.

⚒ bash
⚒ bash
⚒ bash
✓ bash  ...round.reboundCollaborators(), verifyFn: round.verifyPreReviewSetup, // TASK-2377.04: the per-occurrence budget is clamped to the // remaining per-round relaunch cap before the launch. maxAttempts:
✓ bash 102:export async function recordRequestedChanges( 174: * check in {@link recordApproval}, so a future wording change to one cannot 184: * {@link recordApproval} and the provider-backed pre-check in 19
✓ bash 829: return await this.approveLifecycle(review, mission, nextVersion, lifecycleService) || { outcome: 'committed' }; 832: private async approveLifecycle(review: any, mission: any, nextVersion: any, li
✳ ADR
✳  0059 is "fleet
✳ -level-recovery-supervisor.md
✳ ",
✳  not test
✳  selection. Let me check A
✳ DR 0059 —
✳  AGENTS.md
✳  says "read
✳  ADR 0059 before
✳  changing test selection".
✳  Let me read
✳  that
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
