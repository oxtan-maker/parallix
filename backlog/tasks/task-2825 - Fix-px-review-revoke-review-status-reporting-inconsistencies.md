---
id: TASK-2825
title: Fix px review/revoke-review status reporting inconsistencies
status: backlog
assignee: []
created_date: '2026-10-31 15:04'
labels:
  - bug
  - harness
dependencies: []
priority: medium
ordinal: 299008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during adversarial review of px-0021. Four harness reporting bugs, outside px-0021 scope:

1. `px review --comment-file <path>` posts the PR comment successfully, then prints `[FAIL] Review-state persistence failed for mission px-0021, phase approved, round 2, stage boundary: review → integration transition failed (Mission status: active): Integration repair may only retain the original judgment with proven evidence`. The command reports failure after the comment succeeded; posting a comment should not attempt a review→integration transition.

2. `px revoke-review --decision <round> --reason ... --operator ...` prints `[PASS] Review decision N revoked ... provider was not updated: review provider token is unavailable`. Local state is revoked but the provider (Forgejo PR) keeps showing the approval, and the command still reports PASS. It should surface the unsynced provider state as a warning/failure with a recovery step.

3. `px review` while a review workflow is already live prints a failure summary `Cause: unknown ... Recovery: not attempted (no recorded recovery evidence)` with `Diagnostic: Another workflow owns this mission; stop it before restarting`. A running review is not a failure; the message should say a review workflow is already running, name the owning workflow id, and point to `px attach` / `px stop`.

4. `px status` reports `Coordinator evidence: no live px command` while a detached review workflow (`px --workflow-execute <id>` plus reviewer `--pi-session-worker`) is running for the mission.

Also note: killing the foreground `px review` client (e.g. via `timeout`) leaves the detached workflow running, which is what makes bugs 3 and 4 visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `px review --comment-file` reports success when the comment posts and does not attempt a stage transition
- [ ] #2 `px revoke-review` does not report plain PASS when the provider approval was not withdrawn; it states the outstanding provider state and how to resync
- [ ] #3 `px review` against a mission with a live review workflow reports that it is running, names the workflow id and the stop/attach commands, and is not classified as an unknown-cause failure
- [ ] #4 `px status` coordinator evidence reflects a live detached workflow for the mission
- [ ] #5 Each fix has a focused regression case in the existing owning suite
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
