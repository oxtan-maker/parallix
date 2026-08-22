---
id: TASK-2391
title: integrate recovery cannot handle an active mission with an already-approved review
status: active
assignee: [claude]
created_date: '2026-08-22'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/adapters/cli/commands/integrate.ts
  - src/domain/mission-workflow.ts
  - src/application/handoff-command-use-case.ts
priority: high
ordinal: 105917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px integrate` fails to close a mission whose review was approved **outside**
the local CLI (e.g. approved directly on the Forgejo PR) while the local
mission status is still `active`. The run reaches lifecycle recovery, emits
`[FAIL] Mission state transition failed: A submitted review must be awaiting a
reviewer decision`, and aborts even though an authoritative approval already
exists on the provider.

Reproduced state: mission `status === 'active'`, `mission.review.rounds[-1]`
has `decision.kind === 'approved'` (approval landed on the provider before the
local status advanced to `review`), and a provider approval is recorded
(`context.approval.defaultUserApproved === true`).

Root cause is a gap in the two recovery branches of
`recoverMissionForIntegration` (`src/adapters/cli/commands/integrate.ts`):

- Branch B (`status === 'review'`) handles an externally-approved review
  correctly: it records the human override at its own timestamp and runs the
  `approve` transition to `integration`.
- Branch A (`status === 'active'`) unconditionally calls `submitForReview` to
  replay the `active -> review` handoff. The handoff loads the existing review,
  sees the round is not `ready-for-next-round`, and returns it **unchanged**
  (the `handoff-command-use-case.ts` `priorReview` path). `decideMission`
  then runs `submit-for-review` against that already-`approved` round and throws
  at `src/domain/mission-workflow.ts:97` because the guard requires
  `reviewStatus(command.review) === 'awaiting-review'`.

The workflow guard is also the second half of the bug: its idempotency
short-circuit only fires when `mission.status === 'review'`. An `active`
mission carrying an already-decided round is neither idempotent nor
re-submittable, so there is no valid path from `active + approved review` to
`integration`. The `resubmission` exception in the same guard requires
`!recordedRound.decision`, so an already-approved same-round resubmission is
explicitly rejected rather than treated as a no-op.

This is pre-existing recovery/workflow code (blame traces to the task-2378 /
task-2376 / task-2357 era). It is **not** introduced by the bounce-kernel
mission task-2377.05, whose only edit to `integrate.ts` was the F3 implementer
resolution guard.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mission in `active` status with an existing review round whose latest
  round is `approved` (and a provider approval recorded) recovers to
  `integration` under `px integrate` instead of aborting with
  "A submitted review must be awaiting a reviewer decision".
- [ ] #2 The recovery does not re-submit or rewrite the already-approved round:
  the recorded decision, its `decidedAt`, and the reviewed change/PR are
  preserved.
- [ ] #3 A genuine fresh submit-for-review (round still `awaiting-review`) is
  unchanged and still transitions `active -> review`.
- [ ] #4 Branch B (`status === 'review'`) externally-approved recovery keeps
  passing; no regression to its timestamp/override behavior.
- [ ] #5 A focused test reproduces the `active + approved` recovery and asserts
  the mission reaches `integration` with the approval decision intact.
- [ ] #6 `./scripts/verify-local.sh static-analysis` passes.
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
