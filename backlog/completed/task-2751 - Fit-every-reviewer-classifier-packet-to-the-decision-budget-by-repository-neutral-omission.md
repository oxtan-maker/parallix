---
id: TASK-2751
title: Fit every reviewer-classifier packet to the decision budget by repository-neutral omission
status: done
assignee: [codex]
created_date: '2026-10-15 07:30'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 241008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An oversized evidence packet must never stop the reviewer classifier. Today three packers refuse with `EvidenceOverBudgetError` instead of fitting the packet to the decision token budget:
- the integration-repair weakening packet (`weakening-packet.ts`, plus the V5 check in `weakening-review.ts`);
- the repair evidence packet (`repair-evidence-packet.ts`);
- the archived panel packet (`archived-packing.ts`), which already drops optional whole files but still refuses when the mandatory diff does not fit.

The round then goes to the general reviewer for size alone. In the 11 hours after TASK-2741/2742/2743 merged (2026-10-14), this happened on 3 rounds, and the reviewer approved all 3:
- task-2747 r4 (`weakening-over-budget`): the repair is 4 small files plus a 2,306-line generated calibration JSON under `backlog/docs/`. The context is 30,222 tokens against a limit of 30,000.
- task-2742 r4 (`weakening-over-budget`): a large 57-file repair, 41,792 context tokens.
- task-2749 r4 (`evidence-over-budget`): a panel packet.

The packer must degrade in a general way that does not depend on this repository. It never relies on path names, file types or Parallix-specific rules. One fixed omission order applies to every packet:
1. Optional context, such as whole candidate files, is dropped first (as `archived-packing.ts` already does).
2. Per-file diffs are dropped, largest first by the decision tokenizer, until the packet fits.
3. Long lists (commit subjects, incorporated main commits) are shortened. The kept count and the dropped count are both stated.
4. Only when the mandatory obligations alone do not fit (the findings or obligation text, the failure lines and the validation fact) is a round refused, and only that case records over-budget.

Every omission is visible to the classifier. The packet names each omitted path with its added and removed line counts, and states that the omitted changes were not shown. The question tells the classifier to choose insufficient_evidence (panel) or not preserves (weakening) when an omitted change could decide the answer. Omission must never make a clear easier.

Offline check, 2026-10-15, production packet code on main, Jev typesafe/jev-1.13-20260917. Each over-budget weakening packet was rebuilt, and the largest file diffs were dropped until it fit:
- task-2747 r4: dropping only the calibration JSON makes it fit. v4 answers weakens (preserves 0.26) and V5 answers weakens (0.22), because the raise of 12 CPU budgets has no measured overrun in the failure lines. This is a correct non-clear, now decided by policy instead of by size.
- task-2742 r4: two test-file diffs are dropped, and v4 answers preserves at 0.60, exactly the threshold. It would have cleared; the reviewer approved it.

In the px-0010 research harness, which dropped the largest diffs first, no clear depended on an omission. 12 of 126 tuning packets carried omissions, and none of them cleared.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The weakening packet (v4 and V5), the repair evidence packet and the archived panel packet are fitted to the decision budget by the same omission order: optional context first, then per-file diffs largest first by the decision tokenizer, then long lists shortened with kept and dropped counts stated. No path, file-type or repository-specific rule is used.
- [ ] #2 A packet whose mandatory obligations fit is always sent. Over-budget is recorded only when the findings or obligation text, failure lines and validation fact alone exceed the budget.
- [ ] #3 Every omitted diff is listed in the packet with its path and its added and removed line counts. The packet states that omitted changes were not shown. The question text tells the classifier that an omitted change which could decide the answer means insufficient_evidence (panel) or not preserves (weakening).
- [ ] #4 V5 is sized on the same fitted packet as v4. A V5 question that does not fit after omission falls back to the reviewer as before, and never makes v4's outcome more permissive.
- [ ] #5 Classifier telemetry records, for each decision, the number of omitted diffs and the omitted tokens. No new `px stats` section or column is added.
- [ ] #6 Focused owning-suite tests cover: a packet that fits unchanged; one large generated file dropped first; several files dropped largest first until the packet fits; a list shortened with counts stated; mandatory obligations over budget still refused; and the omission notice present in the request.
- [ ] #7 Policy and packet version strings change, so rounds before and after this change can be told apart in statistics.
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
