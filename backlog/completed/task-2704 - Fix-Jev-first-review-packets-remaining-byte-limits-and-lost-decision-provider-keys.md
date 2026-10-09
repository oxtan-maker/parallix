---
id: TASK-2704
title: >-
  Fix Jev review base, remaining byte limits, untyped exceptions and lost
  provider keys
status: done
assignee: [claude]
created_date: '2026-10-09 16:09'
updated_date: '2026-10-09 16:15'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 207008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix mechanical defects in Jev review classification found in the 2026-10-09 live investigation: repair and first-review diffs that ignore the stable review baseline the agent reviewer uses, byte limits left outside the repair path, untyped classifier exceptions and decision-provider keys missing from px processes. First-review packet content and question design are researched separately in TASK-2703.

Evidence: ../parallix-research/jev-live-investigation-2026-10-09/ (FINDINGS.md; telemetry.json is a read-only extract of review_classifier_measurements; rebuild.mts rebuilds packets offline with the production builder).

1. One stable review base for the agent and Jev (bug)
The general reviewer already reviews against a stable base. After the pre-review rebase, round.reviewBaseline = preReview.reviewBaseline() (src/adapters/review/review-loop.ts): the primary-branch SHA the mission was actually rebased onto, stable for the round. The agent prompt reviews `git diff {{reviewBaseline}}..HEAD` (prompts/review-core.md). Later rebases happen at later rounds and at integration. tryClassifyReview runs at the same verified boundary (src/application/review-loop/reviewer-phase.ts, after runPreReviewRebase and the declared gate) but ignores that value and computes its own base:
- First review: classify-review.ts sets baseRevision to the target branch name (`main`) resolved at call time, so commits landed on main after the rebase leak in, reversed.
- Gate repairs: buildRepairEvidencePacket (repair-evidence-packet.ts) uses `git diff <approved>..<candidate>`. Integrate rebases onto main, so 5 of 7 live gate repairs since 2026-10-09T06:39Z had an approved revision that is not an ancestor of the candidate. task-2693 r5 and task-2688 r7 fell back as classifier-exception (diffs 58-66 files / 140-150 KB; own repair commits 15-26 KB); task-2668.08 r2 likewise (81 files, plus its own 423 KB commit); task-2695 r2 returned at 0.81 on a 43-file diff whose own repair touched 11 files; task-2698 r2 used 12 files versus 9.
The same polluted `<approved>..<repaired>` range is given to the agent reviewer and the human: integrationRepairReviewBrief and integrationRepairPrComment (src/application/integration-repair-review.ts).
Fix, as one path: the classifier takes its base from the round's reviewBaseline through the same function the agent prompt uses, never a branch name and never a separate git computation. Mission evidence is `<reviewBaseline>..<candidate>`, identical to the agent's review surface. For the repair delta, persist the reviewBaseline with each review round's subject, so the approved round's mission diff (its baseline..approved) can be compared with the current one (reviewBaseline..candidate) as an interdiff/range-diff of the mission rather than of main; show that same repair range in the agent repair brief and the PR comment. Rebase-induced and conflict-resolution changes are declared, not mixed in or hidden.
Reproduction tests (red today): main advances after the rebase and the first-review packet must not contain main's commits; a rebased repair whose two-dot diff exceeds the budget while the mission interdiff fits; the agent repair brief must not cite a range that contains main's commits.

2. Byte limits remain in non-repair packets (bug)
TASK-2692 moved only gate repairs to token budgets. buildFindingEvidencePacket (evidence-packet.ts) still uses MAX_PACKET_BYTES 90,000, a 6,000-byte complete-file threshold, 15,000-byte diff caps and 12,000-character truncation; classify-review.ts passes requestBytes as the measure. Replace these with the adapter-owned token budget (DecisionPort.requestBudget, jevtok-ts) with unchanged declared-omission behaviour. GitReviewEvidence (src/adapters/review/review-evidence.ts) reads git with maxBuffer 2,000,000: an oversize read must become a declared loss, not an exception. Reproduction tests (red today): a packet within the token budget but over 90,000 bytes is degraded; an oversize diff read throws.

3. classifier-exception hides its cause
Live rows record classifier-exception with no subtype, so budget overflow, git read failure and other errors are indistinguishable in telemetry and px stats. Record a typed reason (for example evidence-over-budget, evidence-read-failed) and show it in the fallback-reasons table.

4. Decision-provider key missing from px processes (bug, diagnose first)
Rows for task-2692 r2/r3 and task-2675 r5 show setup-required with no provider: the px process had no decision key. spawn-tee strips TYPESAFE/OPENROUTER/AI_GATEWAY keys from every launched child by design; the mission terminal starts tmux with `env -i` plus a whitelist; the operator's key is exported in ~/.bashrc after the non-interactive return. Identify which launch path ran those reviews (lead, integrate re-review, mission-terminal reuse, px started from inside an agent), reproduce the key loss in a test, and fix any Parallix path that drops the key for a px process that legitimately owns it, without exposing keys to agents. Distinguish "key absent" from provider errors in telemetry and tell the operator once. Document the non-interactive-shell requirement in docs/config.md.

General: bug-labeled; red-to-green reproductions retained in owning suites (repair-evidence-packet, evidence-packet, classify-review, integration-repair-review, review-evidence, spawn-tee/tmux-host, statistics). Stay inside existing ports; boundary changes follow the AGENTS.md stop-and-present rule. No threshold, prompt-question or criteria-wording changes (TASK-2703 owns first-review question design). Update docs/config.md and ADR 0065 in place.
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
