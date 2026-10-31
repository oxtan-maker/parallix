---
id: TASK-2823
title: Continue implementer context in act-on-review without boundary compaction
status: backlog
assignee: []
created_date: '2026-10-31 05:18'
labels:
  - ai_sdlc
dependencies: []
references:
  - >-
    /mnt/data/code/parallix-research/px-0008/analysis-20261031-act-on-review-continue-decision/results.json
  - >-
    /mnt/data/code/parallix-research/px-0008/claude-act-on-review-six/final-results.json
priority: medium
ordinal: 297008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Use retained implementer context for ordinary act-on-review repairs without a Parallix instruction to compact at that boundary. This is an operator-requested simplification following PX-0008, not a finding that Compact and Continue are equivalent.

Current main resolves adapters.prompts.contextCompaction to true when omitted, and renderPromptContextPolicy injects "compact the implementation context and reload" into prompts/act-on-review-core.md. The repository omits an override. Launch preparation already resumes an eligible saved implementer session, so the requested change is to retain that context while reloading authoritative Mission/review state, rather than asking the agent to summarize it first.

Evidence and uncertainty: the original local six-pair study found Compact 15.0% faster than Continue on mean measured work; the later two-pair cohort found 7.7% faster. In five comparable 200k Claude triplets Compact was 17.8% slower but used 43.8% less Sonnet-reported reference valuation ($1.382 versus $2.459 per mission). The latter is subscription telemetry, not cash paid, and excludes unknown reviewer cost. The exploratory one-sided paired cost p-value is 0.073. Preserve this potentially material cost tradeoff in review; do not describe the change as established cost-neutrality.

A conditional paired-t power calculation using observed variability estimates an 83.3% chance of missing a true 20% mean time benefit in the local six pairs and 86.1% in the five Claude pairs at one-sided alpha .05 (71.4%/75.3% at alpha .10). These are plug-in Type-II error estimates conditional on a true effect and assumed variance, not probabilities that an effect exists. Small selected samples do not establish equivalence within 20%. The Claude 1M case is separate: Continue hit the ten-round limit, and inconsistent reviewer acceptance prevents interpreting its Compact approval as a clean quality advantage.

Scope: ordinary act-on-review at the first and subsequent repair rounds. Keep the established same-implementer session resume behavior and reload durable goals, findings, resolutions and exact reviewed revision. Remove the superseded act-on-review compaction instruction and its dedicated rendering branch; do not add a new flag or retain dead fallback policy. Leave checkpoint/gate/lifecycle/reviewer/rebase context behavior and provider-native near-limit safeguards unchanged. Existing explicitly fresh recovery/fallback decisions remain independent.

This ticket authorizes implementation planning through the normal Mission flow; creating it does not change current product behavior or launch agents. Research arithmetic and source hashes are retained in ../parallix-research/px-0008/analysis-20261031-act-on-review-continue-decision/results.json.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ordinary act-on-review resumes the eligible saved implementer conversation on first and later review-repair rounds and does not request deliberate boundary compaction with contextCompaction omitted, true or false; genuine missing/incompatible-session fallback remains supported.
- [ ] #2 All ordinary act-on-review prompt routes reload authoritative Mission/review facts without compaction wording. Remove the obsolete act-on-review-specific placeholder/rendering branch and obsolete assertions instead of adding a new flag or dead fallback.
- [ ] #3 Checkpoint, successful-gate, lifecycle, independent-reviewer and rebase policies remain unchanged; native near-limit compaction and explicitly fresh recovery/fallback policies still work.
- [ ] #4 Extend the existing review-prompt evidence and session-launch owning suites to prove the changed prompt contract and retained implementer identity across rounds, including enabled/disabled/omitted configuration. Use isolated fixtures and finite bounds; do not add or alter operator-owned gates.
- [ ] #5 Update the owning context-policy documentation/ADR with the maintainability decision and material uncertainty, including the lower observed Sonnet valuation for Compact and the lack of a 20% equivalence finding.
- [ ] #6 Manually exercise an isolated act-on-review handoff/session-resume path and inspect its generated prompt and retained session identity without mutating production Mission data; report exact verification and any limitations.
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
