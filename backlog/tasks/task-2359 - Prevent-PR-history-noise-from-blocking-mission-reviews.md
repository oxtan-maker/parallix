---
id: TASK-2359
title: Prevent PR history noise from blocking mission reviews
status: ready-for-integration
assignee: [qwen]
created_date: '2026-08-10 00:00'
labels:
  - ai_sdlc
  - bug
priority: high
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reviewers are blocking otherwise-valid missions over Forgejo PR history that is not part of the mission. PR #247 is an example: the reported history inconsistency belongs to `main` or to review-surface state, not to the mission branch's reviewed change. That turns unrelated integration history into a request-changes finding and stops mission progress.

The review prompt creates this failure mode. It already defines the reviewed subject as `git diff {{reviewBaseline}}..HEAD` and tells reviewers to ignore rebasing artifacts that are not mission changes (`prompts/review.md:8`, `prompts/review.md:30-32`). But it later orders them twice to report any inconsistent “PR history” as a finding (`prompts/review.md:50` and `prompts/review.md:64`). The broad instruction overrides the scoped evidence rule in practice.

Narrow the reviewer contract and its generated compact/verbose prompts: PR metadata, commit ancestry, and historical commits outside the reviewed diff are context only. They must not produce a mission finding, request-changes verdict, or workflow block unless the mission itself introduced or materially worsened the inconsistency, or the review surface cannot identify the reviewed revision. Preserve the ability to report an actual mission-diff, checkpoint-evidence, or review-revision-attribution defect. The required behavior must be expressed through the prompt source, not through an agent-specific workaround.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 A red-to-green prompt regression test covers a PR whose history contains an unrelated `main` or review-surface commit and proves the reviewer is instructed not to file a finding or request changes for that history alone
- [ ] #2 Both `buildReviewPrompt()` and `buildCompactReviewPrompt()` preserve the rule that findings must be grounded in `git diff {{reviewBaseline}}..HEAD`, mission evidence, or inability to identify the reviewed revision
- [ ] #3 The broad instructions that currently require reporting any inconsistent “PR history” are removed or qualified so they cannot override the mission-diff boundary
- [ ] #4 The prompt still requires a finding when the mission itself introduced or materially worsened the inconsistency, when checkpoint evidence is false, or when the review surface cannot identify the exact reviewed revision
- [ ] #5 Rebasing-artifact guidance remains intact: stale branch/main differences that are not mission changes do not block the review loop
- [ ] #6 `./scripts/verify-local.sh all` passes
- [ ] #7 `./scripts/verify-local.sh static-analysis` passes
<!-- AC:END -->

## Out of Scope

- Repairing or rewriting historical PRs, including PR #247
- Changing `main`, Forgejo server data, or individual mission branches
- Suppressing valid findings about the mission diff, its checkpoint evidence, or ambiguity about the reviewed revision

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
