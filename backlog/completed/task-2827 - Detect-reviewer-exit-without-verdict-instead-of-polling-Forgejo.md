---
id: TASK-2827
title: Detect reviewer exit without verdict instead of polling Forgejo
status: done
assignee: [codex]
created_date: '2026-10-31 16:45'
labels:
  - bug
  - harness
dependencies: []
priority: high
ordinal: 299024
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during review round 4 of px-0021 (reviewer `custom`, pi runner, local model on `kub`).

The reviewer's last two turns ended with `stopReason: length` (output-token limit hit while reasoning), so its pending `px verdict` tool call was never executed. The pi process then exited. `px review` kept running and logged `Polling Forgejo for round 4 review by custom on PR #790 (timeout 600s)` / `still waiting for custom's review...` while the model backend was idle (`/slots`: `is_processing: false`) and no reviewer process existed. The wait had no relation to the actual state: the verdict is recorded through `px verdict` in the mission database, not as a Forgejo review, and the reviewer process was already gone.

Observed consequences: the operator sees an apparently busy review for ten minutes with nothing running; there is no retry with a smaller or compacted context; a `length` stop is not classified as a reviewer failure.

Expected: the review loop treats reviewer-process exit with no recorded verdict as an incomplete reviewer artifact immediately, classifies a `length` stop as such, and retries within the existing bounded budget (or fails with a precise diagnostic). It must not wait on a Forgejo review that cannot arrive.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the reviewer process exits without a recorded verdict, the loop reports that immediately and does not poll Forgejo for the remaining timeout
- [ ] #2 A reviewer run that ends with an output-token-limit stop is classified as an incomplete reviewer artifact with that cause named
- [ ] #3 The existing bounded reviewer retry budget applies; exhaustion fails with a diagnostic naming the cause and the recovery command
- [ ] #4 Each fix has a focused regression case in the existing review-loop owning suite
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
