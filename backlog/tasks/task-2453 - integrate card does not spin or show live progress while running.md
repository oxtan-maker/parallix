---
id: TASK-2453
title: integrate card does not spin or show live progress while running
status: backlog
assignee: [custom]
created_date: '2026-09-03 09:00'
labels:
  - bug
  - integration
  - web
  - board
dependencies: []
priority: medium
---

## Description

While `px integrate <slug>` is genuinely running its integration gates (the repo
defences), the web board gives the operator no progress and misleading copy.

Two defects, both on the read side of the current-work authority:

1. The fans stay still. `isSpinning` in `web/src/format.ts` returns true only
   when `card.activity.work.certainty === 'live'`. The integrate fact is
   published by `IntegrateCommandUseCase.execute` with the running process's
   `processId`, but the board's liveness probe cannot confirm that process, so
   `runningFreshness` returns `unverified` and the card renders `working ·
   unconfirmed` with a still fan. The board's own `isWorkInProgress` already
   treats `unverified` as in-progress; the web `isSpinning` is stricter than the
   board's definition and hides live work from the operator.
2. The copy is wrong. The action button renders `… · starting…` whenever the
   action is pending (`web/src/action-button.tsx`). During a long-running
   integrate that reads as "starting" forever instead of "running".

The write side is correct: the `integrate` current-work fact is published
before the gate `spawnSync` and `ended` after, so the timing is right. The gap
is purely that the integrate process is not observed as alive and the pending
button text is not distinguished from a long-running operation.

Related, separate finding (not this task): a concurrent `px integrate` and
`px draft` can collide on the main checkout, because `integrate-conflict.ts`
runs `git stash push --include-untracked` and `git reset --hard HEAD` on it.
File that as its own task rather than folding it in here.

## Acceptance Criteria

- [ ] #1 The web board spins the fans for a mission whose current-work fact is
      `unverified` (i.e. the server reports work underway but the liveness probe
      could not confirm the process), matching the board's own
      `isWorkInProgress` definition.
- [ ] #2 The action button shows a running/working state rather than `starting…`
      once the operation has been underway beyond the just-pressed window.
- [ ] #3 The Ink TUI reflects the same live-work state as the web board for the
      same projection; both surfaces read one authoritative fact.
- [ ] #4 A regression test asserts the fans spin for an `unverified` integrate
      fact and stay still only when the fact is cleared or `stale`.

## Definition of Done

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
