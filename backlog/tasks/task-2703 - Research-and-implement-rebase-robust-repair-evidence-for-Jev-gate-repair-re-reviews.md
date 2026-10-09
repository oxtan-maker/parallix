---
id: TASK-2703
title: >-
  Research and implement rebase-robust repair evidence for Jev gate-repair
  re-reviews
status: backlog
assignee: []
created_date: '2026-10-09 16:09'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 206008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Research, develop and implement rebase-robust repair evidence for Jev gate-repair re-reviews, so the classifier judges the repair the implementer actually made rather than everything main gained during a rebase.

Problem (live evidence, 2026-10-09)
Since TASK-2692 landed (e38bec80, 2026-10-09T06:39:21Z), 5 of 7 live gate-repair re-reviews were rebased: the approved revision is not an ancestor of the candidate. buildRepairEvidencePacket (src/application/review-classification/repair-evidence-packet.ts) uses `git diff approved..candidate`, so the mandatory "complete repair diff" includes main's changes. Effects:
- 3 of 7 rounds (task-2693 r5, task-2688 r7, task-2668.08 r2) fell back as classifier-exception with no call: diffs of 58–81 files / 140–161 KB exceeded the 30k state-plus-longest-question budget. The implementer's own repair commits were 15–26 KB for task-2693 and task-2688 (task-2668.08 also had a 423 KB own commit).
- task-2695 r2 returned at 0.81 on a 43-file diff whose own repair touched 11 files; task-2698 r2 abstained on 12 files versus 9.
- All 11 TASK-2692 tuned-replay cases were non-rebased (1–16 files). Rebased repairs were never in development or validation, so the replay result does not describe the live case mix.
Evidence and extraction scripts: ../parallix-research/jev-live-investigation-2026-10-09/ (FINDINGS.md, telemetry.json, rebuild.mts). Prior research: backlog/docs/task-2692-research-summary.json and ../parallix-research/task-2692/.

Research phase (keep large artifacts outside the repository, under ../parallix-research/<dated dir>)
1. Survey how established review tools present "what changed since the last review" when the author rebases or force-pushes, and how they separate rebase noise from author changes: e.g. Gerrit patch-set comparison and rebase-edit handling, GitHub "changes since last review" / force-push compare, Phabricator interdiffs, git range-diff, PR-Agent incremental review, and any published AI-review harness behaviour. Cite primary docs or source; mark vendor claims; do not launder search snippets. Record each mechanism, what it shows the reviewer, what it hides, and failure modes (conflict resolutions, dropped or squashed commits, rebases that change repair semantics).
2. Define candidate repair-evidence constructions, at minimum: current two-dot diff (baseline); diff from the approved revision rebased onto the candidate's base (or equivalent interdiff); range-diff/patch-id based own-commit diff; three-dot or merge-base-relative variants. State for each what counts as "the repair", how conflict-resolution edits and main-induced semantic changes are surfaced (they may be material), and what is declared as omitted.

Development and holdout
3. Build a case set of gate-repair re-reviews from parallix history, including rebased and non-rebased repairs, with exact approved/candidate revisions. Before designing, freeze a holdout set of families withheld from all design choices (packet construction, prompt wording, thresholds); record selection rules and seed. Development set includes the live rounds above.
4. Run at least two development rounds: measure per construction packet correctness against a labelled "true repair" (files/hunks), token size versus budget, exception/fallback rate, Jev labels/scores and routes, and agreement with historical reviewer decisions. Keep provider failures and fallbacks in denominators; repeats are not independent cases. Jev calls are allowed for this research (about $0.001 per call); record cost.
5. Evaluate the selected construction once on the frozen holdout. Report it separately from development results, with numerators/denominators and the policy unchanged. Do not retune on holdout outcomes; if the result fails the adoption bar, record the negative result.

Adoption bar and implementation
6. Adopt only if holdout shows: no increase in observed wrong routes against comparators, lower exception/oversize fallback for rebased repairs, and packets that contain the own repair with any rebase-induced material changes declared rather than silently mixed. Otherwise keep current behaviour and retain the research.
7. If adopted, implement inside existing ports (ReviewEvidencePort / DecisionPort.requestBudget, token-only budgeting); no byte caps reintroduced. Record the construction version in packet/policy telemetry. Extend owning suites (repair-evidence-packet and classify-review tests) with rebased-repair fixtures, including a reproduction that fails on the current two-dot diff. Manually exercise a real rebased gate repair end to end in an isolated fixture without real statistics or Forgejo writes. Update docs/config.md and ADR 0065 in place.
8. Ports-and-adapters changes follow AGENTS.md: stop and present evidence and alternatives before implementing any boundary change.

Out of scope: first-review packets, ordinary finding packets, byte-limit removal outside the repair path, provider-key environment handling (separate mission); changing the 52/67/81 thresholds unless the holdout protocol explicitly includes it before calls.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
