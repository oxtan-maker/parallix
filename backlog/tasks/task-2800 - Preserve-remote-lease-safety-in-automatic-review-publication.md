---
id: TASK-2800
title: Preserve remote lease safety in automatic review publication
status: backlog
assignee: []
created_date: '2026-10-20 16:17'
labels:
  - bug
dependencies: []
priority: high
ordinal: 279008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Normal review publication automatically escalates two stale lease rejections into unconditional git push --force. src/adapters/review/review-loop.ts:166-174 documents the review ref as a mission-branch mirror and calls push({force:true}); src/adapters/forgejo/forgejo-git.ts:129-130 translates this to literal --force. The fallback has no explicit operator force request or expected-remote-tip guard. A concurrent publisher can therefore have its remote branch tip overwritten after Git correctly rejected both lease attempts.

Observed trigger: task-2788 PR764 publication of repair commit5bc456025 logged two stale lease refusals and the force fallback before later rebase387b027c2. Its remote output a8806c69b..5bc456025 was an ordinary fast-forward: no real data loss is claimed.

Disposable local bare-remote reproduction (2026-10-20): two clones start from one base; mission clone commits local revision; competing clone publishes commit1; first mission --force-with-lease returns1/stale info; mission fetches tracking ref; competitor publishes commit2; second lease returns1/stale info; identical fallback --force returns0 and replaces competitor remote tip with mission HEAD. All fixtures were confined to a TemporaryDirectory and removed. This reproduces destructive capability without changing a real remote.

Dedup: native Mission DB title/description search and Backlog tasks/completed contain primary-baseline mirror force-push owners TASK1320/TASK2520, not this mission-review fallback. Existing low-level explicit operator force contract is intentional and must remain separate. No operator authorization for automatic mission-ref overwrite was found in live docs; implementation comment and integration test header document existing policy, not a caller opt-in.

Owning suite: test/integration/forgejo/forgejo-pr-round-sync.test.ts:118-159 tests initial lease and first stale-fetch retry but does not cover second stale rejection. test/integration/forgejo/forgejo-sync-merged-force-push-contract.test.ts:130-153 explicitly tests requested force and must retain that contract. Note createPr buildCreatePrPushArgs uses a different force-to-lease mapping and is not the failing path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a second stale lease rejection, automatic review publication fails safely or reconciles through a supported bounded path; it never silently escalates to unconditional force.
- [ ] #2 An owning focused regression is red on the parent and green with the fix for a competing remote update between fetch and retry, preserving the competing tip.
- [ ] #3 Preserve explicitly requested operator force behavior, normal rebased mission publication, and existing failed-publication reporting; do not alter primary baseline mirror policy.
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
