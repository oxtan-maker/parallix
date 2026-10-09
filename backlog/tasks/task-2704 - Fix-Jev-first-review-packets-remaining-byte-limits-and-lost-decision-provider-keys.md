---
id: TASK-2704
title: >-
  Fix Jev first-review packets, remaining byte limits and lost decision-provider
  keys
status: backlog
assignee: []
created_date: '2026-10-09 16:09'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 207008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the remaining Jev review-classification defects found in the 2026-10-09 live investigation: empty first-review packets, byte limits left in the non-repair path, and decision-provider keys missing from px processes. Rebase-polluted repair diffs are handled by a separate research mission.

Evidence: ../parallix-research/jev-live-investigation-2026-10-09/ (FINDINGS.md; telemetry.json is a read-only extract of review_classifier_measurements; rebuild.mts rebuilds packets offline with the production builder).

1. First-review packets carry no change evidence (bug)
Since 2026-10-09T06:39Z, 10 of 18 classified rounds were first reviews; all 10 returned insufficient_evidence. The scope (TASK-2680) reuses buildFindingEvidencePacket (src/application/review-classification/evidence-packet.ts) with success criteria as findings and the brief as the prior review comment. Source is selected only from file paths literally cited in that text, so 6 of 10 rebuilt packets had zero source and no diff and were told "Select insufficient_evidence" (exactly the six score-1.0 rows); the other 4 carried 2-4 of 7-140 changed files. The diff base is the branch name `main` resolved at call time (classify-review.ts baseRevision = targetBranch), not the merge base, so later main commits leak in reversed. The question wording asks whether source "addresses the specific review finding", which does not fit a success criterion.
Fix: pin the base to the merge base recorded for the round; build first-review evidence from the mission's own change (merge-base..candidate) with explicit omissions; use first-review question wording that judges a success criterion against that change. Reproduction test: a first-review packet for a mission whose criteria cite no paths must contain the mission diff (red today). Do not claim a decision-rate improvement without measuring it: replay the 10 live first-review rounds offline (packet content, token size) and, if Jev is called, report labels/scores with denominators. If packets still cannot fit or Jev still never decides, record that and disable the first-review scope by default rather than leave a call that cannot succeed.

2. Byte limits remain in non-repair packets (bug)
TASK-2692 moved only gate repairs to token budgets. buildFindingEvidencePacket still uses MAX_PACKET_BYTES 90,000, a 6,000-byte complete-file threshold, 15,000-byte diff caps and 12,000-character text truncation; classify-review.ts passes requestBytes as the measure. Replace these with the adapter-owned token budget (DecisionPort.requestBudget, jevtok-ts) so finding and first-review packets are sized in the model's unit, with the same declared-omission behaviour. GitReviewEvidence (src/adapters/review/review-evidence.ts) reads git with maxBuffer 2,000,000: an oversize read must become a declared loss, not an exception. Reproduction tests: a packet that fits the token budget but exceeds 90,000 bytes is currently degraded (red); a large diff read is currently an exception (red).

3. classifier-exception hides its cause
Live rows record classifier-exception without a subtype; budget overflow, git read failure and other errors are indistinguishable in px stats. Record a typed reason (e.g. evidence-over-budget, evidence-read-failed) in telemetry and the fallback-reasons table.

4. Decision-provider key missing from px processes (bug, diagnose first)
Rows for task-2692 r2/r3 and task-2675 r5 show setup-required with no provider: the px process had no decision key. spawn-tee deliberately strips TYPESAFE/OPENROUTER/AI_GATEWAY keys from every launched child, and the mission terminal starts tmux with `env -i` plus a whitelist; the operator's key is exported in ~/.bashrc after the non-interactive return. Determine which launch path ran those reviews (lead, integrate re-review, mission terminal reuse, a px command started from inside an agent) and reproduce key loss in a test. Fix any Parallix path that drops the key for a px process that legitimately owns it, without exposing keys to agents. Make the unavailable reason explicit (key absent vs provider error) and surface it once to the operator. Document the non-interactive-shell requirement in docs/config.md.

General: bug-labeled; red-to-green reproductions retained in owning suites (evidence-packet, classify-review, review-evidence, spawn-tee/tmux-host, statistics). Stay inside existing ports; any boundary change follows AGENTS.md stop-and-present. No threshold changes. Update docs/config.md and ADR 0065 in place.
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
