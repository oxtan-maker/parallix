---
id: TASK-2870
title: Make Forgejo PR gate and review reporting accurate
status: backlog
assignee: []
created_date: '2026-11-23 06:45'
updated_date: '2026-11-23 06:51'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - TASK-2861.01
  - 'http://localhost:3300/magnus/parallix/pulls/934'
  - 'http://localhost:3300/magnus/parallix/pulls/935'
  - 'http://localhost:3300/magnus/parallix/pulls/922'
  - 'http://localhost:3300/magnus/parallix/pulls/931'
  - 'http://localhost:3300/magnus/parallix/pulls/923'
  - 'http://localhost:3300/magnus/parallix/pulls/930'
  - 'http://localhost:3300/magnus/parallix/pulls/908'
  - 'http://localhost:3300/magnus/parallix/pulls/909'
  - src/adapters/verification/integration-verification-proof.ts
  - src/adapters/review/review-workflow-posting.ts
  - src/adapters/review/review-artifact-publication.ts
  - src/adapters/cli/commands/integrate-gate-rebound.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make Forgejo PR reporting reflect what Parallix recorded for a mission. Reviewers should see the pre-integration verdict for the tested revision and which configured checks failed without opening a terminal. Findings, formal reviews, implementer dispositions and integration notices should appear once per logical event. POMDP v2 still receives one integration-tests observation. Static analysis, Sonar and the integration suites are checks within that observation.

## Observed on Forgejo

- PR #934 / TASK-2861.01. Both agents approved `d40c916fb`. The concurrent run failed static analysis (complexity 19, limit 15) and Sonar (87.6% new-code coverage, threshold 90%). Both integration suites passed. The PR showed the approvals and had no Parallix gate result explaining the return to Active.
- PR #935 / TASK-2859.20. The recorded verification attempts on PR head `4d7955ca7` include failures in static analysis, unit tests and `integration-ci`. No Parallix report identified those failures in the PR discussion or commit statuses at inspection. PR #922 similarly lacked a Parallix report for the static analysis, unit and `integration-ci` failures on `476c3ae0d`.
- PR #931 / TASK-2867.08. An approval-withdrawal notice names `integration-ci` for `c0aa49d28`; a later notice names only the generic key `verification`. A different tested revision, `552bd50ef`, had recorded static-analysis and Sonar failures with no Parallix report for that run.
- PR #923 / TASK-2867.06. Findings comments 23436 and 23437 share one publication key. Formal reviews 4367 and 4368 share another publication key. SQLite has one completed obligation for each. Several rounds repeated the pattern. PR #908 and PR #909 also have same-key duplicates. The retained #923 trace shows the verdict command being interrupted after the local outcome was recorded, followed by workflow publication. Reproduce the hand-off between submission and recovery before attributing the duplicates to a specific ordering.
- PR #930 / TASK-2867.09. Comments 23677 and 23679 publish the same implementer disposition in round 2 with different revision keys. Both obligations were recorded. The first revision string did not resolve to a commit in the repository inspected. Check authoritative revision binding as well as same-key retry behavior.

## Scope

Trace publication from the actual gate-run writer and from the existing review publication and recovery paths. Reuse those owners. Report pre-integration results from concurrent review, sequential verification, repair reruns and explicit integration through the same reporting contract. Use the run, tested revision and configured gate outcomes as the source. Name each failing gate in readable terms, including Sonar (`quality-gate`), static analysis (`verification`), and the specific integration suite that failed. Include a bounded, redacted diagnostic or existing evidence link when available. An approval withdrawal should refer to the relevant result and preserve its distinct meaning.

Verify that repeated or overlapping delivery, including recovery after an acknowledged or ambiguous provider write, converges on one visible record for each logical report or review event. Preserve genuinely distinct reviewers, rounds, revisions and attempts even when they use identical wording. Scope covers reporting and its publication identity. Gate configuration, POMDP scheduling and verdict semantics, approval coverage, repair routing and landing authority follow their existing rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A PR shows one aggregate pre-integration result for the tested revision. A running or pending result settles from the authoritative run to passed or failed or interrupted or cancelled. The same contract covers concurrent review and sequential integration including repair reruns.
- [ ] #2 The PR identifies every configured gate that failed in a run. It names static analysis and Sonar and the exact integration suite where they fail. It includes a concise safe diagnostic or evidence link when available. Blocked and cancelled checks remain distinguishable from failed checks.
- [ ] #3 A late result from an older run cannot supersede a newer run. An earlier revision result cannot appear as the current PR head verdict. Review decisions and approval-withdrawal notices remain independently attributable.
- [ ] #4 Initial and recovery publishers produce one Forgejo entry per logical report or review event even if delivery overlaps or the provider accepted a write before its acknowledgement was lost. Preserve distinct reviewer and round events. Reject or reconcile a noncanonical revision instead of publishing the same disposition again.
- [ ] #5 Retain focused red-to-green reproductions in existing owning suites for missing gate detail and duplicate delivery. Manually verify on a disposable Forgejo PR that a failed concurrent run is visible once with the actual failed gate names and that a passing repair run is attributed to its own revision.
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
