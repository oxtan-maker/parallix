---
id: TASK-2812
title: Make mission rebases preserve unique work after base squashes
status: backlog
assignee: []
created_date: '2026-10-23 05:27'
updated_date: '2026-10-23 05:28'
labels: []
dependencies: []
priority: high
ordinal: 291008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add squash-aware rebasing as a new capability. Handling rewritten base history was not part of the original requirements.

Open missions must rebase safely after commits they inherited from the local base have been squash-integrated or the base history has been rewritten. The current shared rebase workflow starts a plain git rebase against the target branch, allowing Git to replay inherited commits whose combined changes are already on the target. This creates repeated conflicts against newer production behavior and can resurrect reverted code or retired task metadata.

Observed on TASK-2801: rebasing onto 8d84130c3 queued 66 commits, while only the final five were unique to the mission. Earlier commits were represented in squash integrations on main. Manual recovery dropped the integrated replay entries, preserved the five mission commits unchanged according to git range-diff, and passed 33 focused status checks, a build, and the isolated CLI smoke fixture.

Make replay selection squash-aware before starting Git mutation. Reuse the shared rebase owner for standalone, pre-review, and integration callers. Retain or recover a trustworthy historical base boundary and verify which inherited changes have landed; use an explicit replay range (for example git rebase --onto) when supported by that evidence. Commit titles, task references, or individual patch equivalence alone are insufficient proof that a group of commits can be discarded. Preserve later base edits and reversions, all unique mission changes, and the resolved local primary/parent target. Existing missions need a safe recovery path when historical boundary evidence is missing or unavailable. Do not solve this solely by expanding the conflict-agent prompt.

Keep existing agent-assisted conflict resolution for genuine remaining mission conflicts and preserve review, hook, and verification ownership. The existing same-mission landed-squash closeout check remains a separate recovery contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Replay selection uses verifiable history and change evidence; it never drops unique mission commits based only on matching subjects, task IDs, or ambiguous patch matches. Later base changes and reversions remain intact.
- [ ] #2 Standalone rebase, pre-review rebase, and integration-time rebase use the same squash-aware selection contract and honor the resolved local primary or parent branch.
- [ ] #3 Legacy missions, unavailable old revisions, partial integrations, and ambiguous evidence have explicit safe outcomes with actionable diagnostics; uncertain history does not cause silent loss of changes or uncontrolled stale-history replay.
- [ ] #4 Genuine conflicts in remaining mission changes still reach the existing resolution workflow; already-running rebase recovery and same-mission landed-squash closeout continue to work.
- [ ] #5 Extend the owning focused suites, cover repeated squash/base advances and preservation of unique mission edits, and manually exercise an isolated end-to-end CLI scenario. Respect existing test tiers and finite budgets, including the 3.5-second integration limit; do not add or restore verification gates.
- [ ] #6 An isolated scenario with an open mission inheriting multiple commits subsequently squashed on the base demonstrates that only unique mission work is replayed, with no conflicts caused solely by already-integrated inherited commits.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
<!-- DOD:END -->
