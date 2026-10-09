---
id: TASK-2704
title: >-
  Fix Jev rebased repair diffs, first-review base, remaining byte limits and
  lost provider keys
status: backlog
assignee: []
created_date: '2026-10-09 16:09'
updated_date: '2026-10-09 16:11'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 207008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix mechanical defects in Jev review classification found in the 2026-10-09 live investigation: rebase-polluted repair diffs, a moving first-review diff base, byte limits left outside the repair path, untyped classifier exceptions and decision-provider keys missing from px processes. First-review packet content and question design are researched separately in TASK-2703.

Evidence: ../parallix-research/jev-live-investigation-2026-10-09/ (FINDINGS.md; telemetry.json is a read-only extract of review_classifier_measurements; rebuild.mts rebuilds packets offline with the production builder).

1. Repair diff includes main's changes after a rebase (bug)
buildRepairEvidencePacket (src/application/review-classification/repair-evidence-packet.ts) uses `git diff approved..candidate`. Integrate rebases the mission onto main, so 5 of 7 live gate repairs since 2026-10-09T06:39Z had an approved revision that is not an ancestor of the candidate. task-2693 r5 and task-2688 r7 fell back as classifier-exception (diffs 58-66 files / 140-150 KB, own repair commits 15-26 KB); task-2668.08 r2 likewise (81 files, plus its own 423 KB commit); task-2695 r2 returned at 0.81 on a 43-file diff whose own repair touched 11 files; task-2698 r2 used 12 files versus 9. Fix: derive the repair from the mission's own changes since the approved revision (e.g. approved revision rebased onto the candidate's base, range-diff or patch-id based), and declare conflict-resolution or rebase-induced changes explicitly rather than mixing them in or hiding them. Reproduction test: a rebased repair fixture whose two-dot diff exceeds the budget while the own repair fits (red today).

2. First-review diff base is the branch name (bug)
classify-review.ts sets baseRevision to the target branch name (`main`) resolved at call time, so commits landed on main after the mission branched leak into the diff, reversed. Pin the merge base at the reviewed revision and record it in telemetry. Reproduction test: main advances between branch and review; the first-review diff must not contain main's new commits.

3. Byte limits remain in non-repair packets (bug)
TASK-2692 moved only gate repairs to token budgets. buildFindingEvidencePacket (evidence-packet.ts) still uses MAX_PACKET_BYTES 90,000, a 6,000-byte complete-file threshold, 15,000-byte diff caps and 12,000-character truncation; classify-review.ts passes requestBytes as the measure. Replace with the adapter-owned token budget (DecisionPort.requestBudget, jevtok-ts) with unchanged declared-omission behaviour. GitReviewEvidence (src/adapters/review/review-evidence.ts) reads git with maxBuffer 2,000,000: an oversize read must become a declared loss, not an exception. Reproduction tests: a packet within the token budget but over 90,000 bytes is degraded today (red); an oversize diff read throws today (red).

4. classifier-exception hides its cause
Live rows record classifier-exception with no subtype, so budget overflow, git read failure and other errors are indistinguishable in telemetry and px stats. Record a typed reason (e.g. evidence-over-budget, evidence-read-failed) and show it in the fallback-reasons table.

5. Decision-provider key missing from px processes (bug, diagnose first)
Rows for task-2692 r2/r3 and task-2675 r5 show setup-required with no provider: the px process had no decision key. spawn-tee strips TYPESAFE/OPENROUTER/AI_GATEWAY keys from every launched child by design; the mission terminal starts tmux with `env -i` plus a whitelist; the operator's key is exported in ~/.bashrc after the non-interactive return. Identify which launch path ran those reviews (lead, integrate re-review, mission-terminal reuse, px started from inside an agent), reproduce the key loss in a test, and fix any Parallix path that drops the key for a px process that legitimately owns it, without exposing keys to agents. Distinguish "key absent" from provider errors in telemetry and tell the operator once. Document the non-interactive-shell requirement in docs/config.md.

General: bug-labeled; red-to-green reproductions retained in owning suites (repair-evidence-packet, evidence-packet, classify-review, review-evidence, spawn-tee/tmux-host, statistics). Stay inside existing ports; boundary changes follow the AGENTS.md stop-and-present rule. No threshold, prompt or question-wording changes. Update docs/config.md and ADR 0065 in place.
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
