---
id: TASK-2703
title: >-
  Research and implement first-review evidence for Jev success-criteria
  judgments
status: backlog
assignee: []
created_date: '2026-10-09 16:09'
updated_date: '2026-10-09 16:11'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 206008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Research, develop and, once value is demonstrated, implement first-review evidence for Jev: what a bounded packet must contain for Jev to judge a mission's success criteria against its change on a first review.

Problem (live evidence, 2026-10-09)
Since TASK-2692 landed (e38bec80, 2026-10-09T06:39:21Z), 10 of 18 classified rounds were first reviews; all 10 returned insufficient_evidence (7 at score >= 0.93). Over the week: 24 first-review calls, 0 decisions. The scope was enabled by TASK-2680 without any evaluation. classify-review.ts sends success criteria as "findings" and the mission brief as the prior review comment into the finding-resolution builder and prompt (evidence-packet.ts, finding-resolution-preservation-v1). Source is selected only from file paths literally cited in that text: in an offline rebuild with the production builder, 6 of 10 packets had zero source files and no diff and were told "Select insufficient_evidence" (exactly the six score-1.0 rows); the other 4 carried 2-4 of the 7-140 files the mission changed. The question wording ("does the candidate source address the entire specific review finding") was written for repair verification, not for judging a success criterion.
Evidence: ../parallix-research/jev-live-investigation-2026-10-09/ (FINDINGS.md, telemetry.json, rebuild.mts). Related prior research: ADR 0065, backlog/docs/task-2650-evidence/, backlog/docs/task-2658-evidence/, backlog/docs/task-2692-research-summary.json.

Research phase (large artifacts outside the repository, under ../parallix-research/<dated dir>)
1. Survey how AI review harnesses and benchmarks assemble first-review context for a whole change and its stated intent: e.g. PR-Agent (dynamic context, compression), Claude Code review command (discovery vs per-issue validation), CodeRabbit, Greptile, ContextCRBench/AACR-Bench style intent-plus-context findings, and Jev's own limitations guidance (64k total / 32k state-plus-longest-question). Cite primary docs, papers or source; mark vendor claims. Record what each includes (intent, full diff, changed files, callers, tests, checkpoint evidence), how it prioritises under a budget, and how it states omissions.
2. Decide the question shape: one call per criterion versus all criteria; which criteria are judgeable from source at all (process criteria such as "gate ran" or "docs updated" may need recorded evidence or must route to the general reviewer). Define what a clear means on a first review and what it never covers.
3. Define candidate packet constructions using token-only budgets (DecisionPort.requestBudget): at minimum merge-base..candidate diff, changed-file pairs prioritised by criterion relevance, recorded checkpoint Goal Check evidence as labelled claims, explicit omissions. Packet construction must not use labels or later review outcomes.

Development and holdout
4. Build a case set of first reviews from parallix history with exact base/candidate revisions, criteria and the historical general-review outcome. Before any design, freeze a holdout of mission families withheld from all design choices (construction, prompt wording, thresholds); record selection rules and seed. The 10 live rounds above belong to development.
5. Run at least two development rounds: per construction, measure packet content and token size, fallback rate, Jev labels/scores/routes, and agreement with historical first-review decisions; adjudicate disagreements rather than assuming either side is right. Keep failures and fallbacks in denominators; repeated calls are not independent cases. Jev calls are allowed (about $0.001 per call); record cost.
6. Evaluate the selected construction once on the frozen holdout, reported separately, with no retuning on holdout outcomes.

Adoption and implementation
7. Implement only when the holdout shows a positive decision rate with no observed wrong routes against comparators, and the operator accepts the tradeoff. Otherwise record the negative result and recommend whether the first-review scope should stay enabled.
8. If adopted: implement inside existing ports, version prompt/packet/policy in telemetry, extend owning suites (evidence-packet, classify-review), manually exercise a real first review end to end in an isolated fixture without real statistics or Forgejo writes, update docs/config.md and ADR 0065 in place. Boundary changes follow the AGENTS.md stop-and-present rule.

Out of scope: gate-repair and finding re-review packets; mechanical bugs tracked in TASK-2704 (rebased repair diffs, remaining byte limits, exception subtypes, lost provider keys). The diff base for first reviews must use a merge base, but the mechanical base fix itself lands in TASK-2704.
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
