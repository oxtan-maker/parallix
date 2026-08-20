---
id: TASK-2384
title: Reviewer fallback escape hatch selects the PR author
status: refined
assignee: [custom]
created_date: '2026-08-20 19:12'
labels:
  - bug
  - user_value
  - agents
  - review
dependencies: []
references:
  - src/adapters/agents/agents.ts
  - src/adapters/review/review-agent-fallback.ts
  - src/adapters/review/review-artifacts.ts
  - src/application/handoff-command-use-case.ts
  - test/agents.test.ts
priority: high
ordinal: 101917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the reviewer agent pool is exhausted, the launcher re-admits the excluded implementer and runs it as reviewer of its own pull request. The review then executes in full and is thrown away at the last step, because the provider refuses a self-approval.

Path: reviewer selection correctly excludes the implementer (`src/adapters/review/review-agent-fallback.ts:396`, `src/application/handoff-command-use-case.ts:139`). That exclusion is passed to `startAgent` as `exclude`, which seeds the `tried` set. On pool exhaustion, `startAgent` deliberately reaches back into the excluded set (`src/adapters/agents/agents.ts:343-347`, "single-family escape hatch") and launches an excluded family anyway. Nothing at that point knows the excluded family is the PR author.

Observed on mission task-2377.05, review round 2 (operator log, 2026-08-20T18:4xZ): claude was blocked by a stale-session failure (TASK-2380), codex/qwen/vibe all failed to start under the review sandbox (TASK-2383), the pool emptied, and the escape hatch selected `custom` — the mission's own implementer and PR author. The review ran to completion, wrote all three artifacts, posted a PR comment, and then:

`[WARN] Reviewer "custom" is the PR author for mission/task-2377.05; skipping the provider review POST to avoid a self-approval (Forgejo rejects "approve your own pull is not allowed" with HTTP 422).`

The self-author guard in `src/adapters/review/review-artifacts.ts:288` is correct as a last line of defence, but it fires after a full review has been spent. The escape hatch should not select a family that authored the change under review; when no other family can run, the mission needs a human, not a review that cannot be published.

Scope note: the single-family escape hatch has legitimate uses for non-review steps and for changes with no provider author conflict. Do not delete it wholesale — make it author-aware for the review step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The pool-exhaustion escape hatch in `startAgent` never selects a family that authored the change under review for the `review` step
- [ ] #2 When no non-author family can run the review step, the workflow stops with an explicit human-escalation message naming why each candidate family was unavailable, instead of launching an unpublishable review
- [ ] #3 The escape hatch's existing behavior for non-review steps is unchanged
- [ ] #4 The self-author guard in `src/adapters/review/review-artifacts.ts` stays in place as a defence in depth
- [ ] #5 Tests cover: exhausted pool with the PR author as the only candidate escalates rather than launching, and an exhausted pool at a non-review step still uses the escape hatch
- [ ] #6 `./scripts/verify-local.sh static-analysis` and the affected unit suites pass
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
