---
id: TASK-2874
title: Fix POMDP history ordering after integration repair
status: backlog
assignee: []
created_date: '2026-11-25 15:02'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A successfully verified integration repair can break POMDP history replay and cause later reviewer rounds to omit integration tests. PX-0077 CLI review rounds 7 and 8 recorded `belief-unmodelled-history: repair has no preceding failed verdict`. Round 8 approved `2a5bb3ff2` without recording tests for it, and integration correctly refused the older passing receipt from `90c120118`. The failure occurs in the shared application history adapter and is independent of the web process version.

Read-only replay of PX-0077 round 6's integration incident reproduced the failure on main (`3e6ace28a`) and on PX-0077 (`2a5bb3ff2`). The test failure is recorded at `2026-11-25T09:29:50.542Z`, the passing validation of the repaired candidate at `10:18:55.457Z`, and the successful rebound repair at `10:18:55.596Z`. `history-adapter.ts` normalizes round and lifecycle slots first, then `withGateSlot` inserts gate evidence and sorts again. On the repaired checkout the resulting sequence is agent pass → tests fail → tests pass → tests repair. The inserted pass clears the pending test failure before the repair transition, so `deriveBelief` rejects the repair. On a newer checkout, an input-equivalent proof for a different change identity can insert `unmodelled-change` at the same point and produce the same failure. A proof already classified stale leaves replay valid.

Reproduce in the existing `test/unit/application/verification-policy/history-adapter.test.ts` suite. Construct an approved round with a recorded integration repair, a failing tests verdict, and a current passing hook proof on the repaired candidate timestamped between the failure and successful repair record. Feed the adapted entries into `deriveBelief`. Cover the newer-checkout identity mismatch with the same history. Exercise the CLI review action with isolated state and a stubbed reviewer. Preserve exact-current admission and existing gate configuration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Replay the recorded failed tests, completed repair and resulting test verdict without an orphan repair, and apply the repair transition once.
- [ ] #2 A historical proof for a different change identity cannot reset history inside the earlier repair or count as current tests for the newer revision.
- [ ] #3 An eligible reopened review follows the pinned policy, records one test action for the current revision, and does not require a second review invocation solely to obtain the tests.
- [ ] #4 When genuine policy fallback occurs, the approved candidate still receives the fixed sequence’s configured tests before a human landing handoff when current passing evidence is missing.
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
